import { randomBytes } from 'node:crypto';

import { API_SCOPES } from '@baasconn/contracts';
import { EnvelopeCrypto, generateApiKey, hashSecret, secretLookup } from '@baasconn/crypto';
import {
  ActorType,
  BaasError,
  BaasErrorCode,
  Environment,
  newId,
  type Clock,
} from '@baasconn/taxonomy';
import { Inject, Injectable } from '@nestjs/common';

import {
  API_KEY_REPOSITORY,
  type ApiKeyRecord,
  type ApiKeyRepository,
} from '../auth/api-key.service.js';
import { CLOCK } from '../common/clock.js';
import { AUDIT_REPOSITORY, type AuditRepository } from '../events/outbox.types.js';

/**
 * O segredo recem-cunhado, que existe UMA vez.
 *
 * Tipo proprio, e nao `string`, para nenhum caminho de leitura conseguir
 * construi-lo por engano: so `create` o produz, e so o DTO de criacao o
 * aceita. Nao existe rota que devolva isto de novo, e nao pode existir —
 * revogar e cunhar de novo e a unica rotacao. Uma rota de "rotacionar no
 * lugar" seria uma rota com segredo no corpo, que alguem eventualmente torna
 * idempotente e passa a repetir.
 */
export interface MintedApiKey {
  record: ApiKeyRecord;
  secret: string;
  signingSecret?: string;
}

@Injectable()
export class ApiKeysService {
  constructor(
    @Inject(API_KEY_REPOSITORY) private readonly keys: ApiKeyRepository,
    private readonly crypto: EnvelopeCrypto,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  list(environment: Environment, status?: string): Promise<ApiKeyRecord[]> {
    return this.keys.list(environment, status);
  }

  async create(input: {
    environment: Environment;
    name: string;
    scopes: string[];
    expiresAt?: Date;
    ipAllowlist: string[];
    defaultConnectionId?: string;
    signingRequired?: boolean;
    actorId: string;
  }): Promise<MintedApiKey> {
    const desconhecidos = input.scopes.filter(
      (scope) => !(API_SCOPES as readonly string[]).includes(scope),
    );
    if (desconhecidos.length > 0) {
      throw new BaasError(BaasErrorCode.VALIDATION_ERROR, {
        message: `Escopos desconhecidos: ${desconhecidos.join(', ')}.`,
      });
    }

    const assinaturaObrigatoria = this.resolveSigning(input);

    const now = this.clock.now();
    const id = newId('apiKey');
    const generated = generateApiKey({ environment: input.environment, keyId: id });

    // Segredo de assinatura proprio, e nao derivado da chave: rotacionar um
    // sem o outro tem de ser possivel, e derivar amarraria os dois.
    const signing = assinaturaObrigatoria ? randomBytes(32).toString('base64url') : undefined;
    const envelope = signing ? await this.crypto.encrypt(signing) : undefined;

    const record = await this.keys.create({
      id,
      environment: input.environment,
      name: input.name,
      prefix: generated.prefix,
      last4: generated.last4,
      // Argon2id, caro de proposito. O segredo em si nao fica em lugar nenhum.
      secretHash: await hashSecret(generated.secret),
      secretLookup: secretLookup(generated.secret),
      scopes: input.scopes,
      signingRequired: assinaturaObrigatoria,
      signingSecret: envelope
        ? {
            ciphertext: envelope.ciphertext,
            iv: envelope.iv,
            tag: envelope.authTag,
            wrappedKey: envelope.wrappedKey,
            keyId: envelope.keyId,
          }
        : undefined,
      ipAllowlist: input.ipAllowlist,
      defaultConnectionId: input.defaultConnectionId,
      expiresAt: input.expiresAt,
      createdBy: input.actorId,
      at: now,
    });

    await this.audit.record({
      environment: input.environment,
      actorType: ActorType.USER,
      actorId: input.actorId,
      action: 'api_key.created',
      resourceType: 'api_key',
      resourceId: id,
      outcome: 'SUCCESS',
      // O prefixo identifica a chave em log e suporte; o segredo nao entra na
      // auditoria, que e append-only e que nem o dono do banco apaga.
      after: {
        prefix: generated.prefix,
        scopes: input.scopes,
        signing_required: assinaturaObrigatoria,
      },
      occurredAt: now,
    });

    return { record, secret: generated.secret, signingSecret: signing };
  }

  async revoke(environment: Environment, id: string, actorId: string): Promise<ApiKeyRecord> {
    const now = this.clock.now();
    const record = await this.keys.revoke(environment, id, now);
    if (!record) {
      throw new BaasError(BaasErrorCode.RESOURCE_NOT_FOUND, {
        message: `Chave ${id} nao encontrada ou ja revogada em ${environment}.`,
      });
    }

    await this.audit.record({
      environment,
      actorType: ActorType.USER,
      actorId,
      action: 'api_key.revoked',
      resourceType: 'api_key',
      resourceId: id,
      outcome: 'SUCCESS',
      before: { status: 'ACTIVE' },
      after: { status: 'REVOKED' },
      changedFields: ['status'],
      occurredAt: now,
    });

    return record;
  }

  /**
   * Assinatura HMAC e FORCADA em chave de producao com `pix:write`.
   *
   * A regra ja estava escrita no comentario do modelo `ApiKey`; aqui ela
   * passa a valer. E um `signing_required: false` explicito e RECUSADO com
   * 400 em vez de sobrescrito em silencio: o operador precisa aprender a
   * regra, e nao achar que a desligou.
   */
  private resolveSigning(input: {
    environment: Environment;
    scopes: string[];
    signingRequired?: boolean;
  }): boolean {
    const obrigatorio =
      input.environment === Environment.PRODUCAO && input.scopes.includes('pix:write');

    if (obrigatorio && input.signingRequired === false) {
      throw new BaasError(BaasErrorCode.VALIDATION_ERROR, {
        message:
          'Chave de producao com `pix:write` exige assinatura HMAC; `signing_required: false` nao e aceito.',
      });
    }

    return obrigatorio || input.signingRequired === true;
  }
}
