import { createHash } from 'node:crypto';

/**
 * Redacao de payload.
 *
 * Roda ANTES de o objeto sair do kit: o corpo sem redacao nunca entra num
 * transport de logger. Depois que um CPF chega ao pipeline de log, ele esta
 * em backup, em indice e em retencao de terceiro.
 */
export interface RedactionRules {
  /** Caminhos pontilhados, com `*` para qualquer nivel. */
  maskPaths: readonly string[];
  /** Substituido por `sha256:<16 hex>`: correlaciona sem expor. */
  hashPaths?: readonly string[];
  /** Removido por inteiro (blob de documento em base64). */
  dropPaths?: readonly string[];
  headers: { mask: readonly string[]; drop: readonly string[] };
  maxBodyBytes: number;
}

export const REDACTED = '[REDACTED]';

export const BASE_REDACTION: RedactionRules = Object.freeze({
  maskPaths: Object.freeze([
    '*.cpf',
    '*.cnpj',
    '*.taxId',
    '*.tax_id',
    '*.documentNumber',
    '*.document',
    '*.password',
    '*.secret',
    '*.clientSecret',
    '*.client_secret',
    '*.accessToken',
    '*.access_token',
    '*.refreshToken',
    '*.refresh_token',
    '*.apiKey',
    '*.api_key',
    '*.privateKey',
    '*.private_key',
    '*.cardNumber',
    '*.cvv',
    '*.motherName',
    '*.mother_name',
    '*.birthDate',
    '*.birth_date',
    '*.email',
    '*.phone',
    '*.phoneNumber',
    '*.phone_number',
    '*.address',
    '*.street',
    '*.postalCode',
    '*.postal_code',
  ]),
  hashPaths: Object.freeze([
    '*.pixKey',
    '*.pix_key',
    '*.chave',
    '*.accountNumber',
    '*.account_number',
  ]),
  dropPaths: Object.freeze([
    '*.fileContent',
    '*.base64',
    '*.imageBase64',
    '*.qrCodeBase64',
    '*.content',
  ]),
  headers: Object.freeze({
    mask: Object.freeze([
      'authorization',
      'x-api-key',
      'x-signature',
      'access_token',
      'apikey',
      'cookie',
      'set-cookie',
      'asaas-access-token',
      'x-baas-signature',
    ]),
    drop: Object.freeze([] as string[]),
  }),
  maxBodyBytes: 8192,
});

function sha256Short(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex').slice(0, 16)}`;
}

/**
 * Mascara preservando o final.
 *
 * Os ultimos digitos ficam visiveis de proposito: e o que permite ao suporte
 * confirmar de qual documento se trata sem ver o documento.
 */
export function maskValue(value: unknown): string {
  if (typeof value !== 'string') return REDACTED;

  if (value.includes('@')) {
    const [local = '', domain = ''] = value.split('@');
    return `${local.slice(0, 1)}${'*'.repeat(Math.max(local.length - 1, 1))}@${domain}`;
  }

  const digits = value.replace(/\D/g, '');
  if (digits.length === 11 || digits.length === 14) {
    // CPF 529.982.247-25 -> ***.***.247-25
    const tail = value.slice(-6);
    return `${value.slice(0, -6).replace(/\d/g, '*')}${tail}`;
  }

  if (value.length <= 4) return REDACTED;
  return `${'*'.repeat(Math.max(value.length - 4, 0))}${value.slice(-4)}`;
}

/** Um padrao de caminho casa com o caminho concreto de um campo. */
function matches(pattern: string, path: readonly string[]): boolean {
  const segments = pattern.split('.');
  if (segments[0] === '*') {
    // `*.cpf` casa com `cpf` em qualquer profundidade.
    const tail = segments.slice(1);
    if (tail.length === 0) return true;
    if (tail[tail.length - 1] === '*') {
      return path.some((_, i) => tail.slice(0, -1).every((s, j) => path[i + j] === s));
    }
    return (
      path.length >= tail.length && tail.every((s, i) => path[path.length - tail.length + i] === s)
    );
  }
  return segments.length === path.length && segments.every((s, i) => s === '*' || path[i] === s);
}

export function redact(value: unknown, rules: RedactionRules = BASE_REDACTION): unknown {
  const walk = (node: unknown, path: string[]): unknown => {
    if (node === null || node === undefined) return node;

    if (Array.isArray(node)) return node.map((item, i) => walk(item, [...path, String(i)]));

    if (typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        const childPath = [...path, key];
        if (rules.dropPaths?.some((p) => matches(p, childPath))) continue;
        if (rules.hashPaths?.some((p) => matches(p, childPath))) {
          out[key] = typeof child === 'string' ? sha256Short(child) : REDACTED;
          continue;
        }
        if (rules.maskPaths.some((p) => matches(p, childPath))) {
          out[key] = typeof child === 'object' && child !== null ? REDACTED : maskValue(child);
          continue;
        }
        out[key] = walk(child, childPath);
      }
      return out;
    }

    return node;
  };

  const redacted = walk(value, []);
  const serialized = JSON.stringify(redacted);
  if (serialized && serialized.length > rules.maxBodyBytes) {
    return {
      _truncated: true,
      _originalBytes: serialized.length,
      _digest: sha256Short(serialized),
      preview: serialized.slice(0, rules.maxBodyBytes),
    };
  }
  return redacted;
}

export function redactHeaders(
  headers: Record<string, string | string[] | undefined>,
  rules: RedactionRules = BASE_REDACTION,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [rawKey, value] of Object.entries(headers)) {
    const key = rawKey.toLowerCase();
    if (rules.headers.drop.includes(key)) continue;
    if (value === undefined) continue;
    const flat = Array.isArray(value) ? value.join(', ') : value;
    out[key] = rules.headers.mask.includes(key) ? REDACTED : flat;
  }
  return out;
}

/** Compoe regras base com extensoes especificas do adapter. */
export function extendRedaction(
  base: RedactionRules,
  extra: Partial<RedactionRules>,
): RedactionRules {
  return {
    maskPaths: [...base.maskPaths, ...(extra.maskPaths ?? [])],
    hashPaths: [...(base.hashPaths ?? []), ...(extra.hashPaths ?? [])],
    dropPaths: [...(base.dropPaths ?? []), ...(extra.dropPaths ?? [])],
    headers: {
      mask: [...base.headers.mask, ...(extra.headers?.mask ?? [])],
      drop: [...base.headers.drop, ...(extra.headers?.drop ?? [])],
    },
    maxBodyBytes: extra.maxBodyBytes ?? base.maxBodyBytes,
  };
}
