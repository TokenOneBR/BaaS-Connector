import { onlyDigits } from './tax-id.js';

export interface Phone {
  /** Sempre '55' no Brasil. */
  countryCode: string;
  /** DDD, 2 digitos. */
  areaCode: string;
  /** 8 (fixo) ou 9 (movel) digitos. */
  number: string;
}

const MOBILE_LENGTH = 9;
const LANDLINE_LENGTH = 8;

export function parsePhone(input: string, countryCode = '55'): Phone | undefined {
  let digits = onlyDigits(input);
  if (digits.startsWith(countryCode) && digits.length > 11) {
    digits = digits.slice(countryCode.length);
  }
  if (digits.length !== 10 && digits.length !== 11) return undefined;

  const areaCode = digits.slice(0, 2);
  const number = digits.slice(2);
  if (Number(areaCode) < 11 || Number(areaCode) > 99) return undefined;
  // Celular brasileiro sempre comeca com 9 apos o DDD.
  if (number.length === MOBILE_LENGTH && !number.startsWith('9')) return undefined;
  if (number.length !== MOBILE_LENGTH && number.length !== LANDLINE_LENGTH) return undefined;

  return { countryCode, areaCode, number };
}

export function isValidPhone(input: string): boolean {
  return parsePhone(input) !== undefined;
}

/** Formato E.164, que e o exigido para chave Pix do tipo PHONE. */
export function phoneToE164(phone: Phone): string {
  return `+${phone.countryCode}${phone.areaCode}${phone.number}`;
}

export function formatPhone(phone: Phone): string {
  const { number } = phone;
  const split = number.length === MOBILE_LENGTH ? 5 : 4;
  return `(${phone.areaCode}) ${number.slice(0, split)}-${number.slice(split)}`;
}

export function maskPhone(phone: Phone): string {
  const { number } = phone;
  const visible = number.slice(-4);
  return `(${phone.areaCode}) ${'*'.repeat(number.length - 4)}-${visible}`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value) && value.length <= 77;
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function maskEmail(value: string): string {
  const [local = '', domain = ''] = value.split('@');
  const head = local.slice(0, 1);
  return `${head}${'*'.repeat(Math.max(local.length - 1, 1))}@${domain}`;
}

/** CEP: 8 digitos, sem mascara no armazenamento. */
export function isValidPostalCode(value: string): boolean {
  return /^\d{8}$/.test(onlyDigits(value));
}

export function formatPostalCode(value: string): string {
  const d = onlyDigits(value).padStart(8, '0');
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}
