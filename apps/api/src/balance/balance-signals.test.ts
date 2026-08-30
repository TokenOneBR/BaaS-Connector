import {
  AccountKind,
  AccountStatus,
  BreakSeverity,
  BreakStatus,
  BreakType,
  Environment,
  FixedClock,
  ResolutionAction,
  newId,
} from '@baasconn/taxonomy';
import { beforeEach, describe, expect, it } from 'vitest';

import { MemoryAccountRepository } from '../persistence/memory/domain.repositories.js';
import { MemoryReconciliationBreakRepository } from '../persistence/memory/reconciliation.repositories.js';
import type { BreakUpsertRow } from '../reconciliation/reconciliation.types.js';

import { DefaultBalanceSignals } from './balance-signals.js';

const ENV = Environment.HOMOLOGACAO;
const CONEXAO = 'con_1';

/**
 * A regra 5 de bypass esteve implementada, testada e DESLIGADA desde o M6,
 * porque este sinal devolvia `false` fixo. `bypass-rules.test.ts` prova o que
 * a regra faz com o sinal; este arquivo prova que o sinal chega ate ela.
 */
describe('sinais de saldo', () => {
  let clock: FixedClock;
  let accounts: MemoryAccountRepository;
  let breaks: MemoryReconciliationBreakRepository;
  let signals: DefaultBalanceSignals;
  let accountId: string;

  beforeEach(async () => {
    clock = new FixedClock(new Date('2026-08-30T12:00:00.000Z'));
    accounts = new MemoryAccountRepository();
    breaks = new MemoryReconciliationBreakRepository();
    signals = new DefaultBalanceSignals(accounts, breaks);

    accountId = newId('account');
    await accounts.create({
      id: accountId,
      environment: ENV,
      holderId: newId('holder'),
      provider: 'mock-bank',
      providerConnectionId: CONEXAO,
      providerAccountId: 'mb-acc-1',
      externalId: null,
      status: AccountStatus.ACTIVE,
      kind: AccountKind.PAYMENT,
      currency: 'BRL',
      lastEventAt: new Date('2026-08-30T11:00:00.000Z'),
      metadata: {},
      createdAt: clock.now(),
      updatedAt: clock.now(),
    });
  });

  const abrir = async (overrides: Partial<BreakUpsertRow> = {}): Promise<string> => {
    const id = newId('reconciliationBreak');
    await breaks.upsertMany(
      [
        {
          id,
          environment: ENV,
          runId: newId('reconciliationRun'),
          connectionId: CONEXAO,
          accountId,
          type: BreakType.AMOUNT_MISMATCH,
          severity: BreakSeverity.CRITICAL,
          dedupeKey: `e2e:${id}`,
          effectiveDate: '2026-08-29',
          description: 'Divergencia.',
          evidence: {},
          ...overrides,
        },
      ],
      clock.now(),
    );
    return id;
  };

  it('conta sem quebra nao pede bypass', async () => {
    expect(await signals.hasHighSeverityBreak(ENV, accountId)).toBe(false);
  });

  it('quebra CRITICAL aberta pede bypass', async () => {
    await abrir();
    // Servir do cache um saldo de uma conta cujos numeros JA SABEMOS que
    // divergem e repetir um valor de que temos motivo para duvidar.
    expect(await signals.hasHighSeverityBreak(ENV, accountId)).toBe(true);
  });

  it('quebra HIGH tambem pede bypass', async () => {
    await abrir({ severity: BreakSeverity.HIGH });
    expect(await signals.hasHighSeverityBreak(ENV, accountId)).toBe(true);
  });

  it('quebra MEDIUM nao pede bypass', async () => {
    // Toda quebra desligar o cache faria o padrao `cached` deixar de existir
    // na pratica, e o endpoint do provedor tomaria rate limit.
    await abrir({ severity: BreakSeverity.MEDIUM });
    expect(await signals.hasHighSeverityBreak(ENV, accountId)).toBe(false);
  });

  it('quebra em investigacao continua pedindo bypass', async () => {
    const id = await abrir();
    await breaks.resolveManually({
      environment: ENV,
      id,
      status: BreakStatus.INVESTIGATING,
      resolution: ResolutionAction.ESCALATE_TO_PROVIDER,
      note: 'Aguardando o provedor responder.',
      resolvedBy: 'usr_admin',
      at: clock.now(),
    });

    // Escalada nao e conserto: o numero continua sob suspeita.
    expect(await signals.hasHighSeverityBreak(ENV, accountId)).toBe(true);
  });

  it('quebra resolvida para de pedir bypass', async () => {
    const id = await abrir();
    await breaks.resolveManually({
      environment: ENV,
      id,
      status: BreakStatus.RESOLVED,
      resolution: ResolutionAction.CREATE_LEDGER_ADJUSTMENT,
      note: 'Ajuste lancado.',
      resolvedBy: 'usr_admin',
      at: clock.now(),
    });

    expect(await signals.hasHighSeverityBreak(ENV, accountId)).toBe(false);
  });

  it('quebra de outra conta nao contamina esta', async () => {
    await abrir({ accountId: newId('account') });
    expect(await signals.hasHighSeverityBreak(ENV, accountId)).toBe(false);
  });

  it('quebra de outro ambiente nao contamina este', async () => {
    await abrir({ environment: Environment.PRODUCAO });
    expect(await signals.hasHighSeverityBreak(ENV, accountId)).toBe(false);
  });

  it('o ultimo movimento conhecido vem da conta', async () => {
    expect(await signals.lastKnownMovementAt(ENV, accountId)).toEqual(
      new Date('2026-08-30T11:00:00.000Z'),
    );
  });
});
