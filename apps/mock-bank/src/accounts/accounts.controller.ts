import { AccountStatus, HolderType, Money, RequirementCode } from '@baasconn/taxonomy';
import { Body, Controller, Get, Headers, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';

import { BearerAuthGuard } from '../common/auth.guard.js';
import { MockClock } from '../common/clock.provider.js';
import { MockBankError } from '../common/errors.js';
import type { MockAccount } from '../common/store.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { OnboardingService } from '../onboarding/onboarding.service.js';
import { PaymentsService, type StatementLine } from '../pix/payments.service.js';

import { AccountsService } from './accounts.service.js';

interface AuthedRequest extends Request {
  clientId: string;
}

/**
 * Serializacao no formato do Mock Bank.
 *
 * Deliberadamente NAO igual ao canonico: valores em decimal string, status em
 * portugues, snake_case. E o que forca o adapter a existir e a fazer mapeamento
 * de verdade, em vez de repassar o payload.
 */
function serializeAccount(account: MockAccount) {
  return {
    id: account.id,
    tipo_pessoa: account.holderType === HolderType.INDIVIDUAL ? 'PF' : 'PJ',
    documento: account.holderTaxId,
    nome: account.holderName,
    email: account.email,
    situacao: toMockStatus(account.status),
    agencia: account.branch,
    conta: account.number,
    conta_digito: account.checkDigit,
    ispb: account.ispb,
    id_externo: account.externalId ?? null,
    criado_em: account.createdAt.toISOString(),
    aberto_em: account.openedAt?.toISOString() ?? null,
  };
}

/** Vocabulario proprio do provedor, para o adapter ter o que mapear. */
function toMockStatus(status: AccountStatus): string {
  switch (status) {
    case AccountStatus.ACTIVE:
      return 'ATIVA';
    case AccountStatus.BLOCKED:
      return 'BLOQUEADA';
    case AccountStatus.SUSPENDED:
      return 'SUSPENSA';
    case AccountStatus.REJECTED:
      return 'RECUSADA';
    case AccountStatus.CLOSED:
      return 'ENCERRADA';
    case AccountStatus.CLOSING:
      return 'EM_ENCERRAMENTO';
    default:
      return 'EM_ANALISE';
  }
}

@Controller('api/v1/contas')
@UseGuards(BearerAuthGuard)
export class AccountsController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly onboarding: OnboardingService,
    private readonly payments: PaymentsService,
    private readonly ledger: LedgerService,
    private readonly clock: MockClock,
  ) {}

  @Post()
  create(
    @Req() request: AuthedRequest,
    @Body()
    body: {
      tipo_pessoa: 'PF' | 'PJ';
      documento: string;
      nome: string;
      email: string;
      id_externo?: string;
    },
  ) {
    const account = this.accounts.create({
      clientId: request.clientId,
      holderType: body.tipo_pessoa === 'PJ' ? HolderType.BUSINESS : HolderType.INDIVIDUAL,
      holderTaxId: body.documento,
      holderName: body.nome,
      email: body.email,
      externalId: body.id_externo,
      raw: body as unknown as Record<string, unknown>,
    });

    // A abertura ja dispara o onboarding: e assim que os provedores reais
    // funcionam, e por isso o status volta EM_ANALISE.
    this.onboarding.submit(account.id);
    return serializeAccount(this.accounts.get(account.id));
  }

  @Get()
  list(@Req() request: AuthedRequest) {
    return { dados: this.accounts.list(request.clientId).map(serializeAccount) };
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return serializeAccount(this.accounts.get(id));
  }

  @Get(':id/saldo')
  balance(@Param('id') id: string) {
    const balances = this.accounts.balances(id);
    return {
      // Decimal string, como Celcoin e BACEN fazem: forca o adapter a
      // converter para centavos em vez de repassar.
      saldo_disponivel: Money.of(balances.available).toDecimalString(),
      saldo_bloqueado: Money.of(balances.blocked).toDecimalString(),
      saldo_a_liberar: Money.of(balances.pending).toDecimalString(),
      moeda: 'BRL',
      consultado_em: this.clock.now().toISOString(),
    };
  }

  @Post(':id/bloquear')
  block(@Param('id') id: string) {
    return serializeAccount(this.accounts.setStatus(id, AccountStatus.BLOCKED));
  }

  @Post(':id/desbloquear')
  unblock(@Param('id') id: string) {
    return serializeAccount(this.accounts.setStatus(id, AccountStatus.ACTIVE));
  }

  @Post(':id/encerrar')
  close(@Param('id') id: string) {
    return serializeAccount(this.accounts.setStatus(id, AccountStatus.CLOSED));
  }

  /**
   * Extrato paginado, com os saldos da janela.
   *
   * Pagina de VERDADE, com cursor de keyset. Devolver a janela inteira e
   * `tem_mais: false` sempre seria mais simples e teria um custo escondido: o
   * laco de paginacao do conector nunca seria exercitado contra um servidor
   * real, e o primeiro provedor que paginasse truncaria a janela em silencio —
   * produzindo quebra de conciliacao inventada, que e pior que quebra nenhuma.
   */
  @Get(':id/extrato')
  statement(
    @Param('id') id: string,
    @Query('data_inicio') from?: string,
    @Query('data_fim') to?: string,
    @Query('limite') limite?: string,
    @Query('cursor') cursor?: string,
  ) {
    const start = from ? new Date(`${from}T00:00:00.000Z`) : new Date(0);
    const end = to ? new Date(`${to}T23:59:59.999Z`) : this.clock.now();
    const account = this.accounts.get(id);

    const todas = this.payments.statementLines(id, start, end);
    const posicao = cursor ? decodeStatementCursor(cursor) : undefined;
    const restantes = posicao
      ? todas.filter(
          (linha) =>
            linha.effectiveAt.getTime() > posicao.at ||
            (linha.effectiveAt.getTime() === posicao.at && linha.id > posicao.id),
        )
      : todas;

    const tamanho = clampLimit(limite);
    const pagina = restantes.slice(0, tamanho);
    const temMais = restantes.length > pagina.length;
    const ultima = pagina.at(-1);

    return {
      dados: pagina.map((linha) => serializeStatementLine(linha)),
      // Os saldos sao da JANELA e vao em toda pagina: o consumidor le da
      // primeira que receber, sem precisar chegar ao fim para saber o saldo.
      saldo_inicial: Money.of(
        // Abertura e o saldo IMEDIATAMENTE ANTES da janela.
        this.ledger.balanceAsOf(account.availableLedgerAccountId, new Date(start.getTime() - 1)),
      ).toDecimalString(),
      saldo_final: Money.of(
        this.ledger.balanceAsOf(account.availableLedgerAccountId, end),
      ).toDecimalString(),
      moeda: 'BRL',
      proximo_cursor:
        temMais && ultima
          ? encodeStatementCursor({ at: ultima.effectiveAt.getTime(), id: ultima.id })
          : null,
      tem_mais: temMais,
    };
  }

  @Get(':id/onboarding')
  onboardingStatus(@Param('id') id: string) {
    const onboarding = this.onboarding.byAccount(id);
    if (!onboarding) return { dados: null };
    return { dados: serializeOnboarding(onboarding) };
  }

  /**
   * Envio de documento de onboarding.
   *
   * Corpo sao os BYTES CRUS (`application/octet-stream`), nao base64 dentro de
   * JSON: um RG fotografado passa facil de 10 MB, e base64 o infla em um
   * terco antes de o parser sequer decidir se aceita. Os metadados vao na
   * query e nos cabecalhos, que e o que a maioria dos BaaS brasileiros faz
   * para upload de documento.
   */
  @Post(':id/onboarding/documentos')
  async submitDocument(
    @Param('id') id: string,
    @Query('codigo') codigo: string,
    @Headers('content-type') contentType: string | undefined,
    @Headers('x-conteudo-sha256') declaredSha256: string | undefined,
    @Req() request: AuthedRequest,
  ) {
    const onboarding = this.onboarding.byAccount(id);
    if (!onboarding) {
      throw new MockBankError(
        'MB-ONB-404',
        `A conta ${id} nao possui caso de onboarding.`,
        404 as never,
      );
    }

    if (!codigo || !(codigo in RequirementCode)) {
      throw new MockBankError(
        'MB-ONB-422',
        `Informe ?codigo= com uma pendencia valida. Recebido: ${codigo ?? '(vazio)'}.`,
        422 as never,
      );
    }

    const bytes = await readBody(request);
    const result = this.onboarding.submitDocument(
      onboarding.id,
      RequirementCode[codigo as keyof typeof RequirementCode],
      {
        bytes,
        contentType: contentType ?? 'application/octet-stream',
        declaredSha256,
      },
    );

    return {
      documento_id: result.document.id,
      codigo: result.document.code,
      situacao: 'ACEITO',
      sha256: result.document.sha256,
      tamanho_bytes: result.document.sizeBytes,
      onboarding: serializeOnboarding(result.onboarding),
    };
  }
}

