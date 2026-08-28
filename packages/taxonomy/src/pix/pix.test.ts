import { describe, expect, it } from 'vitest';

import { MOCK_BANK_ISPB } from '../br/bank.js';
import { PixKeyType } from '../enums/pix.js';

import { buildBrCode, crc16, decodeEmv, encodeEmv, parseBrCode, verifyEmvCrc } from './emv.js';
import {
  buildEndToEndId,
  inferPixKeyType,
  isValidEndToEndId,
  isValidPixKey,
  isValidTxid,
  maskPixKey,
  normalizePixKey,
  parseEndToEndId,
} from './identifiers.js';

const VALID_CPF = '52998224725';

describe('CRC-16/CCITT-FALSE', () => {
  it('reproduz o vetor de referencia da spec', () => {
    // Vetor classico: CRC de "123456789" e 0x29B1.
    expect(crc16('123456789')).toBe('29B1');
  });
});

describe('codec EMV', () => {
  it('codifica e decodifica TLV simples', () => {
    const encoded = encodeEmv([{ id: '00', value: '01' }]);
    expect(encoded.startsWith('000201')).toBe(true);
    expect(verifyEmvCrc(encoded)).toBe(true);
  });

  it('decodifica templates aninhados', () => {
    const nodes = decodeEmv('26140002BR0104TEST');
    expect(nodes[0]?.id).toBe('26');
    expect(nodes[0]?.children).toHaveLength(2);
  });

  it('rejeita TLV truncado', () => {
    expect(() => decodeEmv('0002')).toThrow(/terminou|truncado/);
  });

  it('rejeita cabecalho nao numerico', () => {
    expect(() => decodeEmv('XX02AB')).toThrow(/Cabecalho TLV invalido/);
  });
});

describe('BR Code', () => {
  it('constroi um QR estatico verificavel e le de volta', () => {
    const payload = buildBrCode({
      pixKey: VALID_CPF,
      merchantName: 'Loja Exemplo',
      merchantCity: 'Sao Paulo',
      amount: '150.75',
      referenceLabel: 'PEDIDO123',
    });

    expect(verifyEmvCrc(payload)).toBe(true);
    const parsed = parseBrCode(payload);
    expect(parsed.pixKey).toBe(VALID_CPF);
    expect(parsed.amount).toBe('150.75');
    expect(parsed.txid).toBe('PEDIDO123');
    expect(parsed.isDynamic).toBe(false);
    // Acentos sao removidos: o BR Code so aceita ASCII imprimivel.
    expect(parsed.merchantCity).toBe('SAO PAULO');
  });

  it('omite o valor em cobranca de valor aberto', () => {
    const parsed = parseBrCode(
      buildBrCode({ pixKey: VALID_CPF, merchantName: 'Loja', merchantCity: 'Sao Paulo' }),
    );
    expect(parsed.amount).toBeUndefined();
    expect(parsed.txid).toBeUndefined();
  });

  it('marca cobranca dinamica quando ha URL de payload', () => {
    const parsed = parseBrCode(
      buildBrCode({
        pixKey: '',
        url: 'https://psp.example.com/qr/v2/abc123',
        merchantName: 'Loja',
        merchantCity: 'Sao Paulo',
        referenceLabel: 'A'.repeat(26),
      }),
    );
    expect(parsed.isDynamic).toBe(true);
    expect(parsed.url).toBe('https://psp.example.com/qr/v2/abc123');
    expect(parsed.pixKey).toBeUndefined();
  });

  it('sinaliza QR de uso unico', () => {
    const payload = buildBrCode({
      pixKey: VALID_CPF,
      merchantName: 'Loja',
      merchantCity: 'Sao Paulo',
      singleUse: true,
    });
    expect(parseBrCode(payload).singleUse).toBe(true);
  });

  it('rejeita payload com CRC adulterado', () => {
    const payload = buildBrCode({
      pixKey: VALID_CPF,
      merchantName: 'Loja',
      merchantCity: 'Sao Paulo',
    });
    const tampered = `${payload.slice(0, -8)}6304FFFF`;
    expect(() => parseBrCode(tampered)).toThrow(/CRC/);
  });

  it('rejeita BR Code que nao seja Pix', () => {
    const notPix = encodeEmv([
      { id: '00', value: '01' },
      { id: '26', value: '', children: [{ id: '00', value: 'com.outra.coisa' }] },
    ]);
    expect(() => parseBrCode(notPix)).toThrow(/nao e um BR Code Pix/);
  });
});

