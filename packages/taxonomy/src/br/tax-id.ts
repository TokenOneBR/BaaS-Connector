import { TaxIdType } from '../enums/core.js';

export interface TaxId {
  type: TaxIdType;
  /** Somente digitos, sem mascara. */
  value: string;
}

export function onlyDigits(value: string): string {
  return value.replace(/\D/g, '');
}

/** Calculo do digito verificador modulo 11 usado por CPF e CNPJ. */
function mod11(digits: readonly number[], weights: readonly number[]): number {
  const sum = digits.reduce((acc, digit, i) => acc + digit * (weights[i] ?? 0), 0);
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

export function isValidCpf(input: string): boolean {
  const value = onlyDigits(input);
  if (value.length !== 11) return false;
  // Sequencias repetidas passam no modulo 11 mas nao sao CPFs validos.
  if (/^(\d)\1{10}$/.test(value)) return false;

  const digits = [...value].map(Number);
  const first = mod11(digits.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = mod11(digits.slice(0, 10), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return digits[9] === first && digits[10] === second;
}

export function isValidCnpj(input: string): boolean {
  const value = onlyDigits(input);
  if (value.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(value)) return false;

  const digits = [...value].map(Number);
  const first = mod11(digits.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = mod11(digits.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return digits[12] === first && digits[13] === second;
}

export function isValidTaxId(taxId: TaxId): boolean {
  return taxId.type === TaxIdType.CPF ? isValidCpf(taxId.value) : isValidCnpj(taxId.value);
}

/** Deduz o tipo pelo comprimento. Retorna undefined se nao for 11 nem 14. */
export function inferTaxIdType(input: string): TaxIdType | undefined {
  const length = onlyDigits(input).length;
  if (length === 11) return TaxIdType.CPF;
  if (length === 14) return TaxIdType.CNPJ;
  return undefined;
}

export function parseTaxId(input: string): TaxId | undefined {
  const value = onlyDigits(input);
  const type = inferTaxIdType(value);
  if (!type) return undefined;
  const taxId: TaxId = { type, value };
  return isValidTaxId(taxId) ? taxId : undefined;
}

export function formatCpf(value: string): string {
  const d = onlyDigits(value).padStart(11, '0');
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export function formatCnpj(value: string): string {
  const d = onlyDigits(value).padStart(14, '0');
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

export function formatTaxId(taxId: TaxId): string {
  return taxId.type === TaxIdType.CPF ? formatCpf(taxId.value) : formatCnpj(taxId.value);
}

/**
 * Mascara preservando os ultimos 4 digitos.
 *
 * Os ultimos 4 ficam visiveis de proposito: e o que o suporte usa para
 * confirmar identidade sem expor o documento inteiro em log ou tela.
 */
export function maskTaxId(taxId: TaxId): string {
  const formatted = formatTaxId(taxId);
  const tail = formatted.slice(-6);
  const head = formatted.slice(0, -6).replace(/\d/g, '*');
  return `${head}${tail}`;
}
