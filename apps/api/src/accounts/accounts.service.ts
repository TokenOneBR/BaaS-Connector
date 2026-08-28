import type { CreateAccountDto } from '@baasconn/contracts';
import { BlindIndex, EnvelopeCrypto } from '@baasconn/crypto';
import type { CreateAccountPFInput, CreateAccountPJInput } from '@baasconn/provider-spi';
import {
  AccountKind,
  AccountStatus,
  ActorType,
  BaasError,
  BaasErrorCode,
  EventType,
  HolderType,
  newId,
  OnboardingStatus,
  OnboardingType,
  RequirementStatus,
  TaxIdType,
  maskTaxId,
  onlyDigits,
  type Clock,
  type Environment,
} from '@baasconn/taxonomy';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { CLOCK } from '../common/clock.js';
import {
  AUDIT_REPOSITORY,
  OUTBOX_REPOSITORY,
  type AuditRepository,
  type OutboxRepository,
} from '../events/outbox.types.js';
import { ProviderResolver } from '../providers/provider.resolver.js';

import {
  ACCOUNT_REPOSITORY,
  HOLDER_REPOSITORY,
  ONBOARDING_REPOSITORY,
  type AccountRecord,
  type AccountRepository,
  type HolderRecord,
  type HolderRepository,
  type ListAccountsFilter,
  type OnboardingRepository,
} from './accounts.types.js';

export interface ActorContext {
  environment: Environment;
  connectionId: string;
  apiKeyId: string;
  scopes: readonly string[];
  requestId?: string;
  operationId?: string;
  ip?: string;
}

@Injectable()
export class AccountsService {
  private readonly logger = new Logger(AccountsService.name);

