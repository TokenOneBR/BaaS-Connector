import { BaasError, BaasErrorCode } from '../errors/index.js';

/**
 * Codec EMV MPM (BR Code) para Pix.
 *
 * Vale as ~300 linhas porque: todo provedor devolve o payload copia-e-cola,
 * varios devolvem malformado em sandbox, e precisamos parsear codigos colados
 * pelo usuario no caminho do Pix out de qualquer forma. Um codec unico que
 * constroi e le e testado contra fixtures da spec do BACEN elimina uma classe
 * inteira de bug de integracao.
 */

export interface EmvNode {
  id: string;
  value: string;
  /** Sub-TLVs, para templates como 26 (merchant account information). */
  children?: EmvNode[];
}

export const EMV_ID = {
  PAYLOAD_FORMAT_INDICATOR: '00',
  POINT_OF_INITIATION_METHOD: '01',
  MERCHANT_ACCOUNT_INFORMATION_PIX: '26',
  MERCHANT_CATEGORY_CODE: '52',
  TRANSACTION_CURRENCY: '53',
  TRANSACTION_AMOUNT: '54',
  COUNTRY_CODE: '58',
  MERCHANT_NAME: '59',
  MERCHANT_CITY: '60',
  POSTAL_CODE: '61',
  ADDITIONAL_DATA_FIELD: '62',
  CRC: '63',
} as const;

/** Sub-IDs dentro do template 26. */
export const EMV_PIX_ID = {
  GUI: '00',
  KEY: '01',
  DESCRIPTION: '02',
  URL: '25',
} as const;

/** Sub-ID dentro do template 62. */
export const EMV_ADDITIONAL_ID = { REFERENCE_LABEL: '05' } as const;

export const PIX_GUI = 'br.gov.bcb.pix';
export const BRL_CURRENCY_NUMERIC = '986';
export const BRAZIL_COUNTRY_CODE = 'BR';

/** Templates que contem sub-TLVs em vez de um valor simples. */
const NESTED_IDS = new Set(['26', '27', '62', '80', '81', '82']);

function invalid(message: string, cause?: unknown): BaasError {
  return new BaasError(BaasErrorCode.INVALID_EMV_PAYLOAD, { message, cause });
}

/** CRC-16/CCITT-FALSE, polinomio 0x1021, seed 0xFFFF. Exigido pelo BACEN. */
export function crc16(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function encodeNode(node: EmvNode): string {
  const value = node.children?.length ? node.children.map(encodeNode).join('') : node.value;
  if (value.length > 99) {
    throw invalid(`Campo EMV ${node.id} excede 99 caracteres`);
  }
  return `${node.id}${value.length.toString().padStart(2, '0')}${value}`;
}

/** Serializa nos e anexa o CRC calculado no campo 63. */
export function encodeEmv(nodes: readonly EmvNode[]): string {
  const body = nodes
    .filter((n) => n.id !== EMV_ID.CRC)
    .map(encodeNode)
    .join('');
  const withCrcHeader = `${body}${EMV_ID.CRC}04`;
  return `${withCrcHeader}${crc16(withCrcHeader)}`;
}

export function decodeEmv(payload: string): EmvNode[] {
  const nodes: EmvNode[] = [];
  let cursor = 0;

  while (cursor < payload.length) {
    if (cursor + 4 > payload.length) {
      throw invalid(`TLV truncado na posicao ${cursor}`);
    }
    const id = payload.slice(cursor, cursor + 2);
    const rawLength = payload.slice(cursor + 2, cursor + 4);
    if (!/^\d{2}$/.test(id) || !/^\d{2}$/.test(rawLength)) {
      throw invalid(`Cabecalho TLV invalido na posicao ${cursor}: ${id}${rawLength}`);
    }
    const length = Number(rawLength);
    const start = cursor + 4;
    const end = start + length;
    if (end > payload.length) {
      throw invalid(`Campo ${id} declara ${length} caracteres mas o payload terminou`);
    }
    const value = payload.slice(start, end);
    nodes.push(NESTED_IDS.has(id) ? { id, value, children: decodeEmv(value) } : { id, value });
    cursor = end;
  }

  return nodes;
}

export function findNode(nodes: readonly EmvNode[], id: string): EmvNode | undefined {
  return nodes.find((n) => n.id === id);
}

/** Confere o CRC declarado contra o recalculado sobre o corpo. */
export function verifyEmvCrc(payload: string): boolean {
  const marker = payload.lastIndexOf(`${EMV_ID.CRC}04`);
  if (marker < 0 || marker + 8 !== payload.length) return false;
  const declared = payload.slice(marker + 4);
  return crc16(payload.slice(0, marker + 4)) === declared.toUpperCase();
}

export interface BrCodeInput {
  pixKey: string;
  merchantName: string;
  merchantCity: string;
  /** Ausente para cobranca de valor aberto. */
  amount?: string;
  /** txid; '***' para estatico sem identificador. */
  referenceLabel?: string;
  description?: string;
  postalCode?: string;
  merchantCategoryCode?: string;
  /** Presente para cobranca dinamica: aponta para o payload no PSP. */
  url?: string;
  /** QR de uso unico. */
  singleUse?: boolean;
}

/** Normaliza texto para o subset aceito pelo BR Code (sem acento, maiusculo). */
function sanitizeText(value: string, maxLength: number): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '')
    .trim()
    .toUpperCase()
    .slice(0, maxLength);
}

