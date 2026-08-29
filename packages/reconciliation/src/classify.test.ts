import {
  BreakSeverity,
  BreakType,
  ReconciliationSide,
  TransactionStatus,
} from '@baasconn/taxonomy';
import { describe, expect, it } from 'vitest';

import {
  amountMismatchSeverity,
  dateMismatchSeverity,
  importIntent,
  localClaimsSettledButProviderFailed,
  missingOnLocalSeverity,
  missingOnProviderSeverity,
  orphanProviderBreakType,
  orphanProviderSeverity,
  providerIsAhead,
  statusIntent,
  statusMismatchSeverity,
  timingIntent,
} from './classify.js';
import { item, policy } from './test-support.js';

describe('severidade por sentido', () => {
  it('credito faltando no nosso lado e alto; debito e critico', () => {
    expect(missingOnLocalSeverity(item({ id: 'p', side: ReconciliationSide.PROVIDER }))).toBe(
      BreakSeverity.HIGH,
    );
    expect(
      missingOnLocalSeverity(
        item({ id: 'p', side: ReconciliationSide.PROVIDER, direction: 'DEBIT' }),
      ),
    ).toBe(BreakSeverity.CRITICAL);
  });

  it('debito faltando no provedor e critico; credito e alto', () => {
    expect(
      missingOnProviderSeverity(
        item({ id: 'c', side: ReconciliationSide.LOCAL, direction: 'DEBIT' }),
      ),
    ).toBe(BreakSeverity.CRITICAL);
    expect(missingOnProviderSeverity(item({ id: 'c', side: ReconciliationSide.LOCAL }))).toBe(
      BreakSeverity.HIGH,
    );
  });
});

describe('provedor a frente', () => {
  it('rank maior com transicao legal e estar a frente', () => {
    expect(providerIsAhead(TransactionStatus.PROCESSING, TransactionStatus.SETTLED)).toBe(true);
  });

  it('mesmo status nao e estar a frente', () => {
    expect(providerIsAhead(TransactionStatus.SETTLED, TransactionStatus.SETTLED)).toBe(false);
  });

  it('rank menor nunca e estar a frente', () => {
    expect(providerIsAhead(TransactionStatus.SETTLED, TransactionStatus.PENDING)).toBe(false);
  });

  it('rank empatado e transicao ilegal nao e estar a frente, e contradicao', () => {
    // FAILED e SETTLED empatam de proposito na taxonomia: um nunca sobrescreve
    // o outro por chegar depois.
    expect(providerIsAhead(TransactionStatus.FAILED, TransactionStatus.SETTLED)).toBe(false);
    expect(providerIsAhead(TransactionStatus.SETTLED, TransactionStatus.FAILED)).toBe(false);
  });

  it('UNKNOWN e o fundo do poco: qualquer desfecho esta a frente', () => {
    expect(providerIsAhead(TransactionStatus.UNKNOWN, TransactionStatus.SETTLED)).toBe(true);
  });
});

describe('contradicao de liquidacao', () => {
  it('nosso SETTLED contra FAILED ou CANCELLED e sempre critico', () => {
    expect(
      localClaimsSettledButProviderFailed(TransactionStatus.SETTLED, TransactionStatus.CANCELLED),
    ).toBe(true);
    expect(statusMismatchSeverity(TransactionStatus.SETTLED, TransactionStatus.FAILED)).toBe(
      BreakSeverity.CRITICAL,
    );
  });

  it('as demais divergencias de status sao medias', () => {
    expect(statusMismatchSeverity(TransactionStatus.PENDING, TransactionStatus.PROCESSING)).toBe(
      BreakSeverity.MEDIUM,
    );
  });

  it('a intencao de aplicar o status do provedor so existe quando ele esta a frente', () => {
    expect(
      statusIntent('txn_1', TransactionStatus.SETTLED, TransactionStatus.FAILED),
    ).toBeUndefined();
    expect(
      statusIntent('txn_1', TransactionStatus.PENDING, TransactionStatus.SETTLED),
    ).toBeDefined();
  });
});

describe('intencao de importacao', () => {
  const doProvedor = (direction: 'CREDIT' | 'DEBIT') =>
    item({ id: 'pit_1', side: ReconciliationSide.PROVIDER, direction });

  it('so credito, so do provedor, so sem ambiguidade', () => {
    expect(importIntent(doProvedor('CREDIT'), false)).toBeDefined();
    expect(importIntent(doProvedor('CREDIT'), true)).toBeUndefined();
    expect(importIntent(doProvedor('DEBIT'), false)).toBeUndefined();
    expect(
      importIntent(item({ id: 'txn_1', side: ReconciliationSide.LOCAL }), false),
    ).toBeUndefined();
  });
});

describe('tolerancias', () => {
  it('a severidade de valor respeita o limiar critico', () => {
    const p = policy({ criticalAmountDeltaCents: 100n });
    expect(amountMismatchSeverity(100n, p)).toBe(BreakSeverity.MEDIUM);
    expect(amountMismatchSeverity(-101n, p)).toBe(BreakSeverity.CRITICAL);
  });

  it('a deriva de data dentro da auto-resolucao e baixa', () => {
    const p = policy({ autoResolveDateWithinBusinessDays: 1 });
    expect(dateMismatchSeverity(1, p)).toBe(BreakSeverity.LOW);
    expect(dateMismatchSeverity(2, p)).toBe(BreakSeverity.MEDIUM);
  });

  it('a intencao de ignorar deriva temporal para no limite configurado', () => {
    const p = policy({ autoResolveDateWithinBusinessDays: 1 });
    const base = { localItemId: 'txn_1', providerItemId: 'pit_1', policy: p };
    expect(timingIntent({ ...base, driftBusinessDays: 1 })).toBeDefined();
    expect(timingIntent({ ...base, driftBusinessDays: 2 })).toBeUndefined();
  });
});

describe('orfaos do provedor', () => {
  const doProvedor = (type: string, direction: 'CREDIT' | 'DEBIT' = 'CREDIT') =>
    item({ id: 'pit_1', side: ReconciliationSide.PROVIDER, type, direction });

  it('tarifa e devolucao tem tipo proprio', () => {
    expect(orphanProviderBreakType(doProvedor('FEE'))).toBe(BreakType.UNMATCHED_FEE);
    expect(orphanProviderBreakType(doProvedor('REFUND'))).toBe(BreakType.ORPHAN_REFUND);
    expect(orphanProviderBreakType(doProvedor('PIX_IN'))).toBe(BreakType.MISSING_ON_LOCAL);
  });

  it('a severidade acompanha o tipo', () => {
    expect(orphanProviderSeverity(doProvedor('FEE'))).toBe(BreakSeverity.MEDIUM);
    expect(orphanProviderSeverity(doProvedor('REFUND'))).toBe(BreakSeverity.HIGH);
    expect(orphanProviderSeverity(doProvedor('PIX_OUT', 'DEBIT'))).toBe(BreakSeverity.CRITICAL);
  });
});
