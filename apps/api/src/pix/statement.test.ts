import {
  AccountKind,
  AccountStatus,
  BaasErrorCode,
  Environment,
  FixedClock,
  PixInitiationMethod,
  PixPurpose,
  TransactionDirection,
  TransactionStatus,
  TransactionType,
  newId,
} from '@baasconn/taxonomy';
import { beforeEach, describe, expect, it } from 'vitest';

import type { AccountRecord } from '../accounts/accounts.types.js';
import { ApiConfig } from '../config/config.service.js';
import { MemoryAccountRepository } from '../persistence/memory/domain.repositories.js';
import { MemoryTransactionRepository } from '../persistence/memory/pix.repositories.js';

import { decodeCursor, encodeCursor } from './cursor.js';
import { StatementService, filterDigest } from './statement.service.js';

const ENV = Environment.HOMOLOGACAO;
const SECRET = 'segredo-de-cursor-para-teste';

describe('cursor de keyset assinado', () => {
  const cursor = { date: '2026-08-29', id: 'txn_1', filters: 'abc' };

  it('ida e volta preserva a posicao', () => {
    const encoded = encodeCursor(cursor, SECRET);
    expect(decodeCursor(encoded, SECRET, 'abc')).toEqual({ ok: true, cursor });
  });

  it('adulterar a carga invalida a assinatura', () => {
    // A assinatura nao esconde nada — o conteudo e base64. Ela impede que um
    // cliente pule para um id arbitrario ou forje o digest do filtro.
    const encoded = encodeCursor(cursor, SECRET);
    const signature = encoded.split('.')[1];
    const forged = Buffer.from(
      JSON.stringify({ ...cursor, id: 'txn_9' }),
      'utf8',
    ).toString('base64url');

    expect(decodeCursor(`${forged}.${signature}`, SECRET, 'abc')).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('cursor de outro deploy nao e aceito', () => {
    const encoded = encodeCursor(cursor, SECRET);
    expect(decodeCursor(encoded, 'outro-segredo', 'abc')).toMatchObject({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('trocar o filtro no meio da paginacao e detectado', () => {
    // Sem isto, o resultado nao e nem uma consulta nem a outra — e num extrato
    // financeiro isso e um erro silencioso de conteudo.
    const encoded = encodeCursor(cursor, SECRET);
    expect(decodeCursor(encoded, SECRET, 'digest-diferente')).toMatchObject({
      ok: false,
      reason: 'filters_changed',
    });
  });

  it('cursor sem separador e malformado, nao excecao', () => {
    expect(decodeCursor('lixo', SECRET, 'abc')).toMatchObject({ ok: false, reason: 'malformed' });
  });

  it('o digest ignora o limite da pagina', () => {
    // Mudar o tamanho da pagina no meio da paginacao e legitimo: nao altera o
    // conjunto de resultados. Mudar a janela de datas altera.
    const a = filterDigest({ accountId: 'acc_1', from: '2026-08-01', to: '2026-08-31' });
    const b = filterDigest({ accountId: 'acc_1', from: '2026-08-01', to: '2026-08-31' });
    const c = filterDigest({ accountId: 'acc_1', from: '2026-08-02', to: '2026-08-31' });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('extrato', () => {
  let transactions: MemoryTransactionRepository;
  let service: StatementService;
  let account: AccountRecord;

  const line = (
    index: number,
    date: string,
    status = TransactionStatus.SETTLED,
  ) => ({
    id: `txn_${String(index).padStart(3, '0')}`,
    environment: ENV,
    accountId: account.id,
    type: TransactionType.PIX_IN,
    direction: TransactionDirection.CREDIT,
    status,
    amountCents: 1_000n * BigInt(index),
    feeCents: 0n,
    netAmountCents: 1_000n * BigInt(index),
    refundedAmountCents: 0n,
    currency: 'BRL',
    provider: 'mock-bank',
    providerConnectionId: 'con_1',
    effectiveDate: date,
    requestedAt: new Date(`${date}T12:00:00.000Z`),
    settledAt: new Date(`${date}T12:00:00.000Z`),
    pix: { initiationMethod: PixInitiationMethod.KEY, purpose: PixPurpose.TRANSFER },
    metadata: {},
    createdAt: new Date(`${date}T12:00:00.000Z`),
    updatedAt: new Date(`${date}T12:00:00.000Z`),
  });

  beforeEach(async () => {
    const clock = new FixedClock(new Date('2026-08-29T12:00:00.000Z'));
    const accounts = new MemoryAccountRepository();
    transactions = new MemoryTransactionRepository();

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
    service = new StatementService(new ApiConfig(), accounts, transactions);
  });

  const request = (limit: number, cursor?: string) => ({
    environment: ENV,
    accountId: account.id,
    from: '2026-08-01',
    to: '2026-08-31',
    limit,
    cursor,
  });

  it('pagina sem duplicata nem buraco quando chega linha nova no meio', async () => {
    for (let i = 1; i <= 6; i += 1) {
      await transactions.create(line(i, `2026-08-${String(i).padStart(2, '0')}`));
    }

    const first = await service.list(request(3));
    expect(first.data).toHaveLength(3);

    // Chega uma linha NOVA, mais recente, entre as duas paginas. Com offset,
    // ela empurraria tudo e a segunda pagina repetiria um item.
    await transactions.create(line(99, '2026-08-30'));

    const second = await service.list(request(3, first.nextCursor));
    const ids = [...first.data, ...second.data].map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain('txn_099');
  });

  it('ordena por data desc e id desc', async () => {
    await transactions.create(line(1, '2026-08-10'));
    await transactions.create(line(2, '2026-08-10'));
    await transactions.create(line(3, '2026-08-11'));

    const page = await service.list(request(10));
    expect(page.data.map((row) => row.id)).toEqual(['txn_003', 'txn_002', 'txn_001']);
  });

  it('so entra o que ja aconteceu', async () => {
    await transactions.create(line(1, '2026-08-10'));
    await transactions.create(line(2, '2026-08-10', TransactionStatus.PENDING));
    await transactions.create(line(3, '2026-08-10', TransactionStatus.UNKNOWN));

    // Uma transferencia em voo num extrato faria o cliente conciliar contra um
    // movimento que ainda pode ser desfeito.
    const page = await service.list(request(10));
    expect(page.data.map((row) => row.id)).toEqual(['txn_001']);
  });

  it('respeita a janela de datas', async () => {
    await transactions.create(line(1, '2026-07-31'));
    await transactions.create(line(2, '2026-08-15'));
    await transactions.create(line(3, '2026-09-01'));

    const page = await service.list(request(10));
    expect(page.data.map((row) => row.id)).toEqual(['txn_002']);
  });

  it('nao devolve cursor na ultima pagina', async () => {
    await transactions.create(line(1, '2026-08-10'));
    const page = await service.list(request(10));
    expect(page.nextCursor).toBeUndefined();
  });

  it('cursor adulterado vira 400, nao pagina errada', async () => {
    for (let i = 1; i <= 4; i += 1) await transactions.create(line(i, '2026-08-10'));
    const first = await service.list(request(2));

    const tampered = `${first.nextCursor!.split('.')[0]}.assinaturafalsa`;
    await expect(service.list(request(2, tampered))).rejects.toMatchObject({
      code: BaasErrorCode.INVALID_CURSOR,
    });
  });

  it('cursor de outra janela e recusado', async () => {
    for (let i = 1; i <= 4; i += 1) await transactions.create(line(i, '2026-08-10'));
    const first = await service.list(request(2));

    await expect(
      service.list({ ...request(2, first.nextCursor), from: '2026-08-05' }),
    ).rejects.toMatchObject({ code: BaasErrorCode.INVALID_CURSOR });
  });
});
