import {
  Environment,
  ReconciliationScope,
  type ReconciliationSide,
  type TransactionStatus,
} from '@baasconn/taxonomy';

import { BrazilianBankCalendar } from './calendar.js';
import { fuzzyKey, strongKey } from './match-key.js';
import type {
  Direction,
  NormalizedItem,
  ReconciliationInput,
  ReconciliationPolicy,
} from './types.js';

export const ACCOUNT = 'acc_01JBQ8Z2K3TESTACCOUNT00001';

export function policy(overrides: Partial<ReconciliationPolicy> = {}): ReconciliationPolicy {
  return {
    settlementGraceMinutes: 120,
    amountToleranceCents: 1n,
    amountToleranceBasisPoints: 1n,
    dateToleranceBusinessDays: 2,
    autoResolveDateWithinBusinessDays: 1,
    criticalAmountDeltaCents: 1n,
    maxGreedyPairs: 20,
    calendar: new BrazilianBankCalendar(),
    ...overrides,
  };
}

export interface ItemSpec {
  id: string;
  side: ReconciliationSide;
  amountCents?: bigint;
  effectiveDate?: string;
  postedAt?: string;
  direction?: Direction;
  endToEndId?: string;
  providerTransactionId?: string;
  ledgerTransactionId?: string;
  status?: TransactionStatus;
  counterpartyTaxIdIndex?: string;
  type?: string;
  accountId?: string;
}

export function item(spec: ItemSpec): NormalizedItem {
  const accountId = spec.accountId ?? ACCOUNT;
  const amountCents = spec.amountCents ?? 150_000n;
  const effectiveDate = spec.effectiveDate ?? '2026-03-10';
  const direction = spec.direction ?? 'CREDIT';
  return {
    id: spec.id,
    side: spec.side,
    accountId,
    endToEndId: spec.endToEndId,
    providerTransactionId: spec.providerTransactionId,
    ledgerTransactionId: spec.ledgerTransactionId,
    postedAt: new Date(spec.postedAt ?? `${effectiveDate}T13:00:00.000Z`),
    effectiveDate,
    direction,
    amountCents,
    type: spec.type ?? 'PIX_IN',
    status: spec.status,
    counterpartyTaxIdIndex: spec.counterpartyTaxIdIndex,
    matchKeyStrong: strongKey({
      endToEndId: spec.endToEndId,
      providerTransactionId: spec.providerTransactionId,
    }),
    matchKeyFuzzy: fuzzyKey({ accountId, direction, amountCents, effectiveDate }),
    raw: {},
  };
}

export function input(
  parts: {
    provider?: NormalizedItem[];
    local?: NormalizedItem[];
    ledger?: NormalizedItem[];
    balances?: ReconciliationInput['balances'];
    now?: string;
    policy?: ReconciliationPolicy;
  } = {},
): ReconciliationInput {
  return {
    runId: 'rec_01JBQ8Z2K3TESTRUN00000001',
    environment: Environment.HOMOLOGACAO,
    connectionId: 'con_01JBQ8Z2K3TESTCONN0000001',
    accountId: ACCOUNT,
    scope: ReconciliationScope.DAILY,
    window: {
      start: new Date('2026-03-10T03:00:00.000Z'),
      end: new Date('2026-03-11T03:00:00.000Z'),
    },
    // Bem depois da janela: a graca de liquidacao so entra em cena onde o
    // teste a pede explicitamente.
    now: new Date(parts.now ?? '2026-03-12T12:00:00.000Z'),
    provider: parts.provider ?? [],
    local: parts.local ?? [],
    ledger: parts.ledger ?? [],
    balances: parts.balances ?? {},
    policy: parts.policy ?? policy(),
  };
}
