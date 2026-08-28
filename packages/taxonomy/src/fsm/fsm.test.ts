import { describe, expect, it } from 'vitest';

import { AccountStatus } from '../enums/account.js';
import { OnboardingStatus } from '../enums/onboarding.js';
import { TransactionStatus } from '../enums/transaction.js';
import { InvalidStateTransitionError } from '../errors/index.js';

import {
  applyTransition,
  assertRanksCoverTable,
  checkTransition,
  decideMonotonic,
  isTerminal,
} from './apply.js';
import {
  ACCOUNT_STATUS_RANKS,
  ACCOUNT_STATUS_TRANSITIONS,
  ONBOARDING_STATUS_RANKS,
  ONBOARDING_STATUS_TRANSITIONS,
  TRANSACTION_STATUS_RANKS,
  TRANSACTION_STATUS_TRANSITIONS,
} from './transitions.js';

describe('tabelas de transicao', () => {
  it('cobrem todos os valores do enum, sem estado orfao', () => {
    for (const status of Object.values(AccountStatus)) {
      expect(ACCOUNT_STATUS_TRANSITIONS).toHaveProperty(status);
    }
    for (const status of Object.values(TransactionStatus)) {
      expect(TRANSACTION_STATUS_TRANSITIONS).toHaveProperty(status);
    }
  });

  it('so apontam para estados que existem na propria tabela', () => {
    for (const [from, targets] of Object.entries(TRANSACTION_STATUS_TRANSITIONS)) {
      for (const to of targets) {
        expect(TRANSACTION_STATUS_TRANSITIONS, `${from} -> ${to}`).toHaveProperty(to);
      }
    }
  });

  it('SETTLED so evolui por reversao: nao ha volta para PROCESSING', () => {
    expect(TRANSACTION_STATUS_TRANSITIONS[TransactionStatus.SETTLED]).toEqual([
      TransactionStatus.REVERSED,
      TransactionStatus.PARTIALLY_REVERSED,
    ]);
  });

  it('UNKNOWN nao e terminal: a conciliacao precisa poder resolve-lo', () => {
    expect(isTerminal(TRANSACTION_STATUS_TRANSITIONS, TransactionStatus.UNKNOWN)).toBe(false);
    expect(isTerminal(TRANSACTION_STATUS_TRANSITIONS, TransactionStatus.FAILED)).toBe(true);
  });

  it('onboarding pode reabrir pendencias, porque provedores fazem isso', () => {
    expect(ONBOARDING_STATUS_TRANSITIONS.IN_ANALYSIS).toContain('PENDING_REQUIREMENTS');
  });
});

describe('applyTransition', () => {
  it('aceita transicao valida', () => {
    expect(
      applyTransition(
        'account',
        ACCOUNT_STATUS_TRANSITIONS,
        AccountStatus.DRAFT,
        AccountStatus.PENDING_ONBOARDING,
      ),
    ).toBe(AccountStatus.PENDING_ONBOARDING);
  });

  it('lanca em transicao invalida com contexto util na mensagem', () => {
    expect(() =>
      applyTransition(
        'account',
        ACCOUNT_STATUS_TRANSITIONS,
        AccountStatus.CLOSED,
        AccountStatus.ACTIVE,
      ),
    ).toThrow(InvalidStateTransitionError);
    expect(() =>
      applyTransition(
        'account',
        ACCOUNT_STATUS_TRANSITIONS,
        AccountStatus.CLOSED,
        AccountStatus.ACTIVE,
      ),
    ).toThrow(/CLOSED -> ACTIVE/);
  });

  it('trata origem igual a destino como no-op, nao como erro', () => {
    const check = checkTransition(
      ACCOUNT_STATUS_TRANSITIONS,
      AccountStatus.ACTIVE,
      AccountStatus.ACTIVE,
    );
    expect(check).toMatchObject({ allowed: true, noop: true });
  });
});

