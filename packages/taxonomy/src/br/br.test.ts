import { describe, expect, it } from 'vitest';

import { TaxIdType } from '../enums/core.js';

import { formatBankAccount, isValidIspb, maskBankAccount } from './bank.js';
import {
  formatPhone,
  isValidEmail,
  isValidPostalCode,
  maskEmail,
  maskPhone,
  parsePhone,
  phoneToE164,
} from './contact.js';
import {
  formatCnpj,
  formatCpf,
  inferTaxIdType,
  isValidCnpj,
  isValidCpf,
  maskTaxId,
  parseTaxId,
} from './tax-id.js';

// Documentos sinteticos com digito verificador valido, gerados para teste.
const VALID_CPF = '52998224725';
const VALID_CNPJ = '11222333000181';

describe('CPF', () => {
  it('aceita um documento com digitos verificadores corretos', () => {
    expect(isValidCpf(VALID_CPF)).toBe(true);
    expect(isValidCpf('529.982.247-25')).toBe(true);
  });

  it('rejeita digito verificador errado', () => {
    expect(isValidCpf('52998224726')).toBe(false);
  });

  it('rejeita sequencias repetidas, que passam no modulo 11 mas nao existem', () => {
    expect(isValidCpf('11111111111')).toBe(false);
    expect(isValidCpf('00000000000')).toBe(false);
  });

  it('rejeita comprimento incorreto', () => {
    expect(isValidCpf('123')).toBe(false);
    expect(isValidCpf('529982247250')).toBe(false);
  });

  it('formata e mascara preservando os ultimos quatro digitos', () => {
    expect(formatCpf(VALID_CPF)).toBe('529.982.247-25');
    expect(maskTaxId({ type: TaxIdType.CPF, value: VALID_CPF })).toBe('***.***.247-25');
  });
});

describe('CNPJ', () => {
  it('aceita um documento valido, com ou sem mascara', () => {
    expect(isValidCnpj(VALID_CNPJ)).toBe(true);
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
  });

  it('rejeita digito verificador errado e sequencia repetida', () => {
    expect(isValidCnpj('11222333000182')).toBe(false);
    expect(isValidCnpj('11111111111111')).toBe(false);
  });

  it('formata corretamente', () => {
    expect(formatCnpj(VALID_CNPJ)).toBe('11.222.333/0001-81');
  });
});

describe('inferTaxIdType / parseTaxId', () => {
  it('deduz pelo comprimento', () => {
    expect(inferTaxIdType(VALID_CPF)).toBe(TaxIdType.CPF);
    expect(inferTaxIdType(VALID_CNPJ)).toBe(TaxIdType.CNPJ);
    expect(inferTaxIdType('12345')).toBeUndefined();
  });

  it('parseTaxId devolve undefined para documento invalido', () => {
    expect(parseTaxId(VALID_CPF)).toEqual({ type: TaxIdType.CPF, value: VALID_CPF });
    expect(parseTaxId('52998224726')).toBeUndefined();
  });
});

describe('telefone', () => {
  it('parseia celular e fixo, com e sem codigo de pais', () => {
    expect(parsePhone('11987654321')).toEqual({
      countryCode: '55',
      areaCode: '11',
      number: '987654321',
    });
    expect(parsePhone('+5511987654321')?.number).toBe('987654321');
    expect(parsePhone('(11) 3456-7890')?.number).toBe('34567890');
  });

  it('rejeita celular de 9 digitos que nao comeca com 9', () => {
    expect(parsePhone('11887654321')).toBeUndefined();
  });

  it('rejeita DDD fora do intervalo brasileiro', () => {
    expect(parsePhone('01987654321')).toBeUndefined();
  });

  it('converte para E.164, que e o formato exigido na chave Pix', () => {
    const phone = parsePhone('11987654321');
    expect(phone && phoneToE164(phone)).toBe('+5511987654321');
  });

  it('formata e mascara', () => {
    const phone = parsePhone('11987654321')!;
    expect(formatPhone(phone)).toBe('(11) 98765-4321');
    expect(maskPhone(phone)).toBe('(11) *****-4321');
  });
});

describe('email e CEP', () => {
  it('valida email e mascara preservando o dominio', () => {
    expect(isValidEmail('lnugnes@tokenone.com.br')).toBe(true);
    expect(isValidEmail('sem-arroba')).toBe(false);
    expect(maskEmail('lnugnes@tokenone.com.br')).toBe('l******@tokenone.com.br');
  });

  it('valida CEP com oito digitos', () => {
    expect(isValidPostalCode('01310100')).toBe(true);
    expect(isValidPostalCode('01310-100')).toBe(true);
    expect(isValidPostalCode('1310100')).toBe(false);
  });
});

describe('coordenadas bancarias', () => {
  it('valida ISPB de oito digitos', () => {
    expect(isValidIspb('99999001')).toBe(true);
    expect(isValidIspb('9999900')).toBe(false);
  });

  it('formata e mascara conta', () => {
    const coords = { ispb: '99999001', branch: '0001', number: '12345678', checkDigit: '9' };
    expect(formatBankAccount(coords)).toBe('0001/12345678-9');
    expect(maskBankAccount(coords)).toBe('0001/****5678');
  });
});
