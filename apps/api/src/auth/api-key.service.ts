import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { constantTimeEqual, parseApiKey, secretLookup, verifySecret } from '@baasconn/crypto';
import { BaasError, BaasErrorCode, type Clock, type Environment } from '@baasconn/taxonomy';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { CLOCK } from '../common/clock.js';
import { ApiConfig } from '../config/config.service.js';

export interface AuthenticatedKey {
  id: string;
  name: string;
  environment: Environment;
  scopes: readonly string[];
  signingRequired: boolean;
  signingSecret?: string;
  defaultConnectionId?: string;
  ipAllowlist: readonly string[];
  rateLimitTier: string;
}

/**
 * Token de DI do repositorio de chaves.
 *
 * O parametro do construtor e uma interface, e interface nao existe em
 * runtime: sem o token, o `emitDecoratorMetadata` grava `Object` e o container
 * falha no boot com "can't resolve dependencies (?, Object)".
 */
export const API_KEY_REPOSITORY = Symbol('BAAS_API_KEY_REPOSITORY');

export const NONCE_STORE = Symbol('BAAS_NONCE_STORE');

/** Fonte das chaves. Implementada sobre Prisma; injetavel para teste. */
export interface ApiKeyRepository {
  findByLookup(lookup: Buffer): Promise<
    | {
        id: string;
        name: string;
        environment: Environment;
        scopes: string[];
        secretHash: string;
        signingRequired: boolean;
        signingSecret?: string;
        defaultConnectionId?: string;
        ipAllowlist: string[];
        rateLimitTier: string;
        status: 'ACTIVE' | 'REVOKED' | 'EXPIRED';
        expiresAt?: Date | null;
      }
    | undefined
  >;
  touchLastUsed(id: string): Promise<void>;

  // --- Superficie do console. Nenhuma delas devolve o segredo. ---

  list(environment: Environment, status?: string): Promise<ApiKeyRecord[]>;
  findById(environment: Environment, id: string): Promise<ApiKeyRecord | undefined>;
  create(input: CreateApiKeyRow): Promise<ApiKeyRecord>;
  revoke(environment: Environment, id: string, at: Date): Promise<ApiKeyRecord | undefined>;
}

/**
 * Chave de API SEM segredo.
 *
 * Mesma garantia estrutural das conexoes: nao ha campo para vazar. O segredo
 * existe UMA vez, no retorno de `create`, e nenhum caminho de leitura consegue
 * construi-lo — o que fica gravado e o hash Argon2id.
 */
export interface ApiKeyRecord {
  id: string;
  environment: Environment;
  name: string;
  prefix: string;
  last4: string;
  scopes: string[];
  signingRequired: boolean;
  ipAllowlist: string[];
  rateLimitTier: string;
  defaultConnectionId?: string;
  status: string;
  lastUsedAt?: Date;
  expiresAt?: Date;
  createdAt: Date;
}

export interface CreateApiKeyRow {
  id: string;
  environment: Environment;
  name: string;
  prefix: string;
  last4: string;
  secretHash: string;
  secretLookup: Buffer;
  scopes: string[];
  signingRequired: boolean;
  signingSecret?: {
    ciphertext: Buffer;
    iv: Buffer;
    tag: Buffer;
    wrappedKey: Buffer;
    keyId: string;
  };
  ipAllowlist: string[];
  defaultConnectionId?: string;
  expiresAt?: Date;
  /** Quem cunhou. O schema o exige, e e a metade de "quem" da auditoria. */
  createdBy: string;
  at: Date;
}

export interface SignatureInput {
  method: string;
  path: string;
  rawBody: string;
  timestamp: string;
  nonce: string;
  signature: string;
}

/** Registro de nonce, para impedir replay. Redis em producao. */
export interface NonceStore {
  /** Devolve false quando o nonce ja foi visto. */
  claim(keyId: string, nonce: string, ttlSeconds: number): Promise<boolean>;
}

@Injectable()
export class ApiKeyService {
  private readonly logger = new Logger(ApiKeyService.name);