describe('guard monotonico', () => {
  const ranks = TRANSACTION_STATUS_RANKS;
  const now = new Date('2026-08-28T12:00:00Z');

  it('aplica um evento que avanca o estado', () => {
    expect(
      decideMonotonic({
        current: TransactionStatus.PROCESSING,
        incoming: TransactionStatus.SETTLED,
        ranks,
        occurredAt: now,
      }),
    ).toEqual({ apply: true });
  });

  it('descarta evento fora de ordem que tentaria desfazer uma liquidacao', () => {
    const decision = decideMonotonic({
      current: TransactionStatus.SETTLED,
      incoming: TransactionStatus.PENDING,
      ranks,
      occurredAt: now,
    });
    expect(decision).toEqual({ apply: false, reason: 'stale_rank' });
  });

  it('descarta reentrega duplicada do mesmo estado', () => {
    expect(
      decideMonotonic({
        current: TransactionStatus.SETTLED,
        incoming: TransactionStatus.SETTLED,
        ranks,
        occurredAt: now,
      }),
    ).toEqual({ apply: false, reason: 'same_state' });
  });

  it('descarta evento com timestamp anterior ao ultimo aplicado', () => {
    expect(
      decideMonotonic({
        current: TransactionStatus.PENDING,
        incoming: TransactionStatus.SETTLED,
        ranks,
        occurredAt: new Date('2026-08-28T11:00:00Z'),
        lastEventAt: now,
      }),
    ).toEqual({ apply: false, reason: 'stale_timestamp' });
  });

  it('ranqueia estados terminais acima dos intermediarios', () => {
    expect(ranks[TransactionStatus.SETTLED]).toBeGreaterThan(ranks[TransactionStatus.PROCESSING]);
    expect(ranks[TransactionStatus.PROCESSING]).toBeGreaterThan(ranks[TransactionStatus.CREATED]);
  });

  it('deixa UNKNOWN abaixo de tudo: qualquer fato do provedor o supera', () => {
    expect(ranks[TransactionStatus.UNKNOWN]).toBe(0);
    expect(
      decideMonotonic({
        current: TransactionStatus.UNKNOWN,
        incoming: TransactionStatus.FAILED,
        ranks,
        occurredAt: now,
      }),
    ).toEqual({ apply: true });
  });

  it('nao deixa FAILED sobrescrever SETTLED por chegar depois', () => {
    // Sao desfechos alternativos do mesmo ponto; rank igual barra os dois sentidos.
    expect(ranks[TransactionStatus.FAILED]).toBe(ranks[TransactionStatus.SETTLED]);
    expect(
      decideMonotonic({
        current: TransactionStatus.SETTLED,
        incoming: TransactionStatus.FAILED,
        ranks,
        occurredAt: now,
      }),
    ).toEqual({ apply: false, reason: 'stale_rank' });
  });

  it('toda tabela de transicao tem rank declarado para cada estado', () => {
    expect(() =>
      assertRanksCoverTable(TRANSACTION_STATUS_TRANSITIONS, TRANSACTION_STATUS_RANKS),
    ).not.toThrow();
    expect(() =>
      assertRanksCoverTable(ACCOUNT_STATUS_TRANSITIONS, ACCOUNT_STATUS_RANKS),
    ).not.toThrow();
    expect(() =>
      assertRanksCoverTable(ONBOARDING_STATUS_TRANSITIONS, ONBOARDING_STATUS_RANKS),
    ).not.toThrow();
  });

  it('detecta um estado novo do enum que ficou sem rank', () => {
    const { [OnboardingStatus.APPROVED]: _omitted, ...incomplete } = ONBOARDING_STATUS_RANKS;
    expect(() =>
      assertRanksCoverTable(
        ONBOARDING_STATUS_TRANSITIONS,
        incomplete as typeof ONBOARDING_STATUS_RANKS,
      ),
    ).toThrow(/APPROVED/);
  });
});
