import type { SendPixDto, TransactionDto } from '@baasconn/contracts';
import { BlindIndex } from '@baasconn/crypto';
import type { Counterparty, PixDestination, PixTransaction } from '@baasconn/provider-spi';
import {
  BaasError,
  BaasErrorCode,
  EventType,
  daysBetween,
  Money,
  PixInitiationMethod,
  PixPurpose,
  type PixRefundReasonCode,
  ProviderOutcomeUnknownError,
  TransactionDirection,
  TransactionStatus,
  TransactionType,
  toEffectiveDate,
  inferPixKeyType,
  newId,
  normalizePixKey,
  parseBrCode,
  type Clock,
  type Environment,
} from '@baasconn/taxonomy';
import { Inject, Injectable, Logger } from '@nestjs/common';

import type { ActorContext } from '../accounts/accounts.service.js';
import {
  ACCOUNT_REPOSITORY,
  type AccountRecord,
  type AccountRepository,
} from '../accounts/accounts.types.js';
import { CACHE_STORE, accountTag, type CacheStore } from '../cache/cache.types.js';
import { CLOCK } from '../common/clock.js';
import {
  EVENT_QUEUE,
  OUTBOX_REPOSITORY,
  type EventQueue,
  type OutboxRepository,
} from '../events/outbox.types.js';
import { ShadowLedgerService } from '../ledger/shadow-ledger.service.js';
import { ProviderResolver, type BoundProvider } from '../providers/provider.resolver.js';

import {
  OPERATION_REPOSITORY,
  TRANSACTION_REPOSITORY,
  type OperationRecord,
  type OperationRepository,
  type TransactionRecord,
  type TransactionRepository,
} from './pix.types.js';

/**
 * Resultado de um envio.
 *
 * `accepted` e o desfecho DESCONHECIDO: o controller responde 202 e o cliente
 * consulta `/v1/operations/:id` em vez de retentar. Um erro 5xx aqui seria
 * pior do que inutil — convidaria exatamente o retry que precisamos evitar.
 */
/** Janela do MED/BACEN para devolucao de um Pix recebido. */
const REFUND_WINDOW_DAYS = 90;

export type SendOutcome =
  | { kind: 'settled'; transaction: TransactionRecord }
  | { kind: 'accepted'; transaction: TransactionRecord; operation: OperationRecord };

@Injectable()
export class PixTransfersService {
  private readonly logger = new Logger(PixTransfersService.name);