  constructor(
    private readonly config: ApiConfig,
    @Inject(API_KEY_REPOSITORY) private readonly repository: ApiKeyRepository,
    @Inject(NONCE_STORE) private readonly nonces: NonceStore,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Autentica uma chave.
   *
   * A busca e por `secretLookup` (sha256 indexado) e SO ENTAO verifica o
   * Argon2id na linha encontrada. Argon2 e caro de proposito; sem o indice,
   * autenticar exigiria verifica-lo contra toda chave da tabela.
   */
  async authenticate(rawKey: string, clientIp?: string): Promise<AuthenticatedKey> {
    const parsed = parseApiKey(rawKey);
    if (!parsed) {
      throw new BaasError(BaasErrorCode.INVALID_API_KEY, {
        message:
          'Formato de chave invalido. Esperado bck_hml_<id>_<segredo> ou bck_prd_<id>_<segredo>.',
      });
    }

    const record = await this.repository.findByLookup(secretLookup(rawKey));
    if (!record) throw new BaasError(BaasErrorCode.INVALID_API_KEY);

    if (!(await verifySecret(record.secretHash, rawKey))) {
      throw new BaasError(BaasErrorCode.INVALID_API_KEY);
    }

    if (record.status === 'REVOKED') throw new BaasError(BaasErrorCode.API_KEY_REVOKED);
    if (record.status === 'EXPIRED' || (record.expiresAt && record.expiresAt <= this.clock.now())) {
      throw new BaasError(BaasErrorCode.API_KEY_REVOKED, { message: 'A chave de API expirou.' });
    }

    // O ambiente vem do PREFIXO da chave e precisa bater com o registro: se
    // divergir, alguem adulterou o prefixo tentando cruzar ambiente.
    if (record.environment !== parsed.environment) {
      this.logger.warn(
        { api_key_id: record.id },
        'Prefixo de chave nao corresponde ao ambiente gravado',
      );
      throw new BaasError(BaasErrorCode.ENVIRONMENT_MISMATCH);
    }

    if (
      record.ipAllowlist.length > 0 &&
      clientIp &&
      !this.ipAllowed(clientIp, record.ipAllowlist)
    ) {
      throw new BaasError(BaasErrorCode.AUTHORIZATION_DENIED, {
        message: 'Origem nao permitida para esta chave de API.',
      });
    }

    void this.repository.touchLastUsed(record.id).catch(() => undefined);

    return {
      id: record.id,
      name: record.name,
      environment: record.environment,
      scopes: record.scopes,
      signingRequired: record.signingRequired,
      signingSecret: record.signingSecret,
      defaultConnectionId: record.defaultConnectionId,
      ipAllowlist: record.ipAllowlist,
      rateLimitTier: record.rateLimitTier,
    };
  }

  /**
   * Verifica a assinatura HMAC.
   *
   * Defende contra replay de chave vazada e contra proxy que loga URL. A
   * string canonica inclui o digest do corpo, entao alterar o valor de uma
   * transferencia invalida a assinatura.
   */
  async verifySignature(key: AuthenticatedKey, input: SignatureInput): Promise<void> {
    if (!key.signingSecret) {
      throw new BaasError(BaasErrorCode.SIGNATURE_INVALID, {
        message: 'Esta chave exige assinatura, mas nao possui segredo de assinatura configurado.',
      });
    }

    const timestamp = Number(input.timestamp);
    if (!Number.isFinite(timestamp)) {
      throw new BaasError(BaasErrorCode.SIGNATURE_INVALID, {
        message: 'X-Baas-Timestamp ausente ou invalido.',
      });
    }

    const skew = Math.abs(Math.floor(this.clock.now().getTime() / 1000) - timestamp);
    if (skew > this.config.signatureToleranceSeconds) {
      throw new BaasError(BaasErrorCode.SIGNATURE_EXPIRED, {
        message: `Assinatura fora da janela de ${this.config.signatureToleranceSeconds}s.`,
      });
    }

    if (input.nonce.length < 16) {
      throw new BaasError(BaasErrorCode.SIGNATURE_INVALID, {
        message: 'X-Baas-Nonce precisa de ao menos 16 caracteres.',
      });
    }

    const fresh = await this.nonces.claim(
      key.id,
      input.nonce,
      this.config.signatureToleranceSeconds * 2,
    );
    if (!fresh) throw new BaasError(BaasErrorCode.NONCE_REPLAYED);

    const expected = buildSignature(key.signingSecret, input);
    const provided = input.signature.replace(/^v1=/, '');

    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(provided, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new BaasError(BaasErrorCode.SIGNATURE_INVALID);
    }
  }

  /** Verifica escopo. `pii:read` e checado separadamente e sempre auditado. */
  assertScope(key: AuthenticatedKey, required: string): void {
    if (key.scopes.includes(required)) return;
    throw new BaasError(BaasErrorCode.INSUFFICIENT_SCOPE, {
      message: `A chave de API nao possui o escopo '${required}'.`,
      meta: { required, granted: key.scopes },
    });
  }

  private ipAllowed(clientIp: string, allowlist: readonly string[]): boolean {
    // Comparacao exata e por prefixo de CIDR simples; suficiente para o
    // allowlist tipico, e um CIDR completo entra quando houver demanda.
    return allowlist.some((entry) => {
      if (!entry.includes('/')) return entry === clientIp;
      const network = entry.split('/')[0];
      if (!network) return false;
      // Prefixo de /24; um CIDR completo entra quando houver demanda real.
      return clientIp.startsWith(network.split('.').slice(0, 3).join('.'));
    });
  }
}

/**
 * String canonica assinada.
 *
 * Inclui metodo, caminho com query, timestamp, nonce e digest do corpo. Cada
 * componente fecha um vetor: sem o caminho, a assinatura de um GET valeria num
 * POST; sem o digest, o valor da transferencia poderia ser trocado.
 */
export function canonicalSignatureString(input: Omit<SignatureInput, 'signature'>): string {
  const bodyDigest = createHash('sha256').update(input.rawBody).digest('hex');
  return [input.method.toUpperCase(), input.path, input.timestamp, input.nonce, bodyDigest].join(
    '\n',
  );
}

export function buildSignature(secret: string, input: Omit<SignatureInput, 'signature'>): string {
  return createHmac('sha256', secret).update(canonicalSignatureString(input)).digest('hex');
}

export function generateNonce(): string {
  return randomBytes(16).toString('hex');
}

export { constantTimeEqual };
