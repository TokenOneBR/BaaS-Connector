import {
  EntryDirection,
  EntryPhase,
  InsufficientFundsError,
  LedgerEngine,
  LedgerTransactionType,
  LEDGER_CODES,
  computeBalances,
  customerAccountTemplates,
  customerAvailableCode,
  customerBlockedCode,
  type Balances,
  type LedgerEntry,
  type PostTransactionResult,
} from '@baasconn/ledger';
import { BaasError, BaasErrorCode, newId, type Clock, type Environment } from '@baasconn/taxonomy';
import { Inject, Injectable } from '@nestjs/common';

import { CLOCK } from '../common/clock.js';

import { LEDGER_STORE_FACTORY, type LedgerStoreFactory } from './ledger.types.js';

/**
 * Uma transacao do razao, vista da conta do cliente.
 *
 * `amountCents` e o efeito LIQUIDO na conta, sempre positivo, com o sinal em
 * `direction` — a mesma convencao do item normalizado da conciliacao.
 */
export interface LedgerMovement {
  /** Id do lancamento representante. Vira o id do item de conciliacao. */
  entryId: string;
  transactionId: string;
  type: LedgerTransactionType;
  direction: 'CREDIT' | 'DEBIT';
  amountCents: bigint;
  effectiveAt: Date;
}

export interface CustomerAccounts {
  availableId: string;
  blockedId: string;
}

/**
 * Ledger sombra do conector.
 *
 * O conector NUNCA custodia recurso — o provedor e o sistema de registro.
 * Este razao existe para conciliar em tres vias (provedor x nossos registros x
 * razao) e pegar a classe de bug que custa dinheiro: transacao registrada com
 * lancamento errado.
 *
 * Espelha SO O LADO DO CLIENTE. As pernas do banco — clearing de PIX out
 * (`2200`) e receita de tarifa (`4000`) — sao livros do BaaS, nao nossos;
 * registra-las aqui contaria como nosso um dinheiro que nunca esteve conosco,
 * e um relatorio contabil tirado dali estaria errado. O outro lado de toda
 * transacao vai para `9000` (mundo externo), a unica conta com
 * `allowsNegative`, que existe precisamente para tudo fechar sem caso
 * especial. Ver ADR 0014.
 *
 * As DUAS FASES sao preservadas: um PIX out nao e atomico. Sem a fase
 * pendente, ou debitamos otimista e escrevemos lancamento compensatorio na
 * falha — poluindo o extrato do cliente com transacoes fantasma — ou debitamos
 * so na liquidacao e permitimos double-spend na janela.
 */
