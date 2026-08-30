import { createHash } from 'node:crypto';

import {
  ACCOUNT_REPOSITORY,
  CLOCK,
  INBOUND_EVENT_REPOSITORY,
  POLL_CURSOR_REPOSITORY,
  ProviderResolver,
  WebhookApplyService,
  type AccountRepository,
  type Clock,
  type InboundEventRepository,
  type PollCursorRepository,
} from '@baasconn/api/domain';
import type { StatementEntry } from '@baasconn/provider-spi';
import { ChangeSource, Environment, newId } from '@baasconn/taxonomy';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { toInboundDraft } from '../reconciliation/auto-resolution.service.js';

export const STATEMENT_STREAM = 'statement';

/**
 * Teto da janela por volta.
 *
 * Um cursor parado ha uma semana pedindo a semana inteira leva 500 do
 * provedor e NUNCA alcanca — a cada volta pede o mesmo intervalo grande e
 * falha do mesmo jeito. Com teto, ele anda 24 h por volta ate se aproximar.
 */
const MAX_WINDOW_MS = 24 * 3_600_000;
const PAGE_SIZE = 200;
const MAX_PAGES = 20;

/**
 * Poller de extrato.
 *
 * Roda para TODO provedor, e nao so para os sem webhook: webhook perdido e
 * silencioso, e um PIX in perdido e incidente visivel ao cliente. Onde ha
 * webhook a cadencia e lenta e o poller e rede de seguranca; onde nao ha, ele
 * e o unico caminho.
 *
 * Aplica pelo MESMO `applyDrafts` do webhook. Nao ha um segundo caminho de
 * apply para divergir na primeira correcao.
 */
@Injectable()
export class PollService {
  private readonly logger = new Logger(PollService.name);

  constructor(
    private readonly providers: ProviderResolver,
    private readonly apply: WebhookApplyService,
    @Inject(POLL_CURSOR_REPOSITORY) private readonly cursors: PollCursorRepository,
    @Inject(ACCOUNT_REPOSITORY) private readonly accounts: AccountRepository,
    @Inject(INBOUND_EVENT_REPOSITORY) private readonly events: InboundEventRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async poll(connectionId: string, accountId: string): Promise<number> {
    const bound = await this.providers.resolve(connectionId);
    if (!bound.adapter.statement) return 0;

    const account = await this.accounts.findById(
      bound.context.environment as Environment,
      accountId,
    );
    if (!account?.providerAccountId) return 0;

    const cursor = await this.cursors.ensure({
      id: newId('providerCall'),
      connectionId,
      stream: STATEMENT_STREAM,
      // NUNCA nulo: `@@unique([connectionId, stream, scopeId])` tem `scopeId`
      // nullable, e em Postgres NULL nao e igual a NULL num indice unico.
      scopeId: accountId,
      watermark: new Date(this.clock.now().getTime() - MAX_WINDOW_MS),
      lapSeconds: 300,
    });

    const agora = this.clock.now();
    // A sobreposicao de `lapSeconds` e DESEJADA, nao um defeito: garante
    // duplicata, e a duplicata e absorvida pelo indice unico do evento — o
    // ponto mais barato possivel, antes de chegar ao guard monotonico.
    const inicio = new Date(cursor.watermark.getTime() - cursor.lapSeconds * 1000);
    const fim = new Date(Math.min(agora.getTime(), inicio.getTime() + MAX_WINDOW_MS));

    try {
      const aplicados = await this.drain(
        bound,
        account.providerAccountId,
        inicio,
        fim,
        connectionId,
      );
      // A marca d'agua so anda depois da pagina INTEIRA aplicar sem lancar.
      await this.cursors.advance({ id: cursor.id, watermark: fim, at: agora });
      return aplicados;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // NAO avanca. Avancar por cima de um erro e como um poller pula um dia
      // em silencio: nada falha, nada alerta, e o movimento nunca chega.
      await this.cursors.recordFailure(cursor.id, { message }, agora);
      throw error;
    }
  }

  private async drain(
    bound: Awaited<ReturnType<ProviderResolver['resolve']>>,
    providerAccountId: string,
    from: Date,
    to: Date,
    connectionId: string,
  ): Promise<number> {
    const ref = { providerAccountId };
    let cursor: string | undefined;
    let aplicados = 0;

    for (let pagina = 0; pagina < MAX_PAGES; pagina += 1) {
      const page = await bound.adapter.statement!.list(ref, {
        from: from.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10),
        limit: PAGE_SIZE,
        cursor,
      });

      for (const entry of page.data) {
        if (await this.applyEntry(bound, entry, providerAccountId, connectionId)) aplicados += 1;
      }

      if (!page.hasMore || !page.nextCursor) break;
      cursor = page.nextCursor;
    }

    return aplicados;
  }

  private async applyEntry(
    bound: Awaited<ReturnType<ProviderResolver['resolve']>>,
    entry: StatementEntry,
    providerAccountId: string,
    connectionId: string,
  ): Promise<boolean> {
    // So credito: importar um debito seria criar do nada uma transacao que
    // tira dinheiro do cliente. O debito que so o provedor tem e trabalho da
    // conciliacao, com julgamento humano.
    if (entry.direction !== 'credit') return false;

    const now = this.clock.now();
    const payload = Buffer.from(JSON.stringify(entry), 'utf8');
    const { inserted } = await this.events.claim({
      id: newId('inboundEvent'),
      environment: bound.context.environment as Environment,
      connectionId,
      provider: bound.slug,
      // `poll:` no namespace: uma entrada vista pelo poller e a MESMA vista
      // pelo webhook nao podem colidir na chave, senao a segunda some.
      dedupeKey: `poll:${entry.providerEntryId}`,
      receivedAt: now,
      headers: {},
      payload,
      rawSha256: createHash('sha256').update(payload).digest('hex'),
      // Nao houve assinatura para verificar: veio de uma chamada NOSSA ao
      // provedor, autenticada, e nao de um POST que qualquer um pode forjar.
      signatureValid: true,
      status: 'RECEIVED',
      attempts: 0,
    });

    // Ja conhecido: a sobreposicao da janela fez o seu trabalho.
    if (!inserted) return false;

    const draft = toInboundDraft(entry, providerAccountId);
    const { outcomes } = await this.apply.applyDrafts(
      {
        environment: bound.context.environment as Environment,
        connectionId,
        provider: bound.slug,
        source: ChangeSource.RECONCILIATION,
        receivedAt: now,
      },
      [draft],
    );

    return outcomes.includes('applied');
  }
}