export function buildBrCode(input: BrCodeInput): string {
  if (!input.url && !input.pixKey) {
    throw invalid('BR Code exige chave Pix ou URL de cobranca dinamica');
  }

  const merchantChildren: EmvNode[] = [{ id: EMV_PIX_ID.GUI, value: PIX_GUI }];
  if (input.url) {
    // Cobranca dinamica: a URL substitui a chave no template 26.
    merchantChildren.push({ id: EMV_PIX_ID.URL, value: input.url.replace(/^https?:\/\//, '') });
  } else {
    merchantChildren.push({ id: EMV_PIX_ID.KEY, value: input.pixKey });
    if (input.description) {
      merchantChildren.push({
        id: EMV_PIX_ID.DESCRIPTION,
        value: sanitizeText(input.description, 72 - input.pixKey.length),
      });
    }
  }

  const nodes: EmvNode[] = [
    { id: EMV_ID.PAYLOAD_FORMAT_INDICATOR, value: '01' },
    ...(input.singleUse ? [{ id: EMV_ID.POINT_OF_INITIATION_METHOD, value: '12' }] : []),
    { id: EMV_ID.MERCHANT_ACCOUNT_INFORMATION_PIX, value: '', children: merchantChildren },
    { id: EMV_ID.MERCHANT_CATEGORY_CODE, value: input.merchantCategoryCode ?? '0000' },
    { id: EMV_ID.TRANSACTION_CURRENCY, value: BRL_CURRENCY_NUMERIC },
    ...(input.amount ? [{ id: EMV_ID.TRANSACTION_AMOUNT, value: input.amount }] : []),
    { id: EMV_ID.COUNTRY_CODE, value: BRAZIL_COUNTRY_CODE },
    { id: EMV_ID.MERCHANT_NAME, value: sanitizeText(input.merchantName, 25) },
    { id: EMV_ID.MERCHANT_CITY, value: sanitizeText(input.merchantCity, 15) },
    ...(input.postalCode ? [{ id: EMV_ID.POSTAL_CODE, value: input.postalCode }] : []),
    {
      id: EMV_ID.ADDITIONAL_DATA_FIELD,
      value: '',
      children: [{ id: EMV_ADDITIONAL_ID.REFERENCE_LABEL, value: input.referenceLabel ?? '***' }],
    },
  ];

  return encodeEmv(nodes);
}

export interface ParsedBrCode {
  pixKey?: string;
  url?: string;
  merchantName?: string;
  merchantCity?: string;
  /** String decimal, como aparece no payload. */
  amount?: string;
  txid?: string;
  description?: string;
  singleUse: boolean;
  isDynamic: boolean;
  nodes: EmvNode[];
}

export function parseBrCode(payload: string): ParsedBrCode {
  const trimmed = payload.trim();
  if (!verifyEmvCrc(trimmed)) {
    throw invalid('CRC do BR Code nao confere');
  }

  const nodes = decodeEmv(trimmed);
  const merchant = findNode(nodes, EMV_ID.MERCHANT_ACCOUNT_INFORMATION_PIX);
  const merchantChildren = merchant?.children ?? [];
  const gui = findNode(merchantChildren, EMV_PIX_ID.GUI)?.value;
  if (gui?.toLowerCase() !== PIX_GUI) {
    throw invalid(`GUI ${gui ?? '(ausente)'} nao e um BR Code Pix`);
  }

  const url = findNode(merchantChildren, EMV_PIX_ID.URL)?.value;
  const additional = findNode(nodes, EMV_ID.ADDITIONAL_DATA_FIELD)?.children ?? [];
  const txid = findNode(additional, EMV_ADDITIONAL_ID.REFERENCE_LABEL)?.value;

  return {
    pixKey: findNode(merchantChildren, EMV_PIX_ID.KEY)?.value,
    url: url ? `https://${url}` : undefined,
    merchantName: findNode(nodes, EMV_ID.MERCHANT_NAME)?.value,
    merchantCity: findNode(nodes, EMV_ID.MERCHANT_CITY)?.value,
    amount: findNode(nodes, EMV_ID.TRANSACTION_AMOUNT)?.value,
    description: findNode(merchantChildren, EMV_PIX_ID.DESCRIPTION)?.value,
    txid: txid && txid !== '***' ? txid : undefined,
    singleUse: findNode(nodes, EMV_ID.POINT_OF_INITIATION_METHOD)?.value === '12',
    isDynamic: Boolean(url),
    nodes,
  };
}