@Injectable()
export class ShadowLedgerService {
  constructor(
    @Inject(LEDGER_STORE_FACTORY) private readonly stores: LedgerStoreFactory,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Abre o par de contas do cliente.
   *
   * Duas contas por cliente, e nao uma com campo `blocked`, porque bloqueio e
   * movimento real: precisa aparecer no extrato e ser auditavel.
   */
  async openAccounts(environment: Environment, accountId: string): Promise<CustomerAccounts> {
    const store = this.stores.for(environment);
    const byCode = await store.ensureAccounts(customerAccountTemplates(accountId), () =>
      newId('ledgerAccount'),
    );

    const availableId = byCode.get(customerAvailableCode(accountId));
    const blockedId = byCode.get(customerBlockedCode(accountId));
    if (!availableId || !blockedId) {
      throw new BaasError(BaasErrorCode.INTERNAL_ERROR, {
        message: `Nao foi possivel abrir as contas de razao de ${accountId}.`,
      });
    }

    return { availableId, blockedId };
  }

  /** PIX in: o dinheiro entra do mundo externo para o disponivel do cliente. */
  async creditIn(input: {
    environment: Environment;
    availableId: string;
    amountCents: bigint;
    idempotencyKey: string;
    externalRef?: string;
    description?: string;
  }): Promise<PostTransactionResult> {
    return this.post(input.environment, {
      type: LedgerTransactionType.PIX_IN_RECEIVE,
      phase: EntryPhase.POSTED,
      idempotencyKey: input.idempotencyKey,
      externalRef: input.externalRef,
      description: input.description,
      entries: [
        {
          accountId: await this.externalId(input.environment),
          direction: EntryDirection.DEBIT,
          amountCents: input.amountCents,
        },
        {
          accountId: input.availableId,
          direction: EntryDirection.CREDIT,
          amountCents: input.amountCents,
        },
      ],
    });
  }

  /**
   * Autoriza um PIX out: reserva o valor, sem move-lo ainda.
   *
   * E o hold que faz uma segunda transferencia concorrente falhar. Autorizar
   * depois da resposta do provedor deixa uma janela em que duas transferencias
   * veem o saldo cheio — e e assim que se paga duas vezes.
   */
  async authorizeOut(input: {
    environment: Environment;
    availableId: string;
    amountCents: bigint;
    idempotencyKey: string;
    externalRef?: string;
  }): Promise<PostTransactionResult> {
    return this.post(input.environment, {
      type: LedgerTransactionType.PIX_OUT_AUTHORIZE,
      phase: EntryPhase.PENDING,
      idempotencyKey: input.idempotencyKey,
      externalRef: input.externalRef,
      entries: [
        {
          accountId: input.availableId,
          direction: EntryDirection.DEBIT,
          amountCents: input.amountCents,
        },
        {
          accountId: await this.externalId(input.environment),
          direction: EntryDirection.CREDIT,
          amountCents: input.amountCents,
        },
      ],
    });
  }

  /** Liquidacao confirmada: a reserva vira movimento. */
  async settleOut(
    environment: Environment,
    pendingTransactionId: string,
    idempotencyKey: string,
  ): Promise<PostTransactionResult> {
    return this.run(environment, (engine) =>
      engine.commitPending(pendingTransactionId, {
        idempotencyKey,
        type: LedgerTransactionType.PIX_OUT_SETTLE,
      }),
    );
  }

  /**
   * Falha confirmada: a reserva e desfeita.
   *
   * Os lancamentos de fase VOID ficam no extrato, mostrando que houve
   * tentativa sem que ela tenha movido dinheiro.
   */
  async voidOut(
    environment: Environment,
    pendingTransactionId: string,
    idempotencyKey: string,
  ): Promise<PostTransactionResult> {
    return this.run(environment, (engine) =>
      engine.voidPending(pendingTransactionId, {
        idempotencyKey,
        type: LedgerTransactionType.PIX_OUT_VOID,
      }),
    );
  }

  /** Devolucao enviada: sai do disponivel do cliente. */
  async refundOut(input: {
    environment: Environment;
    availableId: string;
    amountCents: bigint;
    idempotencyKey: string;
    externalRef?: string;
  }): Promise<PostTransactionResult> {
    return this.post(input.environment, {
      type: LedgerTransactionType.PIX_REFUND_OUT,
      phase: EntryPhase.POSTED,
      idempotencyKey: input.idempotencyKey,
      externalRef: input.externalRef,
      entries: [
        {
          accountId: input.availableId,
          direction: EntryDirection.DEBIT,
          amountCents: input.amountCents,
        },
        {
          accountId: await this.externalId(input.environment),
          direction: EntryDirection.CREDIT,
          amountCents: input.amountCents,
        },
      ],
    });
  }

  /** Devolucao recebida: entra no disponivel do cliente. */
  async refundIn(input: {
    environment: Environment;
    availableId: string;
    amountCents: bigint;
    idempotencyKey: string;
    externalRef?: string;
  }): Promise<PostTransactionResult> {
    return this.post(input.environment, {
      type: LedgerTransactionType.PIX_REFUND_IN,
      phase: EntryPhase.POSTED,
      idempotencyKey: input.idempotencyKey,
      externalRef: input.externalRef,
      entries: [
        {
          accountId: await this.externalId(input.environment),
          direction: EntryDirection.DEBIT,
          amountCents: input.amountCents,
        },
        {
          accountId: input.availableId,
          direction: EntryDirection.CREDIT,
          amountCents: input.amountCents,
        },
      ],
    });
  }

  /** Bloqueio e desbloqueio movem entre as duas contas do proprio cliente. */
  async moveBlocked(input: {
    environment: Environment;
    availableId: string;
    blockedId: string;
    amountCents: bigint;
    idempotencyKey: string;
    unblock?: boolean;
  }): Promise<PostTransactionResult> {
    const from = input.unblock ? input.blockedId : input.availableId;
    const to = input.unblock ? input.availableId : input.blockedId;

    return this.post(input.environment, {
      type: input.unblock ? LedgerTransactionType.UNBLOCK_FUNDS : LedgerTransactionType.BLOCK_FUNDS,
      phase: EntryPhase.POSTED,
      idempotencyKey: input.idempotencyKey,
      entries: [
        { accountId: from, direction: EntryDirection.DEBIT, amountCents: input.amountCents },
        { accountId: to, direction: EntryDirection.CREDIT, amountCents: input.amountCents },
      ],
    });
  }

  async balances(environment: Environment, ledgerAccountId: string): Promise<Balances> {
    const store = this.stores.for(environment);
    const locked = await store.lockAccounts([ledgerAccountId]);
    const account = locked.get(ledgerAccountId);
    if (!account) {
      throw new BaasError(BaasErrorCode.RESOURCE_NOT_FOUND, {
        message: `Conta de razao ${ledgerAccountId} nao encontrada.`,
      });
    }
    return computeBalances(account);
  }

  /**
   * Lancamentos de uma conta, para o extrato do razao.
   *
   * PENDING fica de fora e VOID fica dentro: uma reserva em voo nao e
   * movimento, mas uma tentativa desfeita e um fato que o operador precisa
   * ver ao depurar um break.
   */
  async entries(
    environment: Environment,
    ledgerAccountId: string,
    from: Date,
    to: Date,
  ): Promise<LedgerEntry[]> {
    return this.stores.for(environment).entriesInWindow(ledgerAccountId, from, to);
  }

  /**
   * Movimentos da janela, agregados POR TRANSACAO.
   *
   * Um `LedgerEntry` e meia transacao. Quem concilia precisa da transacao
   * inteira — e do TIPO dela, que o lancamento nao carrega — senao contaria
   * cada movimento duas vezes e a conferencia de saldo dobraria.
   *
   * `VOID` fica de fora, ao contrario de `entries`: uma reserva desfeita e um
   * fato util para depurar, mas nao e movimento — o provedor nunca vai ter
   * contraparte para ela, e ela viraria um lancamento orfao CRITICAL falso.
   */
  async movements(
    environment: Environment,
    ledgerAccountId: string,
    from: Date,
    to: Date,
  ): Promise<LedgerMovement[]> {
    const store = this.stores.for(environment);
    const entries = await store.entriesInWindow(ledgerAccountId, from, to);

    const porTransacao = new Map<string, LedgerEntry[]>();
    for (const entry of entries) {
      if (entry.phase !== EntryPhase.POSTED) continue;
      porTransacao.set(entry.transactionId, [
        ...(porTransacao.get(entry.transactionId) ?? []),
        entry,
      ]);
    }

    const movimentos: LedgerMovement[] = [];
    for (const [transactionId, doGrupo] of porTransacao) {
      const transaction = await store.findTransaction(transactionId);
      if (!transaction) continue;

      // Menor id primeiro: o representante nao pode depender da ordem em que
      // o SELECT devolveu as linhas, senao duas execucoes da mesma janela
      // produzem ids de item diferentes.
      const ordenados = [...doGrupo].sort((a, b) => a.id.localeCompare(b.id));
      const total = ordenados.reduce(
        (soma, entry) =>
          soma +
          (entry.direction === EntryDirection.CREDIT ? entry.amountCents : -entry.amountCents),
        0n,
      );

      movimentos.push({
        entryId: ordenados[0]!.id,
        transactionId,
        type: transaction.type,
        direction: total >= 0n ? 'CREDIT' : 'DEBIT',
        amountCents: total < 0n ? -total : total,
        effectiveAt: ordenados[0]!.effectiveAt,
      });
    }

    return movimentos.sort((a, b) => a.entryId.localeCompare(b.entryId));
  }

  private async post(
    environment: Environment,
    input: Omit<Parameters<LedgerEngine['post']>[0], 'effectiveAt'>,
  ): Promise<PostTransactionResult> {
    return this.run(environment, (engine) =>
      engine.post({ ...input, effectiveAt: this.clock.now() }),
    );
  }

  /**
   * Executa sob o lock do store e traduz o erro do motor.
   *
   * `InsufficientFundsError` vira o codigo canonico com os valores no corpo:
   * "saldo insuficiente" sem dizer quanto ha e quanto faltou obriga o cliente
   * a uma segunda chamada para descobrir.
   */
  private async run<T>(
    environment: Environment,
    fn: (engine: LedgerEngine) => Promise<T>,
  ): Promise<T> {
    const store = this.stores.for(environment);
    try {
      return await store.runExclusive(() => fn(store.engine));
    } catch (error) {
      if (error instanceof InsufficientFundsError) {
        throw new BaasError(BaasErrorCode.INSUFFICIENT_FUNDS, {
          message: 'Saldo insuficiente para esta operacao.',
          meta: {
            requested_cents: error.requested.toString(),
            available_cents: error.available.toString(),
          },
          cause: error,
        });
      }
      throw error;
    }
  }

  private async externalId(environment: Environment): Promise<string> {
    const store = this.stores.for(environment);
    const id = await store.accountIdByCode(LEDGER_CODES.EXTERNAL_WORLD);
    if (!id) {
      throw new BaasError(BaasErrorCode.INTERNAL_ERROR, {
        message: `A conta de razao ${LEDGER_CODES.EXTERNAL_WORLD} nao foi semeada.`,
      });
    }
    return id;
  }
}
