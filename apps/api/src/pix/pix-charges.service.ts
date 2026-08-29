import type { CreateChargeDto, PixChargeDto } from '@baasconn/contracts';
import type { CreateDynamicChargeInput, PixCharge } from '@baasconn/provider-spi';
import {
  BaasError,
  BaasErrorCode,
  EventType,
  Money,
  PixChargeKind,
  PixChargeStatus,
  newId,
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
import { CLOCK } from '../common/clock.js';
import { ApiConfig } from '../config/config.service.js';
import { OUTBOX_REPOSITORY, type OutboxRepository } from '../events/outbox.types.js';
import { ProviderResolver } from '../providers/provider.resolver.js';

import {
  PIX_CHARGE_REPOSITORY,
  PIX_KEY_REPOSITORY,
  type PixChargeRecord,
  type PixChargeRepository,
  type PixKeyRepository,
} from './pix.types.js';

@Injectable()
export class PixChargesService {
  private readonly logger = new Logger(PixChargesService.name);

  constructor(
    private readonly providers: ProviderResolver,
    private readonly config: ApiConfig,
    @Inject(ACCOUNT_REPOSITORY) private readonly accounts: AccountRepository,
    @Inject(PIX_KEY_REPOSITORY) private readonly keys: PixKeyRepository,
    @Inject(PIX_CHARGE_REPOSITORY) private readonly charges: PixChargeRepository,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async create(
    actor: ActorContext,
    accountId: string,
    dto: CreateChargeDto,
  ): Promise<PixChargeRecord> {
    const account = await this.requireAccount(actor.environment, accountId);

    const key = await this.keys.findById(actor.environment, dto.pix_key_id);
    if (!key || key.accountId !== accountId) {
      throw new BaasError(BaasErrorCode.PIX_KEY_NOT_FOUND, {
        message: `Chave ${dto.pix_key_id} nao encontrada nesta conta.`,
      });
    }

    const capability =
      dto.kind === PixChargeKind.STATIC
        ? ('pix.charge.static.create' as const)
        : ('pix.charge.dynamic.create' as const);

    const bound = await this.providers.require(actor.connectionId, capability, {
      operationId: actor.operationId,
    });

    const ref = { providerAccountId: account.providerAccountId };
    const base = {
      pixKey: key.value,
      amount: dto.amount,
      payerRequest: dto.payer_request,
      merchantName: this.config.merchantName,
      merchantCity: this.config.merchantCity,
    };

    const created =
      dto.kind === PixChargeKind.STATIC
        ? await bound.adapter.pixCharges!.createStatic(ref, { ...base, txid: dto.txid })
        : await bound.adapter.pixCharges!.createDynamic(ref, {
            ...base,
            ...dynamicFields(dto),
            amountIsChangeable: dto.amount_is_changeable,
            payer: dto.payer
              ? { taxId: { type: dto.payer.tax_id.type, value: dto.payer.tax_id.value }, name: dto.payer.name }
              : undefined,
            additionalInfo: dto.additional_info,
          });

    this.assertEmvIsUsable(created, key.value);

    const now = this.clock.now();
    const record: PixChargeRecord = {
      id: newId('pixCharge'),
      environment: actor.environment,
      accountId,
      pixKeyId: key.id,
      kind: dto.kind,
      txid: created.txid,
      status: created.status,
      revision: created.revision ?? 0,
      amountCents: created.amount ? Money.fromJSON(created.amount).cents : null,
      paidAmountCents: 0n,
      amountIsChangeable: dto.kind === PixChargeKind.STATIC ? false : dto.amount_is_changeable,
      currency: 'BRL',
      expiresAt: created.expiresAt ? new Date(created.expiresAt) : null,
      emvPayload: created.emvPayload,
      provider: bound.slug,
      providerChargeId: created.txid,
      externalId: dto.external_id ?? null,
      paidAt: null,
      lastEventAt: null,
      metadata: dto.metadata ?? {},
      createdAt: now,
      updatedAt: now,
    };

    const stored = await this.charges.create(record);

    await this.outbox.append({
      environment: actor.environment,
      type: EventType.PIX_CHARGE_CREATED,
      provider: bound.slug,
      connectionId: actor.connectionId,
      subjectKind: 'pix_charge',
      subjectId: stored.id,
      payload: { account_id: accountId, txid: stored.txid, kind: stored.kind },
      occurredAt: now,
    });

    return stored;
  }

  async get(environment: Environment, accountId: string, txid: string): Promise<PixChargeRecord> {
    const charge = await this.charges.findByTxid(environment, txid);
    if (!charge || charge.accountId !== accountId) {
      throw new BaasError(BaasErrorCode.CHARGE_NOT_FOUND, {
        message: `Cobranca ${txid} nao encontrada nesta conta.`,
      });
    }
    return charge;
  }

  async list(
    environment: Environment,
    accountId: string,
    limit: number,
  ): Promise<PixChargeRecord[]> {
    await this.requireAccount(environment, accountId);
    return this.charges.listByAccount(environment, accountId, limit);
  }

  async cancel(actor: ActorContext, accountId: string, txid: string): Promise<PixChargeRecord> {
    const account = await this.requireAccount(actor.environment, accountId);
    const charge = await this.get(actor.environment, accountId, txid);

    const bound = await this.providers.require(actor.connectionId, 'pix.charge.cancel', {
      operationId: actor.operationId,
    });
    if (!bound.adapter.pixCharges?.cancel) {
      throw new BaasError(BaasErrorCode.CAPABILITY_NOT_SUPPORTED, {
        message: `${bound.slug} nao permite cancelar cobranca.`,
      });
    }

    await bound.adapter.pixCharges.cancel(
      { providerAccountId: account.providerAccountId },
      charge.txid,
    );

    const result = await this.charges.applyStatusChange({
      environment: actor.environment,
      txid: charge.txid,
      toStatus: PixChargeStatus.REMOVED_BY_USER,
      occurredAt: this.clock.now(),
    });

    // O provedor ja cancelou; o guard so recusa se a cobranca ja estava num
    // estado terminal. Devolver o registro atual e mais util do que um erro
    // por uma corrida que nao muda o desfecho.
    return result.record ?? (await this.get(actor.environment, accountId, txid));
  }

  /**
   * Valida o BR Code devolvido pelo provedor ANTES de grava-lo.
   *
   * Provedor devolver EMV malformado em sandbox e comum. Guardar sem conferir
   * significa que o QR Code falha no balcao — com o erro aparecendo do lado do
   * cliente, nao do nosso, horas depois e sem rastro.
   */
  private assertEmvIsUsable(charge: PixCharge, expectedKey: string): void {
    if (!charge.emvPayload) {
      throw new BaasError(BaasErrorCode.PROVIDER_REJECTED, {
        message: 'O provedor devolveu a cobranca sem payload copia-e-cola.',
        meta: { txid: charge.txid },
      });
    }

    let parsed;
    try {
      parsed = parseBrCode(charge.emvPayload);
    } catch (error) {
      throw new BaasError(BaasErrorCode.PROVIDER_REJECTED, {
        message: 'O provedor devolveu um BR Code invalido.',
        meta: { txid: charge.txid, reason: (error as Error).message },
        cause: error,
      });
    }

    // Chave divergente e o caso perigoso: o QR e VALIDO, entao nenhum parser
    // reclama — o dinheiro simplesmente vai para outra conta.
    if (!parsed.isDynamic && parsed.pixKey && parsed.pixKey !== expectedKey) {
      throw new BaasError(BaasErrorCode.PROVIDER_REJECTED, {
        message: 'O BR Code devolvido aponta para uma chave diferente da solicitada.',
        meta: { txid: charge.txid },
      });
    }
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

function dynamicFields(dto: CreateChargeDto): Partial<CreateDynamicChargeInput> {
  if (dto.kind === PixChargeKind.DYNAMIC_IMMEDIATE) {
    return { expiresInSeconds: dto.expires_in_seconds };
  }
  if (dto.kind === PixChargeKind.DYNAMIC_DUE) {
    return {
      dueDate: dto.due_date,
      validAfterDueDays: dto.valid_after_due_days,
      fine: dto.fine,
      interest: dto.interest,
      discounts: dto.discounts,
    };
  }
  return {};
}

export function toPixChargeDto(record: PixChargeRecord): PixChargeDto {
  return {
    id: record.id,
    object: 'pix_charge',
    account_id: record.accountId,
    kind: record.kind,
    txid: record.txid,
    status: record.status,
    revision: record.revision,
    amount: record.amountCents == null ? null : Money.of(record.amountCents).toJSON(),
    amount_is_changeable: record.amountIsChangeable,
    emv_payload: record.emvPayload,
    qr_code_image_url: null,
    location_url: null,
    expires_at: record.expiresAt?.toISOString() ?? null,
    due_date: null,
    paid_amount: Money.of(record.paidAmountCents).toJSON(),
    paid_at: record.paidAt?.toISOString() ?? null,
    paid_transaction_ids: [],
    external_id: record.externalId ?? null,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
  };
}