/** Limite de um documento de KYC. Acima disso e engano ou ataque. */
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

/**
 * Le o corpo em stream, com teto.
 *
 * Acumular sem limite deixaria qualquer cliente derrubar o processo com um
 * upload longo — e um banco de mentira que cai leva a suite e2e junto.
 */
function readBody(request: AuthedRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;

    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_DOCUMENT_BYTES) {
        request.destroy();
        reject(new MockBankError('MB-DOC-413', 'Documento acima de 20 MiB.', 413 as never));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

export function serializeOnboarding(onboarding: {
  id: string;
  accountId: string;
  type: string;
  status: string;
  requirements: Array<{ code: string; status: string }>;
  screenings: Array<{ type: string; result: string }>;
  rejectionCode?: string;
  rejectionMessage?: string;
  updatedAt: Date;
}) {
  return {
    id: onboarding.id,
    conta_id: onboarding.accountId,
    tipo: onboarding.type,
    situacao: onboarding.status,
    pendencias: onboarding.requirements
      .filter((r) => r.status === 'PENDING')
      .map((r) => ({ codigo: r.code, situacao: r.status })),
    verificacoes: onboarding.screenings.map((s) => ({ tipo: s.type, resultado: s.result })),
    motivo_recusa: onboarding.rejectionCode ?? null,
    mensagem_recusa: onboarding.rejectionMessage ?? null,
    atualizado_em: onboarding.updatedAt.toISOString(),
  };
}

/** Teto de pagina. Sem teto, um cliente pede 10^6 e derruba o processo. */
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

function clampLimit(raw?: string): number {
  const pedido = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(pedido) || pedido <= 0) return DEFAULT_LIMIT;
  return Math.min(pedido, MAX_LIMIT);
}

