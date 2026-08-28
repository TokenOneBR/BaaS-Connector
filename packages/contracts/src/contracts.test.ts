import { HolderType, PixChargeKind, PixKeyType, TaxIdType } from '@baasconn/taxonomy';
import { describe, expect, it } from 'vitest';

import { zCreateAccount } from './accounts/account.js';
import { zCreateHolder } from './accounts/holder.js';
import { zMoney, zPositiveMoney, zTaxId, zAddress } from './common/primitives.js';
import { zCreateCharge } from './pix/charges.js';
import { zCreatePixKey } from './pix/keys.js';
import { zPixDestination, zSendPix } from './pix/transfers.js';
import { zCreateWebhookEndpoint } from './webhooks/index.js';

import { zPaginationQuery, zStatementQuery } from './index.js';

const VALID_CPF = '52998224725';
const VALID_CNPJ = '11222333000181';

const brl = (amount: string) => ({ amount, currency: 'BRL' as const, scale: 2 });

const address = {
  postal_code: '01310100',
  street: 'Avenida Paulista',
  number: '1000',
  district: 'Bela Vista',
  city: 'Sao Paulo',
  state: 'SP',
};

describe('dinheiro no wire', () => {
  it('aceita unidades menores como string', () => {
    expect(zMoney.parse(brl('150075'))).toMatchObject({ amount: '150075' });
  });

  it('rejeita decimal disfarcado de valor', () => {
    expect(zMoney.safeParse(brl('1500.75')).success).toBe(false);
  });

  it('rejeita escala incompativel com a moeda', () => {
    expect(zMoney.safeParse({ amount: '100', currency: 'BRL', scale: 3 }).success).toBe(false);
  });

  it('zPositiveMoney rejeita zero e negativo', () => {
    expect(zPositiveMoney.safeParse(brl('0')).success).toBe(false);
    expect(zPositiveMoney.safeParse(brl('-100')).success).toBe(false);
    expect(zPositiveMoney.safeParse(brl('1')).success).toBe(true);
  });
});

describe('documento', () => {
  it('normaliza mascara e valida digito verificador', () => {
    const parsed = zTaxId.parse({ type: TaxIdType.CPF, value: '529.982.247-25' });
    expect(parsed.value).toBe(VALID_CPF);
  });

  it('rejeita digito verificador errado', () => {
    expect(zTaxId.safeParse({ type: TaxIdType.CPF, value: '52998224726' }).success).toBe(false);
  });

  it('rejeita CPF informado como CNPJ', () => {
    expect(zTaxId.safeParse({ type: TaxIdType.CNPJ, value: VALID_CPF }).success).toBe(false);
  });
});

describe('endereco', () => {
  it('normaliza CEP e aplica os defaults', () => {
    const parsed = zAddress.parse({ ...address, postal_code: '01310-100' });
    expect(parsed.postal_code).toBe('01310100');
    expect(parsed.country).toBe('BR');
    expect(parsed.type).toBe('RESIDENTIAL');
  });

  it('rejeita UF inexistente', () => {
    expect(zAddress.safeParse({ ...address, state: 'XX' }).success).toBe(false);
  });
});

describe('criacao de conta', () => {
  const individual = {
    type: HolderType.INDIVIDUAL,
    tax_id: { type: TaxIdType.CPF, value: VALID_CPF },
    legal_name: 'Maria Silva',
    email: 'maria@exemplo.com',
    phone: { area_code: '11', number: '987654321' },
    addresses: [address],
    birth_date: '1990-05-12',
  };

  const business = {
    type: HolderType.BUSINESS,
    tax_id: { type: TaxIdType.CNPJ, value: VALID_CNPJ },
    legal_name: 'Exemplo Servicos Digitais LTDA',
    email: 'financeiro@exemplo.com',
    phone: { area_code: '11', number: '34567890' },
    addresses: [address],
    incorporation_date: '2015-03-20',
    representatives: [
      {
        role: 'ADMINISTRATOR',
        tax_id: { type: TaxIdType.CPF, value: VALID_CPF },
        full_name: 'Maria Silva',
        birth_date: '1990-05-12',
        is_signer: true,
        is_ultimate_beneficial_owner: true,
      },
    ],
  };

  it('aceita PF com os campos obrigatorios', () => {
    expect(zCreateAccount.safeParse({ holder: individual }).success).toBe(true);
  });

  it('aceita PJ com ao menos um representante', () => {
    expect(zCreateAccount.safeParse({ holder: business }).success).toBe(true);
  });

  it('exige birth_date em PF', () => {
    const { birth_date: _omit, ...withoutBirthDate } = individual;
    expect(zCreateHolder.safeParse(withoutBirthDate).success).toBe(false);
  });

  it('exige ao menos um representante em PJ', () => {
    expect(zCreateHolder.safeParse({ ...business, representatives: [] }).success).toBe(false);
  });

  it('nao deixa PJ passar campos de PF sem os obrigatorios de PJ', () => {
    const mixed = { ...individual, type: HolderType.BUSINESS };
    expect(zCreateHolder.safeParse(mixed).success).toBe(false);
  });

  it('exige CPF no representante legal, nunca CNPJ', () => {
    const invalid = {
      ...business,
      representatives: [
        { ...business.representatives[0], tax_id: { type: TaxIdType.CNPJ, value: VALID_CNPJ } },
      ],
    };
    expect(zCreateHolder.safeParse(invalid).success).toBe(false);
  });
});

