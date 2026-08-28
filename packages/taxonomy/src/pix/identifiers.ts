import { isValidIspb } from '../br/bank.js';
import { isValidEmail, normalizeEmail, parsePhone, phoneToE164 } from '../br/contact.js';
import { isValidCnpj, isValidCpf, onlyDigits } from '../br/tax-id.js';
import { PixKeyType } from '../enums/pix.js';
import { BaasError, BaasErrorCode } from '../errors/index.js';

/**
 * EndToEndId: 'E' + ISPB(8) + yyyyMMddHHmm + 11 alfanumericos = 32 caracteres.
 *
 * Regras normativas para adapters:
 *  1. E gerado pelo PSP do PAGADOR. Nunca fabricamos um (o Mock Bank e a unica
 *     excecao legitima, porque ali realmente atuamos como PSP).
 *  2. So fica disponivel a partir de PROCESSING, muitas vezes so em SETTLED.
 *     Por isso e sempre nulavel na criacao. Esta e a pegadinha classica.
 *  3. E a nossa chave de idempotencia de ultimo recurso para webhooks.
 */
export const E2E_ID_RE = /^E\d{8}\d{12}[A-Za-z0-9]{11}$/;

/** ReturnId de devolucao: mesma estrutura, prefixo 'D'. */
export const RETURN_ID_RE = /^D\d{8}\d{12}[A-Za-z0-9]{11}$/;

export function isValidEndToEndId(value: string): boolean {
  return E2E_ID_RE.test(value);
}

export function isValidReturnId(value: string): boolean {
  return RETURN_ID_RE.test(value);
}

export interface ParsedEndToEndId {
  prefix: 'E' | 'D';
  ispb: string;
  /** Instante em UTC derivado do componente yyyyMMddHHmm. */
  createdAt: Date;
  sequence: string;
}

export function parseEndToEndId(value: string): ParsedEndToEndId {
  if (!isValidEndToEndId(value) && !isValidReturnId(value)) {
    throw new BaasError(BaasErrorCode.INVALID_END_TO_END_ID, {
      message: `EndToEndId fora do formato do BACEN: ${JSON.stringify(value)}`,
    });
  }
  const year = Number(value.slice(9, 13));
  const month = Number(value.slice(13, 15));
  const day = Number(value.slice(15, 17));
  const hour = Number(value.slice(17, 19));
  const minute = Number(value.slice(19, 21));
  return {
    prefix: value[0] as 'E' | 'D',
    ispb: value.slice(1, 9),
    createdAt: new Date(Date.UTC(year, month - 1, day, hour, minute)),
    sequence: value.slice(21),
  };
}

const ALPHANUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Gera um EndToEndId. Uso restrito ao Mock Bank, que atua como PSP.
 *
 * `randomSuffix` e injetado para os testes serem deterministicos.
 */
export function buildEndToEndId(options: {
  ispb: string;
  at: Date;
  prefix?: 'E' | 'D';
  randomSuffix?: string;
}): string {
  const { ispb, at, prefix = 'E' } = options;
  if (!isValidIspb(ispb)) {
    throw new BaasError(BaasErrorCode.VALIDATION_ERROR, { message: `ISPB invalido: ${ispb}` });
  }
  const pad = (n: number, size = 2) => n.toString().padStart(size, '0');
  const stamp =
    `${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}` +
    `${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}`;

  let suffix = options.randomSuffix;
  if (!suffix) {
    suffix = Array.from({ length: 11 }, () => {
      const index = Math.floor(Math.random() * ALPHANUM.length);
      return ALPHANUM[index];
    }).join('');
  }
  if (suffix.length !== 11 || !/^[A-Za-z0-9]{11}$/.test(suffix)) {
    throw new BaasError(BaasErrorCode.VALIDATION_ERROR, {
      message: 'randomSuffix deve ter 11 caracteres alfanumericos',
    });
  }
  return `${prefix}${ispb}${stamp}${suffix}`;
}

/**
 * txid: 26 a 35 alfanumericos para cobranca dinamica; ate 25 (ou '***') para
 * estatica.
 */
export function isValidTxid(value: string, kind: 'static' | 'dynamic'): boolean {
  if (kind === 'static') return value === '***' || /^[A-Za-z0-9]{1,25}$/.test(value);
  return /^[A-Za-z0-9]{26,35}$/.test(value);
}

const EVP_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Normaliza uma chave Pix para a forma canonica de armazenamento:
 * CPF/CNPJ so digitos, telefone em E.164, email em minusculas, EVP em
 * minusculas. Sem isso, "Joao@X.com" e "joao@x.com" viram duas chaves.
 */
export function normalizePixKey(type: PixKeyType, value: string): string {
  switch (type) {
    case PixKeyType.CPF:
    case PixKeyType.CNPJ:
      return onlyDigits(value);
    case PixKeyType.EMAIL:
      return normalizeEmail(value);
    case PixKeyType.PHONE: {
      const phone = parsePhone(value);
      if (!phone) {
        throw new BaasError(BaasErrorCode.INVALID_PIX_KEY, {
          message: `Telefone invalido para chave Pix: ${JSON.stringify(value)}`,
        });
      }
      return phoneToE164(phone);
    }
    case PixKeyType.EVP:
      return value.trim().toLowerCase();
  }
}

export function isValidPixKey(type: PixKeyType, value: string): boolean {
  try {
    const normalized = normalizePixKey(type, value);
    switch (type) {
      case PixKeyType.CPF:
        return isValidCpf(normalized);
      case PixKeyType.CNPJ:
        return isValidCnpj(normalized);
      case PixKeyType.EMAIL:
        return isValidEmail(normalized);
      case PixKeyType.PHONE:
        return /^\+55\d{10,11}$/.test(normalized);
      case PixKeyType.EVP:
        return EVP_RE.test(normalized);
    }
  } catch {
    return false;
  }
}

/** Deduz o tipo de uma chave Pix a partir do formato. */
export function inferPixKeyType(value: string): PixKeyType | undefined {
  const trimmed = value.trim();
  if (EVP_RE.test(trimmed)) return PixKeyType.EVP;
  if (trimmed.includes('@')) return isValidEmail(trimmed) ? PixKeyType.EMAIL : undefined;
  if (trimmed.startsWith('+')) return parsePhone(trimmed) ? PixKeyType.PHONE : undefined;
  const digits = onlyDigits(trimmed);
  if (digits.length === 11 && isValidCpf(digits)) return PixKeyType.CPF;
  if (digits.length === 14 && isValidCnpj(digits)) return PixKeyType.CNPJ;
  if (digits.length === 10 || digits.length === 11) {
    return parsePhone(digits) ? PixKeyType.PHONE : undefined;
  }
  return undefined;
}

/** Mascara para log e para clientes sem escopo `pii:read`. */
export function maskPixKey(type: PixKeyType, value: string): string {
  switch (type) {
    case PixKeyType.EMAIL: {
      const [local = '', domain = ''] = value.split('@');
      return `${local.slice(0, 1)}${'*'.repeat(Math.max(local.length - 1, 1))}@${domain}`;
    }
    case PixKeyType.EVP:
      return `${value.slice(0, 8)}-****-****-****-${value.slice(-4)}`;
    default:
      return `${'*'.repeat(Math.max(value.length - 4, 0))}${value.slice(-4)}`;
  }
}
