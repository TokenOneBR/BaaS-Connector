import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import argon2 from 'argon2';

/**
 * Hash de segredo de API key.
 *
 * Argon2id e nao bcrypt: melhor resistencia a GPU. O custo pode ser baixo
 * porque estes segredos sao de alta entropia (geramos nos), diferente de senha
 * escolhida por humano.
 */
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  timeCost: 2,
  memoryCost: 19 * 1024,
  parallelism: 1,
};

export async function hashSecret(secret: string): Promise<string> {
  return argon2.hash(secret, ARGON2_OPTIONS);
}

export async function verifySecret(hash: string, secret: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, secret);
  } catch {
    return false;
  }
}

/**
 * Indice de lookup rapido.
 *
 * Verificar Argon2 e caro de proposito. Este sha256 indexado permite achar a
 * linha em UMA leitura indexada; o Argon2 so roda depois, na linha certa. Sem
 * isto, autenticar exigiria verificar Argon2 contra toda chave da tabela.
 */
export function secretLookup(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

export function constantTimeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface GeneratedApiKey {
  /** Valor completo, exibido UMA vez e nunca mais recuperavel. */
  secret: string;
  /** Prefixo exibivel na interface. */
  prefix: string;
  last4: string;
}

/**
 * Gera uma API key.
 *
 * O prefixo carrega o ambiente (`hml` ou `prd`) de proposito: fica visivel em
 * log, em ticket e na interface, e um humano consegue perceber na hora que
 * apontou uma chave de producao para o lugar errado.
 */
export function generateApiKey(options: {
  environment: 'HOMOLOGACAO' | 'PRODUCAO';
  keyId: string;
}): GeneratedApiKey {
  const env = options.environment === 'PRODUCAO' ? 'prd' : 'hml';
  const random = randomBytes(24).toString('base64url');
  const secret = `bck_${env}_${options.keyId}_${random}`;
  return {
    secret,
    prefix: `bck_${env}_${options.keyId}`,
    last4: random.slice(-4),
  };
}

/** Extrai o keyId de uma chave, para a busca indexada. */
export function parseApiKey(
  value: string,
): { environment: 'HOMOLOGACAO' | 'PRODUCAO'; keyId: string; secret: string } | undefined {
  const match = /^bck_(hml|prd)_([A-Za-z0-9_]+)_([A-Za-z0-9_-]+)$/.exec(value.trim());
  if (!match) return undefined;
  return {
    environment: match[1] === 'prd' ? 'PRODUCAO' : 'HOMOLOGACAO',
    keyId: match[2]!,
    secret: value.trim(),
  };
}

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString('base64url')}`;
}

export function generateSigningSecret(): string {
  return `sign_${randomBytes(32).toString('base64url')}`;
}
