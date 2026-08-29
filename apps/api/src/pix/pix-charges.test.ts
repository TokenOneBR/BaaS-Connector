import type { PixCharge } from '@baasconn/provider-spi';
import {
  AccountKind,
  AccountStatus,
  BaasErrorCode,
  Environment,
  FixedClock,
  Money,
  PixChargeKind,
  PixChargeStatus,
  PixKeyStatus,
  PixKeyType,
  buildBrCode,
  newId,
} from '@baasconn/taxonomy';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AccountRecord } from '../accounts/accounts.types.js';
import { ApiConfig } from '../config/config.service.js';
import {
  MemoryAccountRepository,
  MemoryOutboxRepository,
} from '../persistence/memory/domain.repositories.js';
import {
  MemoryPixChargeRepository,
  MemoryPixKeyRepository,
} from '../persistence/memory/pix.repositories.js';

import { PixChargesService, toPixChargeDto } from './pix-charges.service.js';
import type { PixKeyRecord } from './pix.types.js';

const ENV = Environment.HOMOLOGACAO;
const KEY_VALUE = 'lojista@exemplo.test';

function brCode(pixKey: string, amount?: string): string {
  return buildBrCode({ pixKey, merchantName: 'LOJA', merchantCity: 'SAO PAULO', amount });
}

