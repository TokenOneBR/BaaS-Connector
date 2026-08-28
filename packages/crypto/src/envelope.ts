import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

import type { KmsDriver } from './kms.js';

/**
 * Blob cifrado em envelope.
 *
 * A DEK e aleatoria por registro e fica envolvida pelo KMS. Uma leitura do
 * banco sem acesso ao KMS nao entrega nada.
 */
export interface EncryptedEnvelope {
  /** DEK envolvida pelo KMS. */
  wrappedKey: Buffer;
  keyId: string;
  iv: Buffer;
  authTag: Buffer;
  ciphertext: Buffer;
  /** Incrementa a cada rotacao; invalida cache por construcao. */
  version: number;
}

export interface EnvelopeCryptoOptions {
  kms: KmsDriver;
  /** Cache da DEK em claro, em processo. Nunca vai para o Redis. */
  cacheTtlMs?: number;
}

interface CachedKey {
  dataKey: Buffer;
  expiresAtMs: number;
}

/**
 * Envelope encryption para credenciais de provedor e dados sensiveis.
 *
 * O plaintext da DEK e cacheado apenas EM PROCESSO e por pouco tempo. Nunca no
 * Redis: um cache compartilhado transforma um comprometimento do Redis em
 * comprometimento de todas as credenciais.
 */
export class EnvelopeCrypto {
  private readonly cache = new Map<string, CachedKey>();
  private readonly cacheTtlMs: number;

  constructor(private readonly options: EnvelopeCryptoOptions) {
    this.cacheTtlMs = options.cacheTtlMs ?? 60_000;
  }

  async encrypt(plaintext: string | Buffer, version = 1): Promise<EncryptedEnvelope> {
    const dataKey = randomBytes(32);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', dataKey, iv);
    const input = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext;
    const ciphertext = Buffer.concat([cipher.update(input), cipher.final()]);
    const { wrapped, keyId } = await this.options.kms.wrap(dataKey);

    // A DEK em claro sai de escopo aqui; so a envolvida e persistida.
    dataKey.fill(0);

    return { wrappedKey: wrapped, keyId, iv, authTag: cipher.getAuthTag(), ciphertext, version };
  }

  async decrypt(envelope: EncryptedEnvelope, cacheKey?: string): Promise<Buffer> {
    const dataKey = await this.resolveDataKey(envelope, cacheKey);
    const decipher = createDecipheriv('aes-256-gcm', dataKey, envelope.iv);
    decipher.setAuthTag(envelope.authTag);
    return Buffer.concat([decipher.update(envelope.ciphertext), decipher.final()]);
  }

  async decryptToString(envelope: EncryptedEnvelope, cacheKey?: string): Promise<string> {
    return (await this.decrypt(envelope, cacheKey)).toString('utf8');
  }

  async encryptJson(value: unknown, version = 1): Promise<EncryptedEnvelope> {
    return this.encrypt(JSON.stringify(value), version);
  }

  async decryptJson<T>(envelope: EncryptedEnvelope, cacheKey?: string): Promise<T> {
    return JSON.parse(await this.decryptToString(envelope, cacheKey)) as T;
  }

  /**
   * Impressao digital de um segredo, para exibir na interface.
   *
   * A interface do console nunca mostra credencial, nem mascarada: mostra a
   * fingerprint e os ultimos 4, que provam que ha algo gravado sem revelar
   * nada util a quem olhar por cima do ombro.
   */
  static fingerprint(value: string): string {
    return `sha256:${createHash('sha256').update(value).digest('hex').slice(0, 16)}`;
  }

  static last4(value: string): string {
    return value.slice(-4);
  }

  invalidate(cacheKey: string): void {
    const cached = this.cache.get(cacheKey);
    cached?.dataKey.fill(0);
    this.cache.delete(cacheKey);
  }

  clearCache(): void {
    for (const cached of this.cache.values()) cached.dataKey.fill(0);
    this.cache.clear();
  }

  private async resolveDataKey(envelope: EncryptedEnvelope, cacheKey?: string): Promise<Buffer> {
    // A versao entra na chave de cache: rotacionar invalida por construcao,
    // sem precisar de invalidacao explicita em lugar nenhum.
    const key = cacheKey ? `${cacheKey}:v${envelope.version}` : undefined;

    if (key) {
      const cached = this.cache.get(key);
      if (cached && cached.expiresAtMs > Date.now()) return cached.dataKey;
    }

    const dataKey = await this.options.kms.unwrap(envelope.wrappedKey, envelope.keyId);
    if (key) {
      this.cache.set(key, { dataKey, expiresAtMs: Date.now() + this.cacheTtlMs });
    }
    return dataKey;
  }
}

/** Comparacao em tempo constante, para nao vazar informacao por timing. */
export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}