interface StatementPosition {
  at: number;
  id: string;
}

/**
 * Cursor opaco de keyset, nunca offset.
 *
 * Offset sobre uma tabela que recebe insert constante produz duplicata e
 * buraco; num extrato financeiro isso e defeito de correcao, nao de estilo.
 * Opaco de proposito: cliente que decodifica o cursor passa a depender do
 * formato, e o formato deixa de ser nosso.
 */
function encodeStatementCursor(position: StatementPosition): string {
  return Buffer.from(JSON.stringify(position), 'utf8').toString('base64url');
}

function decodeStatementCursor(raw: string): StatementPosition | undefined {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const { at, id } = parsed as StatementPosition;
    if (typeof at !== 'number' || typeof id !== 'string') return undefined;
    return { at, id };
  } catch {
    // Cursor ilegivel vira "primeira pagina" e nao 500: o cliente reabre a
    // consulta em vez de ver um erro que nao sabe tratar.
    return undefined;
  }
}

function serializeStatementLine(linha: StatementLine): Record<string, unknown> {
  const { payment } = linha;
  return {
    id: linha.id,
    categoria: linha.categoria,
    tipo: linha.direction === 'in' ? 'CREDITO' : 'DEBITO',
    valor: Money.of(linha.amountCents).toDecimalString(),
    tarifa: Money.of(linha.categoria === 'TARIFA' ? 0n : payment.feeCents).toDecimalString(),
    situacao: payment.status,
    // A linha de tarifa NAO carrega o E2EID do pagamento: sao globalmente
    // unicos, e repeti-lo faria a chave forte da conciliacao casar duas
    // linhas diferentes com a mesma transacao.
    end_to_end_id: linha.categoria === 'TARIFA' ? null : (payment.endToEndId ?? null),
    id_devolucao: payment.returnId ?? null,
    txid: payment.txid ?? null,
    contraparte: linha.categoria === 'TARIFA' ? null : payment.counterparty,
    descricao: linha.categoria === 'TARIFA' ? 'Tarifa de PIX' : (payment.description ?? null),
    data_movimento: payment.createdAt.toISOString(),
    data_liquidacao: linha.effectiveAt.toISOString(),
  };
}
