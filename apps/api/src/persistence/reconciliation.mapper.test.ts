import { BreakSeverity, BreakStatus, BreakType, Environment } from '@baasconn/taxonomy';
import { describe, expect, it } from 'vitest';

import { toBreak } from './reconciliation.repositories.js';

const linha = (overrides: Record<string, unknown> = {}) => ({
  id: 'brk_1',
  environment: Environment.HOMOLOGACAO,
  runId: 'rec_1',
  firstSeenRunId: 'rec_1',
  connectionId: 'con_1',
  accountId: 'acc_1',
  type: BreakType.MISSING_ON_PROVIDER,
  severity: BreakSeverity.CRITICAL,
  status: BreakStatus.OPEN,
  dedupeKey: 'e2e:brk_1',
  effectiveDate: new Date('2026-08-29T00:00:00.000Z'),
  endToEndId: null,
  amountCents: 50_000n,
  deltaCents: null,
  providerItemId: null,
  localItemId: 'rci_1',
  ledgerItemId: null,
  description: 'Debito registrado que o provedor nunca teve.',
  evidence: { provedor: null, local: { valor_cents: '50000' } },
  ageDays: 3,
  assignedTo: null,
  resolution: null,
  resolutionNote: null,
  resolvedBy: null,
  resolvedAt: null,
  adjustmentTransactionId: null,
  createdAt: new Date('2026-08-27T12:00:00.000Z'),
  ...overrides,
});

describe('toBreak', () => {
  it('carrega a evidencia dos dois lados', () => {
    // A tela lado a lado e o motivo de a conciliacao ter interface. Este
    // mapper ja deixou de copiar `evidence` e o defeito passou pela revisao,
    // porque os testes de rota usam o dobro em memoria, onde o campo chega
    // sozinho por spread.
    expect(toBreak(linha()).evidence).toEqual({
      provedor: null,
      local: { valor_cents: '50000' },
    });
  });

  it('evidencia ausente vira objeto vazio, nao `undefined`', () => {
    // O contrato a declara obrigatoria. `undefined` faria `respond` reprovar a
    // resposta inteira por causa de uma linha antiga.
    expect(toBreak(linha({ evidence: null })).evidence).toEqual({});
  });

  it('nulo do banco vira ausente, nao `null`', () => {
    // O dominio usa `undefined` para "nao ha"; deixar `null` passar faria
    // `quebra.accountId` ser truthy-falso em toda checagem do servico.
    const record = toBreak(linha({ accountId: null, deltaCents: null }));
    expect(record.accountId).toBeUndefined();
    expect(record.deltaCents).toBeUndefined();
  });

  it('a data contabil vira YYYY-MM-DD, sem hora', () => {
    // `effectiveDate` e data CONTABIL. Carregar hora faria a comparacao de
    // janela da conciliacao depender do fuso de quem le.
    expect(toBreak(linha()).effectiveDate).toBe('2026-08-29');
  });

  it('preserva `bigint` de dinheiro', () => {
    expect(toBreak(linha()).amountCents).toBe(50_000n);
  });
});
