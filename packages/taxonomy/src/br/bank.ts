/** ISPB: identificador de instituicao no SPB, 8 digitos. */
export function isValidIspb(value: string): boolean {
  return /^\d{8}$/.test(value);
}

/** Codigo COMPE, 3 digitos. */
export function isValidBankCode(value: string): boolean {
  return /^\d{3}$/.test(value);
}

export interface BankAccountCoordinates {
  ispb: string;
  bankCode?: string;
  branch: string;
  branchCheckDigit?: string;
  number: string;
  checkDigit?: string;
}

export function formatBankAccount(coords: BankAccountCoordinates): string {
  const branch = coords.branchCheckDigit
    ? `${coords.branch}-${coords.branchCheckDigit}`
    : coords.branch;
  const account = coords.checkDigit ? `${coords.number}-${coords.checkDigit}` : coords.number;
  return `${branch}/${account}`;
}

export function maskBankAccount(coords: BankAccountCoordinates): string {
  const visible = coords.number.slice(-4);
  return `${coords.branch}/${'*'.repeat(Math.max(coords.number.length - 4, 0))}${visible}`;
}

/** ISPB reservado ao Mock Bank. Nao colide com nenhuma instituicao real. */
export const MOCK_BANK_ISPB = '99999001';
export const MOCK_BANK_CODE = '999';
