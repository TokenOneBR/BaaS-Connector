import { describe, expect, it } from 'vitest';

import { ID_PREFIX, idKindOf, idTimestamp, isId, newId, parseId } from './index.js';

describe('identificadores', () => {
  it('gera no formato prefixo_ULID', () => {
    const id = newId('account');
    expect(id).toMatch(/^acc_[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('sao lexicograficamente ordenaveis no tempo', () => {
    const first = newId('transaction');
    const second = newId('transaction');
    expect(first <= second).toBe(true);
  });

  it('parseId recusa um id de outro tipo', () => {
    const accountId = newId('account');
    expect(() => parseId('transaction', accountId)).toThrow(/Identificador invalido/);
    expect(parseId('account', accountId)).toBe(accountId);
  });

  it('isId nao aceita string arbitraria', () => {
    expect(isId('account', 'acc_naoehulid')).toBe(false);
    expect(isId('account', 42 as unknown as string)).toBe(false);
  });

  it('descobre o tipo pelo prefixo', () => {
    expect(idKindOf(newId('pixCharge'))).toBe('pixCharge');
    expect(idKindOf('zzz_0000')).toBeUndefined();
  });

  it('extrai o instante de criacao sem consultar o banco', () => {
    const before = Date.now();
    const id = newId('event');
    const extracted = idTimestamp(id).getTime();
    expect(extracted).toBeGreaterThanOrEqual(before - 1000);
    expect(extracted).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('todos os prefixos sao distintos', () => {
    const values = Object.values(ID_PREFIX);
    expect(new Set(values).size).toBe(values.length);
  });
});
