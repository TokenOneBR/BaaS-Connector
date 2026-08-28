import { monotonicFactory } from 'ulid';

/**
 * Fabrica monotonica: duas chamadas no mesmo milissegundo ainda ordenam
 * corretamente. Sem isso, a ordenacao lexicografica que justifica escolher
 * ULID sobre UUIDv4 quebra justamente sob carga, que e quando importa.
 */
const ulid = monotonicFactory();

/**
 * Prefixos de identificador do conector.
 *
 * ULID com prefixo em vez de UUIDv4: ULID e ordenavel no tempo, entao inserts
 * na chave primaria sao append-mostly (sem page split no B-tree), e o prefixo
 * torna todo log, ticket e stack trace auto-descritivo.
 */
export const ID_PREFIX = {
  apiKey: 'key',
  connection: 'con',
  holder: 'hld',
  address: 'adr',
  representative: 'rep',
  account: 'acc',
  onboarding: 'onb',
  requirement: 'req',
  screening: 'scr',
  document: 'doc',
  pixKey: 'pky',
  pixCharge: 'chg',
  transaction: 'txn',
  operation: 'opr',
  event: 'evt',
  delivery: 'dlv',
  webhookEndpoint: 'whe',
  inboundEvent: 'ibe',
  ledgerAccount: 'lac',
  ledgerTransaction: 'ltx',
  ledgerEntry: 'len',
  reconciliationRun: 'rec',
  reconciliationItem: 'rci',
  reconciliationBreak: 'brk',
  idempotency: 'idm',
  audit: 'aud',
  providerCall: 'pcl',
  user: 'usr',
} as const;

export type IdKind = keyof typeof ID_PREFIX;

/**
 * String com marca de tipo. Impede em tempo de compilacao passar um
 * `Id<'account'>` onde se espera um `Id<'transaction'>`.
 */
export type Id<K extends IdKind> = string & { readonly __idKind: K };

const ULID_RE = '[0-9A-HJKMNP-TV-Z]{26}';

export function newId<K extends IdKind>(kind: K): Id<K> {
  return `${ID_PREFIX[kind]}_${ulid()}` as Id<K>;
}

export function isId<K extends IdKind>(kind: K, value: unknown): value is Id<K> {
  return typeof value === 'string' && new RegExp(`^${ID_PREFIX[kind]}_${ULID_RE}$`).test(value);
}

export function parseId<K extends IdKind>(kind: K, value: string): Id<K> {
  if (!isId(kind, value)) {
    throw new TypeError(
      `Identificador invalido para "${kind}": esperado ${ID_PREFIX[kind]}_<ULID>, recebido ${JSON.stringify(value)}`,
    );
  }
  return value;
}

/** Descobre o tipo a partir do prefixo. Util para roteamento generico e logs. */
export function idKindOf(value: string): IdKind | undefined {
  const prefix = value.split('_', 1)[0];
  return (Object.keys(ID_PREFIX) as IdKind[]).find((k) => ID_PREFIX[k] === prefix);
}

/** Instante de criacao embutido no ULID. Sem consultar o banco. */
export function idTimestamp(value: string): Date {
  const body = value.slice(value.indexOf('_') + 1);
  if (!new RegExp(`^${ULID_RE}$`).test(body)) {
    throw new TypeError(`Nao e um identificador ULID: ${JSON.stringify(value)}`);
  }
  const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let ms = 0;
  for (const char of body.slice(0, 10)) {
    ms = ms * 32 + CROCKFORD.indexOf(char);
  }
  return new Date(ms);
}
