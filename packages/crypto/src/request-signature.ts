import { createHash, createHmac, randomBytes } from 'node:crypto';

/**
 * Assinatura HMAC das rotas que movimentam dinheiro.
 *
 * Vive em `packages/crypto` pelo mesmo motivo que o assinante de webhook: o
 * SDK publicado precisa CONSTRUIR esta assinatura, e um pacote publicado nao
 * pode depender de `apps/api`. `apps/api` reexporta daqui, entao o servidor
 * que verifica e o cliente que assina compartilham UMA implementacao — duas
 * copias da mesma formula divergem, e o sintoma seria o servidor recusar uma
 * assinatura correta.
 */
export interface CanonicalRequest {
  method: string;
  /** Caminho COM query string, exatamente como vai na requisicao. */
  path: string;
  rawBody: string;
  timestamp: string;
  nonce: string;
}

/**
 * String canonica assinada.
 *
 * Inclui metodo, caminho com query, timestamp, nonce e digest do corpo. Cada
 * componente fecha um vetor: sem o caminho, a assinatura de um GET valeria num
 * POST; sem o digest, o valor da transferencia poderia ser trocado; sem o
 * nonce, a mesma requisicao poderia ser repetida dentro da janela.
 */
export function canonicalSignatureString(input: CanonicalRequest): string {
  const bodyDigest = createHash('sha256').update(input.rawBody).digest('hex');
  return [input.method.toUpperCase(), input.path, input.timestamp, input.nonce, bodyDigest].join(
    '\n',
  );
}

export function buildSignature(secret: string, input: CanonicalRequest): string {
  return createHmac('sha256', secret).update(canonicalSignatureString(input)).digest('hex');
}

export function generateNonce(): string {
  return randomBytes(16).toString('hex');
}
