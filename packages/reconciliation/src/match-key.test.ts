import { describe, expect, it } from 'vitest';

import { dedupeKeyFor, fuzzyKey, strongKey } from './match-key.js';

describe('chave forte', () => {
  it('prefere E2EID e o namespaceia', () => {
    expect(strongKey({ endToEndId: 'E1', providerTransactionId: 'MB-9' })).toBe('e2e:E1');
  });

  it('cai para providerTransactionId com namespace proprio', () => {
    expect(strongKey({ providerTransactionId: 'MB-9' })).toBe('ptx:MB-9');
  });

  it('sem nenhum dos dois nao inventa chave', () => {
    expect(strongKey({})).toBeUndefined();
  });

  it('o mesmo valor nos dois campos produz chaves DIFERENTES', () => {
    // Sem o namespace, um provedor que use o E2EID como providerTransactionId
    // casaria o E2EID de um item com o providerTransactionId de outro — e o
    // casamento sairia como EXACT, que ninguem revisa.
    expect(strongKey({ endToEndId: 'X' })).not.toBe(strongKey({ providerTransactionId: 'X' }));
  });
});

describe('chave fuzzy', () => {
  const base = {
    accountId: 'acc_1',
    direction: 'CREDIT' as const,
    amountCents: 1050n,
    effectiveDate: '2026-03-10',
  };

  it('e estavel para a mesma entrada', () => {
    expect(fuzzyKey(base)).toBe(fuzzyKey({ ...base }));
  });

  it('muda com cada componente', () => {
    expect(fuzzyKey({ ...base, accountId: 'acc_2' })).not.toBe(fuzzyKey(base));
    expect(fuzzyKey({ ...base, direction: 'DEBIT' })).not.toBe(fuzzyKey(base));
    expect(fuzzyKey({ ...base, amountCents: 1051n })).not.toBe(fuzzyKey(base));
    expect(fuzzyKey({ ...base, effectiveDate: '2026-03-11' })).not.toBe(fuzzyKey(base));
  });

  it('os separadores impedem colisao entre campos vizinhos', () => {
    // Sem o `|`, "acc_1"+"CREDIT" colidiria com "acc_1C"+"REDIT".
    expect(fuzzyKey({ ...base, accountId: 'acc_1C' })).not.toBe(fuzzyKey(base));
  });
});

describe('chave de dedup de quebra', () => {
  it('E2EID vence tudo', () => {
    expect(dedupeKeyFor({ endToEndId: 'E1', accountId: 'acc_1', localItemId: 'txn_1' })).toBe(
      'e2e:E1',
    );
  });

  it('quebra de saldo e uma por conta', () => {
    expect(dedupeKeyFor({ accountId: 'acc_1', isBalanceBreak: true })).toBe('bal:acc_1');
  });

  it('sem E2EID, dois itens distintos produzem chaves DISTINTAS', () => {
    // E o defeito que a migration de dedup corrigiu: colapsar as duas numa so
    // faria o operador resolver uma achando que resolveu as duas.
    const a = dedupeKeyFor({ accountId: 'acc_1', providerItemId: 'pit_1' });
    const b = dedupeKeyFor({ accountId: 'acc_1', providerItemId: 'pit_2' });
    expect(a).not.toBe(b);
  });

  it('cai para a conta so quando nao ha item nenhum', () => {
    expect(dedupeKeyFor({ accountId: 'acc_1' })).toBe('acct:acc_1');
    expect(dedupeKeyFor({ accountId: 'acc_1', ledgerItemId: 'len_1' })).toBe('litem:len_1');
  });

  it('e sempre uma string nao vazia — a coluna e NOT NULL', () => {
    expect(dedupeKeyFor({ accountId: '' }).length).toBeGreaterThan(0);
  });
});