  constructor(
    private readonly providers: ProviderResolver,
    private readonly ledger: ShadowLedgerService,
    private readonly blindIndex: BlindIndex,
    @Inject(ACCOUNT_REPOSITORY) private readonly accounts: AccountRepository,
    @Inject(TRANSACTION_REPOSITORY) private readonly transactions: TransactionRepository,
    @Inject(OPERATION_REPOSITORY) private readonly operations: OperationRepository,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository,
    @Inject(EVENT_QUEUE) private readonly queue: EventQueue,
    @Inject(CACHE_STORE) private readonly cache: CacheStore,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Envia um PIX.
   *
   * A ORDEM e a decisao que importa, e nao e a intuitiva:
   *
   * 1. resolve o destino (`emv`/`qr_code` viram chave ANTES de sair);
   * 2. AUTORIZA no razao sombra (PENDING) — o hold e o que faz uma segunda
   *    transferencia concorrente falhar. Autorizar depois da resposta do
   *    provedor deixa uma janela em que as duas veem o saldo cheio, e e assim
   *    que se paga duas vezes;
   * 3. chama o provedor com o NOSSO `operationId` como chave de idempotencia;
   * 4. sucesso -> transacao gravada com o hold ligado;
   * 5. recusa DETERMINISTICA -> `voidPending`, o hold e liberado;
   * 6. desfecho desconhecido -> 202 e o hold e MANTIDO. Liberar aqui seria
   *    devolver ao cliente um saldo que talvez ja tenha saido.
   */
  async send(
    actor: ActorContext,
    accountId: string,
    dto: SendPixDto,
    options: { reconcileFirst?: boolean } = {},
  ): Promise<SendOutcome> {
    const account = await this.requireAccount(actor.environment, accountId);
    const operationId = actor.operationId ?? newId('operation');
    const amount = Money.fromJSON(dto.amount);

    // Roubo de lease: a tentativa anterior pode ter chegado ao provedor.
    // Reenviar sem consultar e o caminho direto para o pagamento duplo.
    if (options.reconcileFirst) {
      const already = await this.transactions.findByIdempotencyKey(actor.environment, operationId);
      if (already) return { kind: 'settled', transaction: already };
    }

    const bound = await this.providers.require(actor.connectionId, 'pix.out.send', {
      operationId,
    });
    const destination = this.resolveDestination(dto);

    if (options.reconcileFirst) {
      const remote = await this.lookupAtProvider(bound, account, operationId);
      if (remote) {
        // O provedor ja tem a operacao: registra o que existe la, sem enviar
        // nada de novo.
        return {
          kind: 'settled',
          transaction: await this.recordSent({
            actor,
            account,
            bound,
            dto,
            destination,
            operationId,
            amount,
            sent: remote,
          }),
        };
      }
    }

    const hold = await this.ledger.authorizeOut({
      environment: actor.environment,
      availableId: this.requireLedgerAccount(account),
      amountCents: amount.cents,
      idempotencyKey: `pix-out:${operationId}`,
      externalRef: operationId,
    });

    let sent: PixTransaction;
    try {
      sent = await bound.adapter.pixTransfers!.send(
        { providerAccountId: account.providerAccountId },
        {
          idempotencyKey: operationId,
          amount: dto.amount,
          destination,
          description: dto.description,
          purpose: dto.purpose,
          initiationMethod: dto.initiation_method ?? initiationOf(destination),
          scheduledFor: dto.scheduled_for,
          metadata: dto.metadata,
        },
      );
    } catch (error) {
      if (error instanceof ProviderOutcomeUnknownError) {
        return this.onUnknownOutcome({
          actor,
          account,
          bound,
          dto,
          destination,
          operationId,
          amount,
          holdTransactionId: hold.transaction.id,
          error,
        });
      }

      // Recusa deterministica: o provedor decidiu e nao ha o que reconciliar.
      // O hold e liberado agora, porque segurar saldo do cliente por um
      // pagamento que comprovadamente nao aconteceu e um defeito visivel.
      await this.ledger.voidOut(
        actor.environment,
        hold.transaction.id,
        `pix-out-void:${operationId}`,
      );
      await this.invalidateBalance(actor.environment, accountId);
      throw error;
    }

    const transaction = await this.recordSent({
      actor,
      account,
      bound,
      dto,
      destination,
      operationId,
      amount,
      sent,
      holdTransactionId: hold.transaction.id,
    });

    await this.invalidateBalance(actor.environment, accountId);
    return { kind: 'settled', transaction };
  }

  /**
   * Devolve um PIX recebido.
   *
   * A devolucao e uma transacao NOVA, filha da original — nunca uma edicao da
   * original. Editar apagaria o fato de que o dinheiro entrou, e o extrato do
   * cliente deixaria de bater com o do banco.
   */
  async refund(
    actor: ActorContext,
    accountId: string,
    input: {
      transactionId?: string;
      originalEndToEndId?: string;
      amountCents?: bigint;
      reasonCode: PixRefundReasonCode;
      description?: string;
      externalId?: string;
    },
  ): Promise<TransactionRecord> {
    const account = await this.requireAccount(actor.environment, accountId);
    const operationId = actor.operationId ?? newId('operation');
    const original = await this.findOriginal(actor.environment, accountId, input);

    const endToEndId = original.pix?.endToEndId;
    if (!endToEndId) {
      throw new BaasError(BaasErrorCode.VALIDATION_ERROR, {
        message:
          'A transacao original ainda nao tem E2EID; sem ele o SPI nao aceita devolucao. ' +
          'Aguarde a liquidacao.',
      });
    }

    // Janela de 90 dias do MED/BACEN, verificada aqui e nao em cada adapter:
    // um adapter que a esquecesse mandaria ao provedor uma devolucao que ele
    // recusa, e o cliente veria um erro do provedor em vez do nosso.
    const settledAt = original.settledAt ?? original.requestedAt;
    if (daysBetween(settledAt, this.clock.now()) > REFUND_WINDOW_DAYS) {
      throw new BaasError(BaasErrorCode.REFUND_WINDOW_EXPIRED, {
        message: `A janela de ${REFUND_WINDOW_DAYS} dias para devolver esta transacao ja passou.`,
        meta: { settled_at: settledAt.toISOString() },
      });
    }

    const amount = input.amountCents ? Money.of(input.amountCents) : Money.of(original.amountCents);

    // Devolucoes sao ACUMULATIVAS: a soma nunca pode passar do original. A
    // regra e canonica, e nao de cada adapter, porque um adapter que a
    // esquecesse devolveria mais dinheiro do que entrou.
    if (original.refundedAmountCents + amount.cents > original.amountCents) {
      throw new BaasError(BaasErrorCode.REFUND_AMOUNT_EXCEEDS_ORIGINAL, {
        message: 'A soma das devolucoes ultrapassaria o valor da transacao original.',
        meta: {
          original_cents: original.amountCents.toString(),
          refunded_cents: original.refundedAmountCents.toString(),
          requested_cents: amount.cents.toString(),
        },
      });
    }

    const bound = await this.providers.require(actor.connectionId, 'pix.refund.create', {
      operationId,
    });
    if (!bound.adapter.pixTransfers?.refund) {
      throw new BaasError(BaasErrorCode.CAPABILITY_NOT_SUPPORTED, {
        message: `${bound.slug} nao suporta devolucao de Pix.`,
      });
    }

    // Devolver e mandar dinheiro embora: o hold vem antes da chamada, pela
    // mesma razao do PIX out.
    const hold = await this.ledger.authorizeOut({
      environment: actor.environment,
      availableId: this.requireLedgerAccount(account),
      amountCents: amount.cents,
      idempotencyKey: `pix-refund:${operationId}`,
      externalRef: operationId,
    });

    let refunded;
    try {
      refunded = await bound.adapter.pixTransfers.refund(
        { providerAccountId: account.providerAccountId },
        {
          idempotencyKey: operationId,
          originalEndToEndId: endToEndId,
          originalProviderTransactionId: original.providerTransactionId ?? undefined,
          amount: amount.toJSON(),
          reasonCode: input.reasonCode,
          description: input.description,
        },
      );
    } catch (error) {
      if (!(error instanceof ProviderOutcomeUnknownError)) {
        await this.ledger.voidOut(
          actor.environment,
          hold.transaction.id,
          `pix-refund-void:${operationId}`,
        );
        await this.invalidateBalance(actor.environment, accountId);
      }
      // Desfecho desconhecido mantem o hold, igual ao PIX out.
      throw error;
    }

    const now = this.clock.now();
    const transaction = await this.transactions.create({
      id: newId('transaction'),
      environment: actor.environment,
      accountId,
      parentTransactionId: original.id,
      type: TransactionType.PIX_REFUND_OUT,
      direction: TransactionDirection.DEBIT,
      status: refunded.status,
      lastEventAt: now,
      amountCents: amount.cents,
      feeCents: 0n,
      netAmountCents: amount.cents,
      refundedAmountCents: 0n,
      currency: 'BRL',
      description: input.description ?? null,
      provider: bound.slug,
      providerConnectionId: actor.connectionId,
      providerTransactionId: refunded.providerRefundId,
      externalId: input.externalId ?? null,
      idempotencyKey: operationId,
      operationId,
      effectiveDate: toEffectiveDate(now),
      requestedAt: now,
      settledAt: refunded.settledAt ? new Date(refunded.settledAt) : null,
      ledgerPendingTransactionId: hold.transaction.id,
      pix: {
        returnId: refunded.returnId ?? null,
        originalEndToEndId: endToEndId,
        initiationMethod: PixInitiationMethod.MANUAL,
        purpose: PixPurpose.TRANSFER,
        counterparty: original.pix?.counterparty ?? null,
        remittanceInfo: input.description ?? null,
      },
      metadata: {},
      createdAt: now,
      updatedAt: now,
    });

    await this.outbox.append({
      environment: actor.environment,
      type: EventType.PIX_REFUND_CREATED,
      provider: bound.slug,
      connectionId: actor.connectionId,
      subjectKind: 'transaction',
      subjectId: transaction.id,
      payload: {
        original_transaction_id: original.id,
        amount_cents: amount.cents.toString(),
        reason_code: input.reasonCode,
      },
      occurredAt: now,
    });

    await this.invalidateBalance(actor.environment, accountId);
    return transaction;
  }

  private async findOriginal(
    environment: Environment,
    accountId: string,
    input: { transactionId?: string; originalEndToEndId?: string },
  ): Promise<TransactionRecord> {
    const original = input.transactionId
      ? await this.transactions.findById(environment, input.transactionId)
      : await this.transactions.findByEndToEndId(environment, input.originalEndToEndId!);

    if (!original || original.accountId !== accountId) {
      throw new BaasError(BaasErrorCode.TRANSACTION_NOT_FOUND, {
        message: 'Transacao original nao encontrada nesta conta.',
      });
    }
    if (original.direction !== TransactionDirection.CREDIT) {
      throw new BaasError(BaasErrorCode.VALIDATION_ERROR, {
        message: 'So e possivel devolver um Pix recebido.',
      });
    }
    return original;
  }

  /**
   * Desfecho desconhecido.
   *
   * Grava a transacao em UNKNOWN, a operacao em UNKNOWN, e MANTEM o hold. O
   * ledger continua com o valor reservado porque a unica coisa que sabemos e
   * que nao sabemos: liberar devolveria ao cliente um saldo que talvez ja
   * tenha saido, e ele gastaria duas vezes o mesmo dinheiro.
   */
  private async onUnknownOutcome(input: {
    actor: ActorContext;
    account: AccountRecord & { providerAccountId: string };
    bound: BoundProvider;
    dto: SendPixDto;
    destination: PixDestination;
    operationId: string;
    amount: Money;
    holdTransactionId: string;
    error: ProviderOutcomeUnknownError;
  }): Promise<SendOutcome> {
    const now = this.clock.now();

    const transaction = await this.transactions.create(
      this.draft({
        actor: input.actor,
        account: input.account,
        bound: input.bound,
        dto: input.dto,
        destination: input.destination,
        operationId: input.operationId,
        amount: input.amount,
        status: TransactionStatus.UNKNOWN,
        holdTransactionId: input.holdTransactionId,
        now,
      }),
    );

    const operation = await this.operations.create({
      id: input.operationId,
      environment: input.actor.environment,
      connectionId: input.actor.connectionId,
      kind: 'pix.out',
      providerIdempotencyKey: input.operationId,
      status: 'UNKNOWN',
      requestDigest: transaction.id,
      accountId: input.account.id,
      amountCents: input.amount.cents,
      attempts: 1,
      lastError: { message: input.error.message },
      createdAt: now,
      updatedAt: now,
    });

    await this.outbox.append({
      environment: input.actor.environment,
      type: EventType.PIX_OUT_PENDING,
      provider: input.bound.slug,
      connectionId: input.actor.connectionId,
      subjectKind: 'transaction',
      subjectId: transaction.id,
      payload: { status: TransactionStatus.UNKNOWN, operation_id: operation.id },
      occurredAt: now,
    });

    // Degrau 0 da escada, pelo caminho quente. O varredor do worker cobre o
    // que for gravado com o Redis fora; enfileirar aqui e o que faz o caso
    // normal resolver em segundos em vez de esperar a proxima varredura, com
    // o saldo do cliente travado enquanto isso.
    await this.queue.enqueue({
      kind: 'operation_resolve',
      environment: input.actor.environment,
      operationId: operation.id,
      step: 0,
    });

    this.logger.warn(
      `PIX out ${transaction.id} sem desfecho conhecido; hold mantido, operacao ${operation.id}`,
    );

    return { kind: 'accepted', transaction, operation };
  }

  private async recordSent(input: {
    actor: ActorContext;
    account: AccountRecord & { providerAccountId: string };
    bound: BoundProvider;
    dto: SendPixDto;
    destination: PixDestination;
    operationId: string;
    amount: Money;
    sent: PixTransaction;
    holdTransactionId?: string;
  }): Promise<TransactionRecord> {
    const now = this.clock.now();

    const transaction = await this.transactions.create({
      ...this.draft({
        actor: input.actor,
        account: input.account,
        bound: input.bound,
        dto: input.dto,
        destination: input.destination,
        operationId: input.operationId,
        amount: input.amount,
        status: input.sent.status,
        holdTransactionId: input.holdTransactionId,
        now,
      }),
      providerTransactionId: input.sent.providerTransactionId,
      settledAt: input.sent.settledAt ? new Date(input.sent.settledAt) : null,
    });

    // O E2EID quase sempre chega nulo aqui: e gerado pelo PSP do PAGADOR e so
    // aparece em PROCESSING/SETTLED. Preenchemos quando vem, sem depender.
    if (input.sent.endToEndId && transaction.pix) {
      transaction.pix.endToEndId = input.sent.endToEndId;
    }
    if (input.sent.counterparty && transaction.pix) {
      transaction.pix.counterparty = this.toCounterparty(input.sent.counterparty);
    }

    await this.outbox.append({
      environment: input.actor.environment,
      type: EventType.PIX_OUT_PENDING,
      provider: input.bound.slug,
      connectionId: input.actor.connectionId,
      subjectKind: 'transaction',
      subjectId: transaction.id,
      payload: {
        status: transaction.status,
        amount_cents: input.amount.cents.toString(),
        end_to_end_id: input.sent.endToEndId ?? null,
      },
      occurredAt: now,
    });

    return transaction;
  }

  private draft(input: {
    actor: ActorContext;
    account: AccountRecord;
    bound: BoundProvider;
    dto: SendPixDto;
    destination: PixDestination;
    operationId: string;
    amount: Money;
    status: TransactionStatus;
    holdTransactionId?: string;
    now: Date;
  }): TransactionRecord {
    const key = input.destination.kind === 'pix_key' ? input.destination.key : undefined;

    return {
      id: newId('transaction'),
      environment: input.actor.environment,
      accountId: input.account.id,
      type: TransactionType.PIX_OUT,
      direction: TransactionDirection.DEBIT,
      status: input.status,
      lastEventAt: input.now,
      amountCents: input.amount.cents,
      feeCents: 0n,
      netAmountCents: input.amount.cents,
      refundedAmountCents: 0n,
      currency: 'BRL',
      description: input.dto.description ?? null,
      provider: input.bound.slug,
      providerConnectionId: input.actor.connectionId,
      externalId: input.dto.external_id ?? null,
      // A chave de idempotencia gravada e a NOSSA, nao a do cliente: e por ela
      // que a conciliacao consulta o provedor.
      idempotencyKey: input.operationId,
      operationId: input.operationId,
      effectiveDate: toEffectiveDate(input.now),
      requestedAt: input.now,
      ledgerPendingTransactionId: input.holdTransactionId ?? null,
      pix: {
        initiationMethod: input.dto.initiation_method ?? initiationOf(input.destination),
        purpose: input.dto.purpose ?? PixPurpose.TRANSFER,
        keyType: key ? (inferPixKeyType(key) ?? null) : null,
        keyValue: key ?? null,
        counterparty: this.destinationCounterparty(input.destination),
        remittanceInfo: input.dto.description ?? null,
      },
      metadata: input.dto.metadata ?? {},
      createdAt: input.now,
      updatedAt: input.now,
    };
  }

  /**
   * Resolve o destino para a forma que o adapter recebe.
   *
   * `emv` e `qr_code` sao PARSEADOS aqui, antes de sair. Repassar o payload
   * cru deixaria cada adapter reimplementando o codec do BACEN — e um deles
   * erraria, mandando o dinheiro para a chave errada com um QR sintaticamente
   * valido, que nenhum parser reclama.
   */
  private resolveDestination(dto: SendPixDto): PixDestination {
    const destination = dto.destination;

    if (destination.kind === 'pix_key') {
      const type = destination.key_type
        ? (destination.key_type as never)
        : inferPixKeyType(destination.key);
      if (!type) {
        throw new BaasError(BaasErrorCode.INVALID_PIX_KEY, {
          message: 'Nao foi possivel inferir o tipo desta chave Pix. Informe key_type.',
        });
      }
      return { kind: 'pix_key', key: normalizePixKey(type, destination.key), keyType: type };
    }

    if (destination.kind === 'bank_account') {
      // Renomeia para o vocabulario do SPI. O wire e snake_case por convencao
      // de fintech brasileira; o SPI e camelCase — a traducao acontece aqui,
      // uma vez, e nao em cada adapter.
      return {
        kind: 'bank_account',
        ispb: destination.ispb,
        branch: destination.branch,
        number: destination.number,
        checkDigit: destination.check_digit,
        accountType: destination.account_type,
        holder: {
          taxId: destination.holder.tax_id,
          name: destination.holder.name,
        },
      };
    }

    const payload = destination.kind === 'emv' ? destination.payload : destination.emv;
    const parsed = this.parseDestinationPayload(payload);

    if (parsed.isDynamic) {
      // Cobranca dinamica: a chave vive na URL do PSP, nao no payload. O
      // adapter precisa do payload inteiro para resolver com o provedor.
      return destination.kind === 'emv'
        ? { kind: 'emv', payload }
        : { kind: 'qr_code', txid: destination.txid, emv: payload };
    }

    if (!parsed.pixKey) {
      throw new BaasError(BaasErrorCode.INVALID_EMV_PAYLOAD, {
        message: 'O BR Code informado nao carrega chave Pix nem URL de cobranca.',
      });
    }

    const type = inferPixKeyType(parsed.pixKey);
    if (!type) {
      throw new BaasError(BaasErrorCode.INVALID_PIX_KEY, {
        message: 'A chave contida no BR Code nao corresponde a nenhum tipo conhecido.',
      });
    }

    return { kind: 'pix_key', key: normalizePixKey(type, parsed.pixKey), keyType: type };
  }

  private parseDestinationPayload(payload: string) {
    try {
      return parseBrCode(payload);
    } catch (error) {
      throw new BaasError(BaasErrorCode.INVALID_EMV_PAYLOAD, {
        message: `BR Code invalido: ${(error as Error).message}`,
        cause: error,
      });
    }
  }

  /** Consulta o provedor pela NOSSA chave. Nunca reenvia. */
  private async lookupAtProvider(
    bound: BoundProvider,
    account: AccountRecord & { providerAccountId: string },
    operationId: string,
  ): Promise<PixTransaction | undefined> {
    if (!bound.adapter.pixTransfers?.findByIdempotencyKey) return undefined;
    try {
      const found = await bound.adapter.pixTransfers.findByIdempotencyKey(
        { providerAccountId: account.providerAccountId },
        operationId,
      );
      return found ?? undefined;
    } catch (error) {
      this.logger.warn(`Consulta de reconciliacao falhou para ${operationId}: ${String(error)}`);
      return undefined;
    }
  }

  /**
   * Invalida o cache de saldo desta conta.
   *
   * Por TAG, nunca por SCAN: `SCAN` em caminho quente percorre o keyspace
   * inteiro e degrada o Redis para todos os clientes ao mesmo tempo.
   */
  private async invalidateBalance(environment: Environment, accountId: string): Promise<void> {
    await this.cache.invalidateTag(accountTag(environment, accountId));
  }

  private destinationCounterparty(destination: PixDestination) {
    if (destination.kind !== 'bank_account') return null;
    return {
      name: destination.holder.name,
      taxIdLast4: destination.holder.taxId.value.slice(-4),
      taxIdIndex: this.blindIndex.taxId(destination.holder.taxId.value),
      ispb: destination.ispb,
      branch: destination.branch,
      accountNumber: destination.number,
    };
  }

  private toCounterparty(counterparty: Counterparty) {
    return {
      name: counterparty.name ?? null,
      taxIdLast4: counterparty.taxId?.value.slice(-4) ?? null,
      taxIdIndex: counterparty.taxId ? this.blindIndex.taxId(counterparty.taxId.value) : null,
      ispb: counterparty.ispb ?? null,
      branch: counterparty.branch ?? null,
      accountNumber: counterparty.accountNumber ?? null,
    };
  }

  private requireLedgerAccount(account: AccountRecord): string {
    if (!account.ledgerAvailableAccountId) {
      throw new BaasError(BaasErrorCode.INTERNAL_ERROR, {
        message: `A conta ${account.id} nao tem conta de razao sombra aberta.`,
      });
    }
    return account.ledgerAvailableAccountId;
  }

  private async requireAccount(
    environment: Environment,
    accountId: string,
  ): Promise<AccountRecord & { providerAccountId: string }> {
    const account = await this.accounts.findById(environment, accountId);
    if (!account) {
      throw new BaasError(BaasErrorCode.ACCOUNT_NOT_FOUND, {
        message: `Conta ${accountId} nao encontrada.`,
      });
    }
    if (!account.providerAccountId) {
      throw new BaasError(BaasErrorCode.ACCOUNT_NOT_ACTIVE, {
        message: 'A conta ainda nao foi aberta no provedor.',
      });
    }
    return account as AccountRecord & { providerAccountId: string };
  }
}

function initiationOf(destination: PixDestination): PixInitiationMethod {
  switch (destination.kind) {
    case 'pix_key':
      return PixInitiationMethod.KEY;
    case 'bank_account':
      return PixInitiationMethod.MANUAL;
    case 'emv':
      return PixInitiationMethod.COPY_PASTE;
    case 'qr_code':
      return PixInitiationMethod.DYNAMIC_QRCODE;
  }
}

export function toTransactionDto(record: TransactionRecord): TransactionDto {
  return {
    id: record.id,
    object: 'transaction',
    account_id: record.accountId,
    type: record.type,
    direction: record.direction,
    status: record.status,
    amount: Money.of(record.amountCents).toJSON(),
    fee: Money.of(record.feeCents).toJSON(),
    net_amount: Money.of(record.netAmountCents).toJSON(),
    refunded_amount: Money.of(record.refundedAmountCents).toJSON(),
    description: record.description ?? null,
    provider: record.provider as TransactionDto['provider'],
    provider_transaction_id: record.providerTransactionId ?? null,
    external_id: record.externalId ?? null,
    charge_id: record.chargeId ?? null,
    parent_transaction_id: record.parentTransactionId ?? null,
    pix: record.pix
      ? {
          end_to_end_id: record.pix.endToEndId ?? null,
          return_id: record.pix.returnId ?? null,
          original_end_to_end_id: record.pix.originalEndToEndId ?? null,
          txid: record.pix.txid ?? null,
          initiation_method: record.pix.initiationMethod,
          purpose: record.pix.purpose,
          key_type: record.pix.keyType ?? null,
          // Chave de terceiro mascarada por padrao, como o documento.
          key_value: record.pix.keyValue ?? null,
          counterparty: record.pix.counterparty
            ? {
                name: record.pix.counterparty.name ?? null,
                tax_id: record.pix.counterparty.taxIdLast4
                  ? `***${record.pix.counterparty.taxIdLast4}`
                  : null,
                ispb: record.pix.counterparty.ispb ?? null,
                bank_name: null,
                branch: record.pix.counterparty.branch ?? null,
                account_number: record.pix.counterparty.accountNumber ?? null,
                account_type: null,
              }
            : null,
          remittance_info: record.pix.remittanceInfo ?? null,
          refund_reason_code: null,
          settlement_at: record.pix.settlementAt?.toISOString() ?? null,
        }
      : null,
    failure: record.failureCode
      ? {
          code: record.failureCode as NonNullable<TransactionDto['failure']>['code'],
          provider_code: record.providerFailureCode ?? null,
          message: record.failureMessage ?? '',
        }
      : null,
    effective_date: record.effectiveDate,
    created_at: record.createdAt.toISOString(),
    settled_at: record.settledAt?.toISOString() ?? null,
    failed_at: record.failedAt?.toISOString() ?? null,
    metadata: record.metadata,
  };
}