describe('cobrancas Pix', () => {
  let charges: MemoryPixChargeRepository;
  let service: PixChargesService;
  let account: AccountRecord;
  let key: PixKeyRecord;
  let provided: PixCharge;

  beforeEach(async () => {
    const clock = new FixedClock(new Date('2026-08-29T12:00:00.000Z'));
    const accounts = new MemoryAccountRepository();
    const keys = new MemoryPixKeyRepository();
    charges = new MemoryPixChargeRepository();

    account = {
      id: newId('account'),
      environment: ENV,
      holderId: newId('holder'),
      provider: 'mock-bank',
      providerConnectionId: 'con_1',
      providerAccountId: 'mb-acc-1',
      externalId: null,
      status: AccountStatus.ACTIVE,
      kind: AccountKind.PAYMENT,
      currency: 'BRL',
      metadata: {},
      createdAt: clock.now(),
      updatedAt: clock.now(),
    };
    await accounts.create(account);

    key = await keys.create({
      id: newId('pixKey'),
      environment: ENV,
      accountId: account.id,
      type: PixKeyType.EMAIL,
      value: KEY_VALUE,
      valueBlindIndex: 'x'.repeat(64),
      status: PixKeyStatus.ACTIVE,
      requestedAt: clock.now(),
    });

    provided = {
      txid: 'TXID0000000000000000000001',
      kind: 'static',
      status: PixChargeStatus.ACTIVE,
      amount: Money.of(150_00n).toJSON(),
      emvPayload: brCode(KEY_VALUE, '150.00'),
    };

    const providers = {
      require: vi.fn(async () => ({
        slug: 'mock-bank',
        adapter: {
          pixCharges: {
            createStatic: vi.fn(async () => provided),
            createDynamic: vi.fn(async () => provided),
            cancel: vi.fn(async () => provided),
          },
        },
      })),
    };

    service = new PixChargesService(
      providers as never,
      new ApiConfig(),
      accounts,
      keys,
      charges,
      new MemoryOutboxRepository(),
      clock,
    );
  });

  const actor = () => ({
    environment: ENV,
    connectionId: 'con_1',
    apiKeyId: 'key_1',
    scopes: ['pix:write'] as const,
  });

  const dto = () => ({
    kind: PixChargeKind.STATIC as const,
    pix_key_id: key.id,
    amount: Money.of(150_00n).toJSON(),
    amount_is_changeable: false,
    additional_info: [],
    metadata: {},
  });

  it('grava a cobranca com o payload copia-e-cola', async () => {
    const charge = await service.create(actor(), account.id, dto());
    expect(charge.txid).toBe(provided.txid);
    expect(charge.emvPayload).toBe(provided.emvPayload);
    expect(charge.amountCents).toBe(15_000n);
  });

  it('recusa BR Code com CRC quebrado antes de gravar', async () => {
    // Provedor devolver EMV malformado em sandbox e comum. Guardar sem
    // conferir faz o QR falhar no BALCAO, com o erro aparecendo do lado do
    // cliente, horas depois e sem rastro.
    provided = { ...provided, emvPayload: `${provided.emvPayload.slice(0, -4)}0000` };

    await expect(service.create(actor(), account.id, dto())).rejects.toMatchObject({
      code: BaasErrorCode.PROVIDER_REJECTED,
    });
    expect(charges.rows.size).toBe(0);
  });

  it('recusa BR Code que aponta para outra chave', async () => {
    // O caso perigoso: o QR e VALIDO, entao nenhum parser reclama — o dinheiro
    // simplesmente vai para outra conta.
    provided = { ...provided, emvPayload: brCode('outro@exemplo.test', '150.00') };

    await expect(service.create(actor(), account.id, dto())).rejects.toMatchObject({
      code: BaasErrorCode.PROVIDER_REJECTED,
    });
    expect(charges.rows.size).toBe(0);
  });

  it('recusa cobranca sem payload', async () => {
    provided = { ...provided, emvPayload: '' };
    await expect(service.create(actor(), account.id, dto())).rejects.toMatchObject({
      code: BaasErrorCode.PROVIDER_REJECTED,
    });
  });

  it('recusa chave de outra conta', async () => {
    const outra: AccountRecord = { ...account, id: newId('account') };
    await expect(
      service.create(actor(), outra.id, dto()),
    ).rejects.toMatchObject({ code: BaasErrorCode.ACCOUNT_NOT_FOUND });
  });

  it('cobranca paga nao volta para ACTIVE', async () => {
    const charge = await service.create(actor(), account.id, dto());

    await charges.applyStatusChange({
      environment: ENV,
      txid: charge.txid,
      toStatus: PixChargeStatus.COMPLETED,
      paidAmountCents: 15_000n,
      occurredAt: new Date('2026-08-29T13:00:00.000Z'),
    });

    // COMPLETED e terminal na tabela de transicao: uma reentrega de
    // `pix_charge.paid` seguida de um evento antigo nao pode reabrir a
    // cobranca e fazer o lojista cobrar de novo.
    const back = await charges.applyStatusChange({
      environment: ENV,
      txid: charge.txid,
      toStatus: PixChargeStatus.ACTIVE,
      occurredAt: new Date('2026-08-29T14:00:00.000Z'),
    });
    expect(back.applied).toBe(false);
    expect(back.reason).toBe('illegal_transition');
  });

  it('evento com carimbo antigo nao sobrescreve o recente', async () => {
    const charge = await service.create(actor(), account.id, dto());
    await charges.applyStatusChange({
      environment: ENV,
      txid: charge.txid,
      toStatus: PixChargeStatus.COMPLETED,
      occurredAt: new Date('2026-08-29T13:00:00.000Z'),
    });

    const stale = await charges.applyStatusChange({
      environment: ENV,
      txid: charge.txid,
      toStatus: PixChargeStatus.EXPIRED,
      occurredAt: new Date('2026-08-29T12:30:00.000Z'),
    });
    expect(stale.applied).toBe(false);
    expect(stale.reason).toBe('stale_timestamp');
  });

  it('o DTO expoe centavos como string, nunca como numero', async () => {
    const charge = await service.create(actor(), account.id, dto());
    const view = toPixChargeDto(charge);
    // `bigint` nao sobrevive a JSON.stringify e `number` perde precisao acima
    // de 2^53. String e a unica forma que atravessa o wire intacta.
    expect(view.amount).toEqual({ amount: '15000', currency: 'BRL', scale: 2 });
    expect(typeof view.amount?.amount).toBe('string');
  });
});