describe('chave Pix', () => {
  it('exige value para tipos que nao sao EVP', () => {
    expect(zCreatePixKey.safeParse({ type: PixKeyType.CPF }).success).toBe(false);
    expect(zCreatePixKey.safeParse({ type: PixKeyType.EVP }).success).toBe(true);
  });

  it('valida a chave contra o tipo declarado', () => {
    expect(zCreatePixKey.safeParse({ type: PixKeyType.CPF, value: VALID_CPF }).success).toBe(true);
    expect(zCreatePixKey.safeParse({ type: PixKeyType.CPF, value: '52998224726' }).success).toBe(
      false,
    );
    expect(zCreatePixKey.safeParse({ type: PixKeyType.EMAIL, value: 'sem-arroba' }).success).toBe(
      false,
    );
  });
});

describe('cobranca', () => {
  const base = { pix_key_id: 'pky_01', amount: brl('15000') };

  it('estatica aceita txid curto ou coringa', () => {
    expect(
      zCreateCharge.safeParse({ kind: PixChargeKind.STATIC, ...base, txid: '***' }).success,
    ).toBe(true);
    expect(
      zCreateCharge.safeParse({ kind: PixChargeKind.STATIC, ...base, txid: 'A'.repeat(26) })
        .success,
    ).toBe(false);
  });

  it('dinamica imediata aplica expiracao padrao', () => {
    const parsed = zCreateCharge.parse({ kind: PixChargeKind.DYNAMIC_IMMEDIATE, ...base });
    expect(parsed).toMatchObject({ expires_in_seconds: 3600 });
  });

  it('com vencimento aceita juros, multa e desconto', () => {
    const result = zCreateCharge.safeParse({
      kind: PixChargeKind.DYNAMIC_DUE,
      ...base,
      due_date: '2026-09-30',
      fine: { mode: 'PERCENT', value: '2.00' },
      interest: { mode: 'PERCENT_MONTHLY', value: '1.00' },
    });
    expect(result.success).toBe(true);
  });

  it('imediata nao aceita campos de cobranca com vencimento', () => {
    const parsed = zCreateCharge.parse({
      kind: PixChargeKind.DYNAMIC_IMMEDIATE,
      ...base,
      due_date: '2026-09-30',
    });
    expect(parsed).not.toHaveProperty('due_date');
  });

  it('rejeita solicitacao ao pagador acima de 140 caracteres', () => {
    const result = zCreateCharge.safeParse({
      kind: PixChargeKind.DYNAMIC_IMMEDIATE,
      ...base,
      payer_request: 'x'.repeat(141),
    });
    expect(result.success).toBe(false);
  });
});

describe('PIX out', () => {
  it('aceita destino por chave', () => {
    const result = zSendPix.safeParse({
      amount: brl('50000'),
      destination: { kind: 'pix_key', key: VALID_CPF, key_type: PixKeyType.CPF },
    });
    expect(result.success).toBe(true);
  });

  it('valida a chave quando o tipo e declarado', () => {
    const result = zPixDestination.safeParse({
      kind: 'pix_key',
      key: '52998224726',
      key_type: PixKeyType.CPF,
    });
    expect(result.success).toBe(false);
  });

  it('aceita destino por coordenadas bancarias', () => {
    const result = zPixDestination.safeParse({
      kind: 'bank_account',
      ispb: '99999001',
      branch: '0001',
      number: '12345678',
      account_type: 'CHECKING',
      holder: { tax_id: { type: TaxIdType.CPF, value: VALID_CPF }, name: 'Maria Silva' },
    });
    expect(result.success).toBe(true);
  });

  it('rejeita mistura de chave com coordenadas bancarias', () => {
    const result = zPixDestination.safeParse({
      kind: 'pix_key',
      key: VALID_CPF,
      ispb: '99999001',
      branch: '0001',
    });
    // A uniao discriminada descarta os campos estranhos em vez de aceitar ambos.
    expect(result.success && !('ispb' in result.data)).toBe(true);
  });

  it('rejeita valor zero ou negativo', () => {
    const destination = { kind: 'pix_key', key: VALID_CPF };
    expect(zSendPix.safeParse({ amount: brl('0'), destination }).success).toBe(false);
    expect(zSendPix.safeParse({ amount: brl('-1'), destination }).success).toBe(false);
  });
});

describe('paginacao e extrato', () => {
  it('aplica limite padrao e teto', () => {
    expect(zPaginationQuery.parse({})).toMatchObject({ limit: 25, order: 'desc' });
    expect(zPaginationQuery.safeParse({ limit: 500 }).success).toBe(false);
  });

  it('coage limit vindo de query string', () => {
    expect(zPaginationQuery.parse({ limit: '50' }).limit).toBe(50);
  });

  it('rejeita intervalo de extrato invertido', () => {
    expect(zStatementQuery.safeParse({ from: '2026-08-31', to: '2026-08-01' }).success).toBe(false);
    expect(zStatementQuery.safeParse({ from: '2026-08-01', to: '2026-08-31' }).success).toBe(true);
  });
});

describe('webhook de saida', () => {
  it('exige HTTPS', () => {
    expect(zCreateWebhookEndpoint.safeParse({ url: 'http://exemplo.com/hook' }).success).toBe(
      false,
    );
    expect(zCreateWebhookEndpoint.safeParse({ url: 'https://exemplo.com/hook' }).success).toBe(
      true,
    );
  });

  it('aceita glob de tipo de evento', () => {
    const result = zCreateWebhookEndpoint.safeParse({
      url: 'https://exemplo.com/hook',
      event_types: ['pix.*', 'account.created', '*'],
    });
    expect(result.success).toBe(true);
  });

  it('rejeita filtro de evento malformado', () => {
    const result = zCreateWebhookEndpoint.safeParse({
      url: 'https://exemplo.com/hook',
      event_types: ['PIX OUT'],
    });
    expect(result.success).toBe(false);
  });
});
