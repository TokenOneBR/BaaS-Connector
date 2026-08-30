import { BlindIndex } from '@baasconn/crypto';
import type { PixKey } from '@baasconn/provider-spi';
import {
  AccountKind,
  AccountStatus,
  BaasError,
  BaasErrorCode,
  Environment,
  FixedClock,
  PixKeyStatus,
  PixKeyType,
  newId,
} from '@baasconn/taxonomy';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AccountRecord } from '../accounts/accounts.types.js';
import { MemoryAccountRepository } from '../persistence/memory/domain.repositories.js';
import {
  MemoryAuditRepository,
  MemoryOutboxRepository,
} from '../persistence/memory/domain.repositories.js';
import { MemoryPixKeyRepository } from '../persistence/memory/pix.repositories.js';

import { PixKeysService, toKeyStatus } from './pix-keys.service.js';

const ENV = Environment.HOMOLOGACAO;
const PEPPER = 'pepper-de-teste-com-mais-de-trinta-e-dois-caracteres';

/**
 * Chave de teste em e-mail, e nao CPF: um CPF de digito valido num arquivo de
 * teste e exatamente o que o gate de PII do CI procura, e um invalido seria
 * recusado pela propria validacao. E-mail nao tem esse dilema.
 */
const EMAIL = 'titular@exemplo.test';

describe('chaves Pix', () => {
  let keys: MemoryPixKeyRepository;
  let accounts: MemoryAccountRepository;
  let service: PixKeysService;
  let created: PixKey;
  let account: AccountRecord;

  beforeEach(async () => {
    const clock = new FixedClock(new Date('2026-08-29T12:00:00.000Z'));
    keys = new MemoryPixKeyRepository();
    accounts = new MemoryAccountRepository();

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

    created = {
      type: PixKeyType.EVP,
      value: '9f2c4a1b-3d5e-4f60-8a91-2b3c4d5e6f70',
      status: 'ACTIVE',
      providerKeyId: 'mb-key-1',
    };

    const providers = {
      require: vi.fn(async () => ({
        slug: 'mock-bank',
        adapter: {
          pixKeys: {
            create: vi.fn(async () => created),
            delete: vi.fn(async () => undefined),
            list: vi.fn(async () => []),
          },
        },
      })),
    };

    service = new PixKeysService(
      providers as never,
      new BlindIndex(PEPPER),
      accounts,
      keys,
      new MemoryOutboxRepository(),
      new MemoryAuditRepository(),
      clock,
    );
  });

  const actor = () => ({
    environment: ENV,
    connectionId: 'con_1',
    apiKeyId: 'key_1',
    scopes: ['pix:keys:write'] as const,
  });

  it('normaliza o valor antes de gravar', async () => {
    // "Joao@X.com" e "joao@x.com" sao a MESMA chave no DICT. Guardar as duas
    // formas produz duas linhas que o indice unico parcial nao reconcilia.
    created = { type: PixKeyType.EMAIL, value: 'Joao@Exemplo.COM ', status: 'ACTIVE' };
    const key = await service.create(actor(), account.id, {
      type: PixKeyType.EMAIL,
      value: ' Joao@Exemplo.COM ',
    });
    expect(key.value).toBe('joao@exemplo.com');
  });

  it('indexa por blind index, nunca pelo valor em claro', async () => {
    created = { type: PixKeyType.EMAIL, value: EMAIL, status: 'ACTIVE' };
    const key = await service.create(actor(), account.id, {
      type: PixKeyType.EMAIL,
      value: EMAIL,
    });

    expect(key.valueBlindIndex).toHaveLength(64);
    expect(key.valueBlindIndex).not.toContain(EMAIL);
    // E o indice PRECISA achar a chave: um blind index que nao busca nao serve
    // para nada.
    await expect(keys.findActiveByBlindIndex(ENV, key.valueBlindIndex)).resolves.toMatchObject({
      id: key.id,
    });
  });

  it('registrar a mesma chave na mesma conta e no-op, nao erro', async () => {
    created = { type: PixKeyType.EMAIL, value: EMAIL, status: 'ACTIVE' };
    const first = await service.create(actor(), account.id, {
      type: PixKeyType.EMAIL,
      value: EMAIL,
    });
    const second = await service.create(actor(), account.id, {
      type: PixKeyType.EMAIL,
      value: EMAIL,
    });
    expect(second.id).toBe(first.id);
    expect(keys.rows.size).toBe(1);
  });

  it('recusa chave ja ativa em outra conta do mesmo ambiente', async () => {
    created = { type: PixKeyType.EMAIL, value: EMAIL, status: 'ACTIVE' };
    await service.create(actor(), account.id, { type: PixKeyType.EMAIL, value: EMAIL });

    const outra: AccountRecord = { ...account, id: newId('account') };
    await accounts.create(outra);

    await expect(
      service.create(actor(), outra.id, { type: PixKeyType.EMAIL, value: EMAIL }),
    ).rejects.toMatchObject({ code: BaasErrorCode.PIX_KEY_ALREADY_EXISTS });
  });

  it('recusa chave invalida antes de chamar o provedor', async () => {
    // Validar aqui evita uma ida ao provedor que ja se sabe que vai falhar —
    // e o erro que volta e o nosso, com mensagem util, nao o dele.
    await expect(
      service.create(actor(), account.id, { type: PixKeyType.EMAIL, value: 'nao-e-email' }),
    ).rejects.toBeInstanceOf(BaasError);
  });

  it('remover marca REMOVED em vez de apagar a linha', async () => {
    const key = await service.create(actor(), account.id, { type: PixKeyType.EVP });
    await service.remove(actor(), account.id, key.id);

    const after = await keys.findById(ENV, key.id);
    // Apagar destruiria a trilha: "esta conta ja teve esta chave" e uma
    // pergunta que o suporte faz.
    expect(after?.status).toBe(PixKeyStatus.REMOVED);
    expect(after?.removedAt).toBeInstanceOf(Date);
  });

  it('remover chave de outra conta e 404, nao sucesso silencioso', async () => {
    const key = await service.create(actor(), account.id, { type: PixKeyType.EVP });
    const outra: AccountRecord = { ...account, id: newId('account') };
    await accounts.create(outra);

    await expect(service.remove(actor(), outra.id, key.id)).rejects.toMatchObject({
      code: BaasErrorCode.PIX_KEY_NOT_FOUND,
    });
  });
});

describe('mapeamento de status de chave', () => {
  it('status desconhecido nunca vira ACTIVE', () => {
    // Tratar como ativa uma chave cujo estado nao entendemos faz o cliente
    // cobrar num QR que o DICT ainda nao reconhece.
    expect(toKeyStatus('QUALQUER_COISA')).toBe(PixKeyStatus.PENDING_REGISTRATION);
    expect(toKeyStatus('ACTIVE')).toBe(PixKeyStatus.ACTIVE);
    expect(toKeyStatus('removed')).toBe(PixKeyStatus.REMOVED);
  });
});
