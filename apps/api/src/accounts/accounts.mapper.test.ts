import { AccountKind, AccountStatus, HolderType, TaxIdType, maskTaxId } from '@baasconn/taxonomy';
import { describe, expect, it } from 'vitest';

import { toAccountDto } from './accounts.mapper.js';
import type { AccountRecord, HolderRecord } from './accounts.types.js';

const holder: HolderRecord = {
  id: 'hld_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  environment: 'HOMOLOGACAO' as never,
  type: HolderType.BUSINESS,
  taxIdType: TaxIdType.CNPJ,
  taxIdBlindIndex: 'a'.repeat(64),
  taxIdLast4: '0181',
  legalName: 'Exemplo LTDA',
  email: 'a@b.com',
  createdAt: new Date('2026-08-28T12:00:00.000Z'),
};

const account: AccountRecord = {
  id: 'acc_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  environment: 'HOMOLOGACAO' as never,
  holderId: holder.id,
  provider: 'MOCK_BANK',
  providerConnectionId: 'con_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  providerAccountId: 'mb-1',
  status: AccountStatus.ACTIVE,
  kind: AccountKind.PAYMENT,
  currency: 'BRL',
  ispb: '99999001',
  branch: '0001',
  number: '1000001',
  checkDigit: '3',
  metadata: {},
  createdAt: new Date('2026-08-28T12:00:00.000Z'),
  updatedAt: new Date('2026-08-28T12:00:00.000Z'),
};

describe('resposta de conta', () => {
  it('mascara o documento por padrao', () => {
    const dto = toAccountDto(account, holder);
    expect(dto.holder_tax_id).toBe('**.***.***/**01-81');
    // O documento completo nunca aparece por omissao.
    expect(dto.holder_tax_id).not.toContain('11222333');
  });

  it('mascara CPF no formato brasileiro', () => {
    const dto = toAccountDto(account, {
      ...holder,
      type: HolderType.INDIVIDUAL,
      taxIdType: TaxIdType.CPF,
      taxIdLast4: '8901',
    });
    expect(dto.holder_tax_id).toBe('***.***.*89-01');
  });

  it('esconde ao menos tanto quanto maskTaxId', () => {
    // Guardamos quatro digitos e o maskTaxId preserva cinco: a diferenca erra
    // para o lado seguro, e este teste impede que alguem "corrija" isso
    // afrouxando a mascara.
    const completo = maskTaxId({ type: TaxIdType.CPF, value: '12345678901' });
    const nosso = toAccountDto(account, {
      ...holder,
      type: HolderType.INDIVIDUAL,
      taxIdType: TaxIdType.CPF,
      taxIdLast4: '8901',
    }).holder_tax_id;

    const visiveis = (value: string) => (value.match(/\d/g) ?? []).length;
    expect(visiveis(nosso)).toBeLessThanOrEqual(visiveis(completo));
  });

  it('desmascara so quando o chamador entrega o valor completo', () => {
    // O escopo pii:read e verificado no controller, e cada desmascaramento
    // gera linha de auditoria — o mapper so obedece.
    const dto = toAccountDto(account, holder, { unmaskedTaxId: '11222333000181' });
    expect(dto.holder_tax_id).toBe('11222333000181');
  });

  it('omite coordenadas bancarias enquanto a conta nao abriu', () => {
    const dto = toAccountDto({ ...account, ispb: null }, holder);
    expect(dto.bank).toBeNull();
  });
});
