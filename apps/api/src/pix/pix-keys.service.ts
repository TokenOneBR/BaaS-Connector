import type { PixKeyDto } from '@baasconn/contracts';
import { BlindIndex } from '@baasconn/crypto';
import {
  ActorType,
  BaasError,
  BaasErrorCode,
  EventType,
  PixKeyStatus,
  PixKeyType,
  isValidPixKey,
  newId,
  normalizePixKey,
  type Clock,
  type Environment,
} from '@baasconn/taxonomy';
import { Inject, Injectable } from '@nestjs/common';

import type { ActorContext } from '../accounts/accounts.service.js';
import {
  ACCOUNT_REPOSITORY,
  type AccountRecord,
  type AccountRepository,
} from '../accounts/accounts.types.js';
import { CLOCK } from '../common/clock.js';
import {
  AUDIT_REPOSITORY,
  OUTBOX_REPOSITORY,
  type AuditRepository,
  type OutboxRepository,
} from '../events/outbox.types.js';
import { ProviderResolver } from '../providers/provider.resolver.js';

import { PIX_KEY_REPOSITORY, type PixKeyRecord, type PixKeyRepository } from './pix.types.js';

@Injectable()
export class PixKeysService {
  constructor(
    private readonly providers: ProviderResolver,
    private readonly blindIndex: BlindIndex,
    @Inject(ACCOUNT_REPOSITORY) private readonly accounts: AccountRepository,
    @Inject(PIX_KEY_REPOSITORY) private readonly keys: PixKeyRepository,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Registra uma chave no DICT, via provedor.
   *
   * O valor e normalizado ANTES de sair: "Joao@X.com" e "joao@x.com" sao a
   * mesma chave no DICT, e guardar as duas formas produz duas linhas que o
   * indice unico parcial nao consegue reconciliar.
   */
  async create(
    actor: ActorContext,
    accountId: string,
    input: { type: PixKeyType; value?: string },
  ): Promise<PixKeyRecord> {
    const account = await this.requireAccount(actor.environment, accountId);

    // EVP e a unica em que o valor vem do PSP; nas demais, validar aqui evita
    // uma ida ao provedor que ja se sabe que vai falhar.
    const normalized =
      input.type === PixKeyType.EVP || !input.value
        ? undefined
        : normalizePixKey(input.type, input.value);

    if (normalized && !isValidPixKey(input.type, normalized)) {
      throw new BaasError(BaasErrorCode.INVALID_PIX_KEY, {
        message: `Chave Pix invalida para o tipo ${input.type}.`,
      });
    }

    if (normalized) {
      const existing = await this.keys.findActiveByBlindIndex(
        actor.environment,
        this.blindIndex.pixKey(normalized),
      );
      if (existing) {
        if (existing.accountId !== accountId) {
          throw new BaasError(BaasErrorCode.PIX_KEY_ALREADY_EXISTS, {
            message: 'Esta chave ja esta registrada em outra conta deste ambiente.',
          });
        }
        // Mesma conta, mesma chave: repetir o registro e no-op, nao erro.
        return existing;
      }
    }

    const bound = await this.providers.require(actor.connectionId, 'pix.keys.create', {
      operationId: actor.operationId,
    });

    const created = await bound.adapter.pixKeys!.create(
      { providerAccountId: account.providerAccountId! },
      { type: input.type, value: normalized },
    );

    const value = normalizePixKey(created.type, created.value);
    const now = this.clock.now();

    const record: PixKeyRecord = {
      id: newId('pixKey'),
      environment: actor.environment,
      accountId,
      type: created.type,
      value,
      valueBlindIndex: this.blindIndex.pixKey(value),
      status: toKeyStatus(created.status),
      providerKeyId: created.providerKeyId ?? null,
      requestedAt: created.requestedAt ? new Date(created.requestedAt) : now,
      activatedAt: created.activatedAt ? new Date(created.activatedAt) : null,
      removedAt: null,
    };

    const stored = await this.keys.create(record);

    await this.outbox.append({
      environment: actor.environment,
      type: EventType.PIX_KEY_REGISTERED,
      provider: bound.slug,
      connectionId: actor.connectionId,
      subjectKind: 'pix_key',
      subjectId: stored.id,
      payload: { account_id: accountId, type: stored.type, status: stored.status },
      occurredAt: now,
    });

    return stored;
  }

  async list(environment: Environment, accountId: string): Promise<PixKeyRecord[]> {
    await this.requireAccount(environment, accountId);
    return this.keys.listByAccount(environment, accountId);
  }

  async remove(actor: ActorContext, accountId: string, keyId: string): Promise<void> {
    const account = await this.requireAccount(actor.environment, accountId);
    const key = await this.keys.findById(actor.environment, keyId);

    if (!key || key.accountId !== accountId) {
      throw new BaasError(BaasErrorCode.PIX_KEY_NOT_FOUND, {
        message: `Chave ${keyId} nao encontrada nesta conta.`,
      });
    }
    if (key.status === PixKeyStatus.REMOVED) return;

    const bound = await this.providers.require(actor.connectionId, 'pix.keys.delete', {
      operationId: actor.operationId,
    });
    await bound.adapter.pixKeys!.delete(
      { providerAccountId: account.providerAccountId! },
      key.value,
    );

    const now = this.clock.now();
    await this.keys.markRemoved(actor.environment, keyId, now);

    await this.audit.record({
      environment: actor.environment,
      actorType: ActorType.API_KEY,
      actorId: actor.apiKeyId,
      actorIp: actor.ip,
      action: 'pix_key.remove',
      outcome: 'SUCCESS',
      resourceType: 'pix_key',
      resourceId: keyId,
      connectionId: actor.connectionId,
      provider: bound.slug,
      after: { account_id: accountId, type: key.type },
      requestId: actor.requestId,
      occurredAt: now,
    });
  }

  /**
   * Consulta DICT de chave de terceiro.
   *
   * Informativa por definicao: o resultado NAO autoriza pagamento. O destino
   * e resolvido de novo na hora do envio, porque uma consulta antiga pode
   * apontar para uma conta que ja mudou de dono.
   */
  async resolve(actor: ActorContext, accountId: string, key: string) {
    const account = await this.requireAccount(actor.environment, accountId);
    const bound = await this.providers.require(actor.connectionId, 'pix.keys.resolve', {
      operationId: actor.operationId,
    });

    if (!bound.adapter.pixKeys?.resolve) {
      throw new BaasError(BaasErrorCode.CAPABILITY_NOT_SUPPORTED, {
        message: `${bound.slug} nao expoe consulta de chave no DICT.`,
      });
    }

    const resolution = await bound.adapter.pixKeys.resolve(
      { providerAccountId: account.providerAccountId! },
      key.trim(),
    );

    // Auditar TODA consulta de chave de terceiro: e dado pessoal de alguem que
    // nao e nosso cliente, e "quem consultou o nome de quem" e exatamente o
    // que a LGPD cobra.
    await this.audit.record({
      environment: actor.environment,
      actorType: ActorType.API_KEY,
      actorId: actor.apiKeyId,
      actorIp: actor.ip,
      action: 'pix_key.resolve',
      outcome: 'SUCCESS',
      resourceType: 'account',
      resourceId: accountId,
      connectionId: actor.connectionId,
      provider: bound.slug,
      after: { key_type: resolution.keyType },
      requestId: actor.requestId,
      occurredAt: this.clock.now(),
    });

    return resolution;
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

/**
 * Status de chave do provedor para o canonico.
 *
 * Desconhecido cai em PENDING_REGISTRATION, nunca em ACTIVE: tratar como ativa
 * uma chave cujo estado nao entendemos e o caminho para o cliente cobrar num
 * QR que o DICT ainda nao reconhece.
 */
export function toKeyStatus(raw: string): PixKeyStatus {
  const upper = raw.toUpperCase();
  if (upper in PixKeyStatus) return upper as PixKeyStatus;
  return PixKeyStatus.PENDING_REGISTRATION;
}

export function toPixKeyDto(record: PixKeyRecord): PixKeyDto {
  return {
    id: record.id,
    object: 'pix_key',
    account_id: record.accountId,
    type: record.type,
    value: record.value,
    status: record.status,
    claim: null,
    requested_at: record.requestedAt.toISOString(),
    activated_at: record.activatedAt?.toISOString() ?? null,
    removed_at: record.removedAt?.toISOString() ?? null,
  };
}