  constructor(
    private readonly providers: ProviderResolver,
    private readonly crypto: EnvelopeCrypto,
    private readonly blindIndex: BlindIndex,
    @Inject(HOLDER_REPOSITORY) private readonly holders: HolderRepository,
    @Inject(ACCOUNT_REPOSITORY) private readonly accounts: AccountRepository,
    @Inject(ONBOARDING_REPOSITORY) private readonly onboardings: OnboardingRepository,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Cria uma conta no provedor e registra o espelho canonico.
   *
   * A ORDEM importa e nao e obvia. Gravamos a conta local ANTES de chamar o
   * provedor, com status DRAFT: se a chamada der timeout, existe uma linha
   * nossa para a conciliacao encontrar. Criar so depois da resposta
   * significaria que um desfecho desconhecido nao deixa rastro nenhum, e a
   * proxima tentativa do cliente abriria uma segunda conta para o mesmo CPF —
   * que e incidente de compliance, nao inconveniencia.
   */
  async create(dto: CreateAccountDto, actor: ActorContext): Promise<AccountRecord> {
    const now = this.clock.now();
    const taxIdDigits = onlyDigits(dto.holder.tax_id.value);
    const blind = this.blindIndex.taxId(taxIdDigits);

    if (dto.external_id) {
      const existing = await this.accounts.findByExternalId(actor.environment, dto.external_id);
      // Idempotencia de negocio, alem da de protocolo: o mesmo `external_id`
      // sempre aponta para a mesma conta, mesmo que o cliente tenha perdido a
      // resposta e trocado a Idempotency-Key.
      if (existing) return existing;
    }

    const holder = await this.resolveHolder(dto, taxIdDigits, blind, actor);

    const account: AccountRecord = {
      id: newId('account'),
      environment: actor.environment,
      holderId: holder.id,
      provider: '',
      providerConnectionId: actor.connectionId,
      externalId: dto.external_id ?? null,
      status: AccountStatus.DRAFT,
      kind: dto.kind ?? AccountKind.PAYMENT,
      currency: 'BRL',
      metadata: dto.metadata ?? {},
      createdAt: now,
      updatedAt: now,
    };

    const bound = await this.providers.require(
      actor.connectionId,
      holder.type === HolderType.BUSINESS ? 'accounts.create.pj' : 'accounts.create.pf',
      { operationId: actor.operationId },
    );
    account.provider = bound.slug;
    await this.accounts.create(account);

    const created =
      holder.type === HolderType.BUSINESS
        ? await bound.adapter.accounts!.createPJ(toCreatePJ(dto, account.id))
        : await bound.adapter.accounts!.createPF(toCreatePF(dto, account.id));

    const attached = await this.accounts.attachProviderAccount({
      environment: actor.environment,
      accountId: account.id,
      providerAccountId: created.providerAccountId,
      status: created.status,
      bank: created.bank,
      openedAt: created.openedAt ? new Date(created.openedAt) : undefined,
    });

    await this.seedOnboarding(attached, holder, bound, actor, now);

    await this.outbox.append({
      environment: actor.environment,
      type: EventType.ACCOUNT_CREATED,
      provider: bound.slug,
      connectionId: actor.connectionId,
      subjectKind: 'account',
      subjectId: attached.id,
      payload: { status: attached.status, holder_id: holder.id },
      occurredAt: now,
    });

    await this.audit.record({
      environment: actor.environment,
      actorType: ActorType.API_KEY,
      actorId: actor.apiKeyId,
      actorIp: actor.ip,
      action: 'account.create',
      outcome: 'SUCCESS',
      resourceType: 'account',
      resourceId: attached.id,
      connectionId: actor.connectionId,
      provider: bound.slug,
      // Mascarado ate na auditoria: a trilha e lida por mais gente do que a
      // tabela, e o valor completo continua recuperavel pelo envelope.
      after: {
        status: attached.status,
        holder_tax_id: maskTaxId({ type: holder.taxIdType, value: taxIdDigits }),
      },
      requestId: actor.requestId,
      operationId: actor.operationId,
      occurredAt: now,
    });

    return attached;
  }

  async get(environment: Environment, id: string): Promise<AccountRecord> {
    const account = await this.accounts.findById(environment, id);
    if (!account) {
      throw new BaasError(BaasErrorCode.ACCOUNT_NOT_FOUND, {
        message: `Conta ${id} nao encontrada.`,
      });
    }
    return account;
  }

  async list(filter: ListAccountsFilter) {
    return this.accounts.list(filter);
  }

  /**
   * Decifra o documento do titular.
   *
   * So chamado quando o chamador tem `pii:read`, e o controller audita o uso.
   * O envelope e por registro, entao decifrar um titular nao da acesso a
   * nenhum outro.
   */
  async revealTaxId(environment: Environment, holderId: string): Promise<string> {
    const envelope = await this.holders.taxIdEnvelope(environment, holderId);
    if (!envelope) {
      throw new BaasError(BaasErrorCode.RESOURCE_NOT_FOUND, {
        message: `Titular ${holderId} nao encontrado.`,
      });
    }
    return this.crypto.decryptToString(envelope, `holder:${holderId}`);
  }

  async holderOf(environment: Environment, holderId: string): Promise<HolderRecord> {
    const holder = await this.holders.findById(environment, holderId);
    if (!holder) {
      throw new BaasError(BaasErrorCode.RESOURCE_NOT_FOUND, {
        message: `Titular ${holderId} nao encontrado.`,
      });
    }
    return holder;
  }

  /** Bloqueio, desbloqueio e encerramento. */
  async changeStatus(
    environment: Environment,
    id: string,
    action: 'block' | 'unblock' | 'close',
    reason: string | undefined,
    actor: ActorContext,
  ): Promise<AccountRecord> {
    const account = await this.get(environment, id);
    if (!account.providerAccountId) {
      throw new BaasError(BaasErrorCode.ACCOUNT_NOT_ACTIVE, {
        message: 'A conta ainda nao foi criada no provedor.',
      });
    }

    const capability = action === 'close' ? 'accounts.close' : 'accounts.updateStatus';
    const bound = await this.providers.require(account.providerConnectionId, capability, {
      operationId: actor.operationId,
    });
    const ref = { providerAccountId: account.providerAccountId };

    const updated =
      action === 'close'
        ? await bound.adapter.accounts!.close(ref, { reason: reason ?? 'Encerramento solicitado' })
        : await bound.adapter.accounts!.updateStatus(ref, {
            blocked: action === 'block',
            reason,
          });

    const now = this.clock.now();
    const result = await this.accounts.applyStatusChange({
      environment,
      accountId: account.id,
      toStatus: updated.status,
      reasonMessage: reason,
      occurredAt: now,
      source: 'API',
      withinTransaction: async (accountId) => {
        await this.outbox.append({
          environment,
          type: eventForStatus(updated.status),
          provider: bound.slug,
          connectionId: account.providerConnectionId,
          subjectKind: 'account',
          subjectId: accountId,
          payload: { status: updated.status, reason },
          previous: { status: account.status },
          occurredAt: now,
        });
        await this.audit.record({
          environment,
          actorType: ActorType.API_KEY,
          actorId: actor.apiKeyId,
          actorIp: actor.ip,
          action: `account.${action}`,
          outcome: 'SUCCESS',
          resourceType: 'account',
          resourceId: accountId,
          connectionId: account.providerConnectionId,
          provider: bound.slug,
          before: { status: account.status },
          after: { status: updated.status },
          changedFields: ['status'],
          requestId: actor.requestId,
          operationId: actor.operationId,
          occurredAt: now,
        });
      },
    });

    return result.record ?? account;
  }

  /**
   * Acha ou cria o titular.
   *
   * A busca e pelo indice cego, nunca pelo documento em claro: e o que torna
   * "achar a conta do CPF X" possivel sem decifrar a tabela inteira, e um
   * vazamento so do banco nao entrega nem o documento nem um hash atacavel por
   * rainbow table, porque o pepper vive no KMS.
   */
  private async resolveHolder(
    dto: CreateAccountDto,
    taxIdDigits: string,
    blind: string,
    actor: ActorContext,
  ): Promise<HolderRecord> {
    const existing = await this.holders.findByTaxIdBlindIndex(actor.environment, blind);
    if (existing) return existing;

    const envelope = await this.crypto.encrypt(taxIdDigits);
    const type = dto.holder.type === 'BUSINESS' ? HolderType.BUSINESS : HolderType.INDIVIDUAL;

    return this.holders.create({
      record: {
        id: newId('holder'),
        environment: actor.environment,
        type,
        taxIdType: type === HolderType.BUSINESS ? TaxIdType.CNPJ : TaxIdType.CPF,
        taxIdBlindIndex: blind,
        taxIdLast4: taxIdDigits.slice(-4),
        legalName: dto.holder.legal_name,
        email: dto.holder.email,
        externalId: dto.holder.external_id ?? null,
      },
      taxIdEnvelope: {
        ciphertext: envelope.ciphertext,
        iv: envelope.iv,
        authTag: envelope.authTag,
        wrappedKey: envelope.wrappedKey,
        keyId: envelope.keyId,
      },
      emailBlindIndex: this.blindIndex.email(dto.holder.email),
      phone: {
        countryCode: dto.holder.phone.country_code,
        areaCode: dto.holder.phone.area_code,
        number: dto.holder.phone.number,
      },
    });
  }

  /**
   * Espelha o caso de onboarding que o provedor abriu.
   *
   * O Mock Bank cria o caso junto com a conta. Provedores que exigem submissao
   * explicita entram pela mesma porta: `submitKyb` da faceta, que ali e
   * EMULATED e aqui e a chamada normal.
   */
  private async seedOnboarding(
    account: AccountRecord,
    holder: HolderRecord,
    bound: Awaited<ReturnType<ProviderResolver['require']>>,
    actor: ActorContext,
    now: Date,
  ): Promise<void> {
    if (!bound.adapter.onboarding || !account.providerAccountId) return;

    const type = holder.type === HolderType.BUSINESS ? OnboardingType.KYB : OnboardingType.KYC;
    const ref = { providerAccountId: account.providerAccountId };

    try {
      const remote =
        type === OnboardingType.KYB
          ? await bound.adapter.onboarding.submitKyb(ref, {})
          : await bound.adapter.onboarding.submitKyc(ref, {});

      const caseId = newId('onboarding');
      await this.onboardings.create({
        id: caseId,
        environment: actor.environment,
        holderId: holder.id,
        accountId: account.id,
        provider: bound.slug,
        providerCaseId: remote.providerCaseId,
        type,
        status: remote.status,
        lastEventAt: null,
        rejectionCode: remote.decision?.reasonCode ?? null,
        rejectionMessage: remote.decision?.reason ?? null,
        providerRejectionCode: remote.decision?.providerReasonCode ?? null,
        submittedAt: now,
        decidedAt: null,
        requirements: remote.pendingRequirements.map((requirement) => ({
          id: newId('requirement'),
          caseId,
          code: requirement.code,
          status: RequirementStatus.PENDING,
          label: requirement.description,
          attempts: 0,
        })),
        createdAt: now,
        updatedAt: now,
      });

      await this.outbox.append({
        environment: actor.environment,
        type: EventType.ONBOARDING_SUBMITTED,
        provider: bound.slug,
        connectionId: actor.connectionId,
        subjectKind: 'onboarding',
        subjectId: caseId,
        payload: { status: remote.status, account_id: account.id },
        occurredAt: now,
      });
    } catch (error) {
      // O caso de onboarding e espelho, nao sistema de registro: falhar aqui
      // nao pode desfazer uma conta que o provedor JA criou. O webhook de
      // status ou a conciliacao preenchem depois.
      this.logger.warn(
        { err: error, account_id: account.id },
        'Nao foi possivel espelhar o onboarding na criacao da conta',
      );
    }
  }
}

function eventForStatus(status: AccountStatus): EventType {
  switch (status) {
    case AccountStatus.ACTIVE:
      return EventType.ACCOUNT_ACTIVATED;
    case AccountStatus.BLOCKED:
      return EventType.ACCOUNT_BLOCKED;
    case AccountStatus.CLOSED:
      return EventType.ACCOUNT_CLOSED;
    default:
      return EventType.ACCOUNT_STATUS_CHANGED;
  }
}

function toCreatePF(dto: CreateAccountDto, externalId: string): CreateAccountPFInput {
  const holder = dto.holder as Extract<CreateAccountDto['holder'], { type: 'INDIVIDUAL' }>;
  return {
    externalId,
    holder: {
      taxId: { type: TaxIdType.CPF, value: onlyDigits(holder.tax_id.value) },
      fullName: holder.legal_name,
      birthDate: holder.birth_date,
      motherName: holder.mother_name ?? undefined,
      email: holder.email,
      phone: {
        countryCode: holder.phone.country_code,
        areaCode: holder.phone.area_code,
        number: holder.phone.number,
      },
      addresses: holder.addresses.map(toAddress),
      isPoliticallyExposed: holder.is_politically_exposed,
    },
    metadata: dto.metadata,
  };
}

function toCreatePJ(dto: CreateAccountDto, externalId: string): CreateAccountPJInput {
  const holder = dto.holder as Extract<CreateAccountDto['holder'], { type: 'BUSINESS' }>;
  return {
    externalId,
    company: {
      taxId: { type: TaxIdType.CNPJ, value: onlyDigits(holder.tax_id.value) },
      legalName: holder.legal_name,
      tradeName: holder.trade_name ?? undefined,
      incorporationDate: holder.incorporation_date,
      mainCnae: holder.main_cnae ?? undefined,
      legalNatureCode: holder.legal_nature_code ?? undefined,
      email: holder.email,
      phone: {
        countryCode: holder.phone.country_code,
        areaCode: holder.phone.area_code,
        number: holder.phone.number,
      },
      addresses: holder.addresses.map(toAddress),
    },
    representatives: holder.representatives.map((representative) => ({
      role: representative.role,
      taxId: { type: TaxIdType.CPF, value: onlyDigits(representative.tax_id.value) },
      fullName: representative.full_name,
      birthDate: representative.birth_date,
      motherName: representative.mother_name ?? undefined,
      email: representative.email ?? undefined,
      ownershipPercentage: representative.ownership_percentage ?? undefined,
      isUltimateBeneficialOwner: representative.is_ultimate_beneficial_owner,
      isSigner: representative.is_signer,
      isPoliticallyExposed: representative.is_politically_exposed,
    })),
    metadata: dto.metadata,
  };
}

function toAddress(address: CreateAccountDto['holder']['addresses'][number]) {
  return {
    postalCode: address.postal_code,
    street: address.street,
    number: address.number,
    complement: address.complement ?? undefined,
    district: address.district,
    city: address.city,
    state: address.state,
    country: 'BR' as const,
    ibgeCityCode: address.ibge_city_code ?? undefined,
  };
}

export { OnboardingStatus };
