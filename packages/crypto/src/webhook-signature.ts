import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Assinatura de webhook de SAIDA, no esquema da Stripe.
 *
 * Vive em `packages/crypto`, e nao em `apps/api`: o SDK publico embarca o
 * VERIFICADOR, e um pacote publicado nao pode depender de um app privado. E o
 * espelho exato do verificador de entrada que cada adapter implementa.
 *
 * O formato e `t=<unix>,v1=<hex>` sobre `${t}.${corpo}`. O timestamp entra na
 * string assinada, e nao so no cabecalho, porque senao ele poderia ser trocado
 * sem invalidar a assinatura — e a janela de tolerancia deixaria de significar
 * alguma coisa.
 */
export interface WebhookSignatureInput {
  /** Bytes EXATOS do corpo enviado. Reserializar muda a assinatura. */
  payload: string;
  timestampSeconds: number;
  /** O segredo atual primeiro; o anterior entra durante a rotacao. */
  secrets: readonly string[];
}

const SCHEME = 'v1';

/**
 * Monta o cabecalho.
 *
 * Durante a rotacao saem DOIS elementos `v1=`, e nao um cabecalho novo: um
 * verificador Stripe padrao, sem nenhuma modificacao, aceita qualquer um dos
 * dois. O cliente troca o segredo quando quiser dentro da janela, sem perder
 * evento — que e o ponto inteiro de ter segredo anterior.
 */
export function buildWebhookSignature(input: WebhookSignatureInput): string {
  if (input.secrets.length === 0) {
    throw new Error('Assinatura de webhook exige ao menos um segredo.');
  }

  const signed = signaturePayload(input.timestampSeconds, input.payload);
  const elements = input.secrets.map((secret) => `${SCHEME}=${hmac(secret, signed)}`);
  return [`t=${input.timestampSeconds}`, ...elements].join(',');
}

export type SignatureFailure = 'malformed' | 'timestamp_out_of_window' | 'no_matching_signature';

export interface VerifyWebhookSignatureInput {
  header: string;
  payload: string;
  secrets: readonly string[];
  nowSeconds: number;
  toleranceSeconds: number;
}

/**
 * Verifica um cabecalho recebido.
 *
 * Publicado para o SDK e usado pelos nossos proprios testes. Aceita QUALQUER
 * um dos segredos: e o mesmo mecanismo que faz a rotacao funcionar dos dois
 * lados.
 */
export function verifyWebhookSignature(
  input: VerifyWebhookSignatureInput,
): { valid: true } | { valid: false; reason: SignatureFailure } {
  const parsed = parseSignatureHeader(input.header);
  if (!parsed) return { valid: false, reason: 'malformed' };

  // A janela e checada ANTES do HMAC: uma assinatura valida de tres dias atras
  // continua sendo um replay, e comparar o hash primeiro so gastaria CPU para
  // chegar na mesma recusa.
  if (Math.abs(input.nowSeconds - parsed.timestamp) > input.toleranceSeconds) {
    return { valid: false, reason: 'timestamp_out_of_window' };
  }

  const signed = signaturePayload(parsed.timestamp, input.payload);
  const esperadas = input.secrets.map((secret) => hmac(secret, signed));

  const confere = parsed.signatures.some((recebida) =>
    esperadas.some((esperada) => constantTimeEquals(esperada, recebida)),
  );

  return confere ? { valid: true } : { valid: false, reason: 'no_matching_signature' };
}

export function parseSignatureHeader(
  header: string,
): { timestamp: number; signatures: string[] } | undefined {
  let timestamp: number | undefined;
  const signatures: string[] = [];

  for (const part of header.split(',')) {
    const [key, value] = part.trim().split('=', 2);
    if (!key || !value) continue;
    if (key === 't') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) timestamp = parsed;
    } else if (key === SCHEME) {
      signatures.push(value);
    }
  }

  if (timestamp === undefined || signatures.length === 0) return undefined;
  return { timestamp, signatures };
}

function signaturePayload(timestampSeconds: number, payload: string): string {
  return `${timestampSeconds}.${payload}`;
}

function hmac(secret: string, signed: string): string {
  return createHmac('sha256', secret).update(signed, 'utf8').digest('hex');
}

/**
 * Comparacao de tempo constante.
 *
 * `===` em string vaza o tamanho do prefixo igual pelo tempo de execucao, e
 * com repeticao isso reconstroi a assinatura byte a byte.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}
