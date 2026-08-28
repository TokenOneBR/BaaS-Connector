import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * TOTP (RFC 6238).
 *
 * Implementado aqui, e nao trazido de uma dependencia, porque o algoritmo cabe
 * em trinta linhas, tem vetores de teste normativos, e uma dependencia a mais
 * na arvore de autenticacao e superficie de ataque de cadeia de suprimento
 * desproporcional ao que ela economiza.
 */
export interface TotpOptions {
  /** Passo em segundos. 30 e o valor que todo autenticador assume. */
  stepSeconds?: number;
  digits?: number;
  algorithm?: 'sha1' | 'sha256' | 'sha512';
}

const DEFAULTS = { stepSeconds: 30, digits: 6, algorithm: 'sha1' as const };

export function totpCode(secret: Buffer, at: Date, options: TotpOptions = {}): string {
  const { stepSeconds, digits, algorithm } = { ...DEFAULTS, ...options };
  const counter = BigInt(Math.floor(at.getTime() / 1000 / stepSeconds));

  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);

  const digest = createHmac(algorithm, secret).update(message).digest();
  // Truncagem dinamica: os 4 bits finais escolhem o offset da janela de 4
  // bytes, e o bit mais alto e zerado para o resultado nao ficar negativo.
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    (digest[offset + 1]! << 16) |
    (digest[offset + 2]! << 8) |
    digest[offset + 3]!;

  return String(binary % 10 ** digits).padStart(digits, '0');
}

/**
 * Verifica um codigo aceitando uma janela de tolerancia.
 *
 * `window: 1` aceita o passo anterior e o seguinte — cerca de 90 segundos no
 * total. Nao e frouxidao: relogio de celular desalinhado em meio minuto e
 * comum, e sem a janela o usuario legitimo fica trancado para fora com um
 * codigo que ele leu corretamente.
 */
export function verifyTotp(
  secret: Buffer,
  code: string,
  at: Date,
  options: TotpOptions & { window?: number } = {},
): boolean {
  const stepSeconds = options.stepSeconds ?? DEFAULTS.stepSeconds;
  const window = options.window ?? 1;
  const candidate = code.trim();

  for (let drift = -window; drift <= window; drift += 1) {
    const moment = new Date(at.getTime() + drift * stepSeconds * 1000);
    const expected = totpCode(secret, moment, options);
    if (expected.length !== candidate.length) continue;
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(candidate))) return true;
  }
  return false;
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Decodifica o segredo em base32 que os autenticadores usam. */
export function decodeBase32(value: string): Buffer {
  const clean = value.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let accumulator = 0;
  const out: number[] = [];

  for (const character of clean) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) throw new Error(`Caractere invalido em base32: ${character}`);
    accumulator = (accumulator << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((accumulator >> bits) & 0xff);
    }
  }

  return Buffer.from(out);
}

export function encodeBase32(buffer: Buffer): string {
  let bits = 0;
  let accumulator = 0;
  let out = '';

  for (const byte of buffer) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32_ALPHABET[(accumulator >> bits) & 0x1f];
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(accumulator << (5 - bits)) & 0x1f];

  return out;
}