describe('EndToEndId', () => {
  it('valida o formato do BACEN', () => {
    const e2e = buildEndToEndId({
      ispb: MOCK_BANK_ISPB,
      at: new Date('2026-08-28T14:03:00Z'),
      randomSuffix: 'ABCDE123456',
    });
    expect(e2e).toBe('E99999001202608281403ABCDE123456');
    expect(e2e).toHaveLength(32);
    expect(isValidEndToEndId(e2e)).toBe(true);
  });

  it('extrai ISPB e instante', () => {
    const parsed = parseEndToEndId('E99999001202608281403ABCDE123456');
    expect(parsed.ispb).toBe(MOCK_BANK_ISPB);
    expect(parsed.createdAt.toISOString()).toBe('2026-08-28T14:03:00.000Z');
    expect(parsed.prefix).toBe('E');
  });

  it('aceita o prefixo D de devolucao', () => {
    const returnId = buildEndToEndId({
      ispb: MOCK_BANK_ISPB,
      at: new Date('2026-08-28T14:03:00Z'),
      prefix: 'D',
      randomSuffix: 'ABCDE123456',
    });
    expect(parseEndToEndId(returnId).prefix).toBe('D');
  });

  it('rejeita formato invalido', () => {
    expect(isValidEndToEndId('E123')).toBe(false);
    expect(() => parseEndToEndId('nao-e-um-e2eid')).toThrow(/formato do BACEN/);
  });

  it('recusa sufixo com tamanho errado', () => {
    expect(() =>
      buildEndToEndId({ ispb: MOCK_BANK_ISPB, at: new Date(), randomSuffix: 'CURTO' }),
    ).toThrow(/11 caracteres/);
  });
});

describe('txid', () => {
  it('estatico aceita ate 25 caracteres ou o coringa', () => {
    expect(isValidTxid('***', 'static')).toBe(true);
    expect(isValidTxid('PEDIDO123', 'static')).toBe(true);
    expect(isValidTxid('A'.repeat(26), 'static')).toBe(false);
  });

  it('dinamico exige entre 26 e 35 caracteres', () => {
    expect(isValidTxid('A'.repeat(26), 'dynamic')).toBe(true);
    expect(isValidTxid('A'.repeat(35), 'dynamic')).toBe(true);
    expect(isValidTxid('A'.repeat(25), 'dynamic')).toBe(false);
  });
});

describe('chaves Pix', () => {
  it('normaliza para a forma canonica de armazenamento', () => {
    expect(normalizePixKey(PixKeyType.CPF, '529.982.247-25')).toBe(VALID_CPF);
    expect(normalizePixKey(PixKeyType.EMAIL, '  Joao@Exemplo.COM ')).toBe('joao@exemplo.com');
    expect(normalizePixKey(PixKeyType.PHONE, '(11) 98765-4321')).toBe('+5511987654321');
  });

  it('valida por tipo', () => {
    expect(isValidPixKey(PixKeyType.CPF, VALID_CPF)).toBe(true);
    expect(isValidPixKey(PixKeyType.CPF, '52998224726')).toBe(false);
    expect(isValidPixKey(PixKeyType.EVP, '9f2c4a1b-3d5e-4f60-8a91-2b3c4d5e6f70')).toBe(true);
    expect(isValidPixKey(PixKeyType.EVP, 'nao-e-uuid')).toBe(false);
    expect(isValidPixKey(PixKeyType.PHONE, '11987654321')).toBe(true);
  });

  it('deduz o tipo pelo formato', () => {
    expect(inferPixKeyType('9f2c4a1b-3d5e-4f60-8a91-2b3c4d5e6f70')).toBe(PixKeyType.EVP);
    expect(inferPixKeyType('joao@exemplo.com')).toBe(PixKeyType.EMAIL);
    expect(inferPixKeyType(VALID_CPF)).toBe(PixKeyType.CPF);
    expect(inferPixKeyType('11987654321')).toBe(PixKeyType.PHONE);
    expect(inferPixKeyType('nada disso')).toBeUndefined();
  });

  it('mascara sem revelar a chave inteira', () => {
    expect(maskPixKey(PixKeyType.CPF, VALID_CPF)).toBe('*******4725');
    expect(maskPixKey(PixKeyType.EMAIL, 'joao@exemplo.com')).toBe('j***@exemplo.com');
    expect(maskPixKey(PixKeyType.EVP, '9f2c4a1b-3d5e-4f60-8a91-2b3c4d5e6f70')).toBe(
      '9f2c4a1b-****-****-****-6f70',
    );
  });
});
