import {
  defineManifest,
  type ProviderAdapter,
  type ProviderAdapterFactory,
} from '@baasconn/provider-spi';
import { BaasError, BaasErrorCode, SupportLevel } from '@baasconn/taxonomy';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  assertNoFailures,
  checkCanonicalEnum,
  checkEndToEndId,
  checkEnvironmentsDiffer,
  checkErrorMapped,
  checkEventIdentityStable,
  checkManifestMatchesFacets,
  checkMoneyPrecision,
  checkNoLeaks,
  checkPartialHasNote,
  checkUsedInjectedBaseUrl,
} from './checks.js';
import { LEAK_CANARIES } from './harness.js';

/**
 * Testa a propria suite de conformidade.
 *
 * Uma suite que nunca foi vista falhando nao garante nada. Cada bloco aqui
 * constroi deliberadamente o modo de falha que a assercao correspondente
 * existe para pegar, e verifica que a mensagem diz ao autor do adapter o que
 * consertar.
 */

const brl = (amount: string) => ({ amount, currency: 'BRL' as const, scale: 2 });

const factoryWith = (
  manifest: ReturnType<typeof defineManifest>,
  endpoints = { HOMOLOGACAO: 'https://sandbox.exemplo.com', PRODUCAO: 'https://api.exemplo.com' },
): ProviderAdapterFactory =>
  ({
    slug: 'STUB',
    displayName: 'Stub',
    manifest,
    credentialsSchema: z.object({}),
    endpoints,
    idempotency: {},
    create: () => adapterWith(),
  }) as unknown as ProviderAdapterFactory;

const adapterWith = (overrides: Partial<ProviderAdapter> = {}): ProviderAdapter =>
  ({
    slug: 'STUB',
    displayName: 'Stub',
    health: async () => ({ healthy: true, checkedAt: '' }),
    ...overrides,
  }) as ProviderAdapter;

describe('1. manifesto versus facetas', () => {
  it('passa quando a faceta existe', () => {
    const factory = factoryWith(defineManifest({ 'balance.get': SupportLevel.SUPPORTED }));
    const adapter = adapterWith({
      balance: { get: async () => ({ available: brl('0'), asOf: '' }) },
    });
    expect(checkManifestMatchesFacets(factory, adapter)).toEqual([]);
  });

  it('PEGA capacidade declarada sem a faceta correspondente', () => {
    const factory = factoryWith(defineManifest({ 'pix.out.send': SupportLevel.SUPPORTED }));
    const failures = checkManifestMatchesFacets(factory, adapterWith());
    expect(failures).toHaveLength(1);
    expect(failures[0]?.message).toMatch(
      /declara 'pix.out.send' mas nao expoe a faceta 'pixTransfers'/,
    );
  });
});

describe('1b. PARTIAL sem explicacao', () => {
  it('passa quando ha nota', () => {
    const manifest = defineManifest({
      'pix.out.send': { level: SupportLevel.PARTIAL, note: 'Exige saldo pre-alocado.' },
    });
    expect(checkPartialHasNote(manifest)).toEqual([]);
  });

  it('PEGA PARTIAL sem nota', () => {
    const manifest = defineManifest({ 'pix.out.send': SupportLevel.PARTIAL });
    const failures = checkPartialHasNote(manifest);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.message).toMatch(/nao explica a restricao/);
  });

  it('PEGA EMULATED sem nota', () => {
    const manifest = defineManifest({ 'webhooks.inbound': SupportLevel.EMULATED });
    expect(checkPartialHasNote(manifest)).toHaveLength(1);
  });
});

describe('1c. ambientes', () => {
  it('passa quando homologacao e producao diferem', () => {
    expect(checkEnvironmentsDiffer(factoryWith(defineManifest({})))).toEqual([]);
  });

  it('PEGA homologacao apontando para producao', () => {
    // O modo de falha: uma transferencia PIX real disparada achando que era teste.
    const factory = factoryWith(defineManifest({}), {
      HOMOLOGACAO: 'https://api.exemplo.com',
      PRODUCAO: 'https://api.exemplo.com',
    });
    const failures = checkEnvironmentsDiffer(factory);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.message).toMatch(/mesma URL/);
  });

  it('permite localhost igual nos dois, que e o caso do Mock Bank', () => {
    const factory = factoryWith(defineManifest({}), {
      HOMOLOGACAO: 'http://localhost:3002',
      PRODUCAO: 'http://localhost:3002',
    });
    expect(checkEnvironmentsDiffer(factory)).toEqual([]);
  });

  it('PEGA endpoint que nao e URL', () => {
    const factory = factoryWith(defineManifest({}), {
      HOMOLOGACAO: 'sandbox',
      PRODUCAO: 'https://api.exemplo.com',
    });
    expect(checkEnvironmentsDiffer(factory)[0]?.message).toMatch(/nao e uma URL/);
  });
});

describe('4. valor canonico de enum', () => {
  it('passa com valor conhecido', () => {
    expect(checkCanonicalEnum('ACTIVE', ['ACTIVE', 'CLOSED'], 'account.status')).toEqual([]);
  });

  it('PEGA status cru do provedor vazando sem mapeamento', () => {
    const failures = checkCanonicalEnum('ATIVA', ['ACTIVE', 'CLOSED'], 'account.status');
    expect(failures[0]?.message).toMatch(/'ATIVA' nao e um valor canonico/);
  });

  it('ignora valor ausente, que e legitimo em campo opcional', () => {
    expect(checkCanonicalEnum(undefined, ['ACTIVE'], 'x')).toEqual([]);
  });
});

describe('5. precisao monetaria', () => {
  it('passa com unidades menores inteiras', () => {
    expect(checkMoneyPrecision(brl('15075'), 'balance')).toEqual([]);
  });

  it('PEGA decimal disfarcado de valor', () => {
    const failures = checkMoneyPrecision(brl('150.75'), 'balance');
    expect(failures[0]?.message).toMatch(/nao e inteiro em unidades menores/);
  });

  it('PEGA float que escapou de Number(valor) * 100', () => {
    // O bug real: 150.75 * 100 em ponto flutuante da 15074.999999999998.
    const failures = checkMoneyPrecision(brl('15074.999999999998'), 'balance');
    expect(failures).toHaveLength(1);
  });

  it('PEGA notacao cientifica', () => {
    expect(checkMoneyPrecision(brl('1.5e4'), 'balance')).toHaveLength(1);
  });

  it('ignora valor ausente', () => {
    expect(checkMoneyPrecision(undefined, 'balance.blocked')).toEqual([]);
  });
});

describe('6. EndToEndId', () => {
  it('passa com o formato do BACEN', () => {
    expect(checkEndToEndId('E99999001202608281403ABCDE123456', 'tx')).toEqual([]);
  });

  it('aceita ausente: so existe a partir de PROCESSING', () => {
    expect(checkEndToEndId(undefined, 'tx')).toEqual([]);
  });

  it('PEGA id proprio do provedor no lugar do E2EID', () => {
    const failures = checkEndToEndId('txn_abc123', 'tx');
    expect(failures[0]?.message).toMatch(/nao segue E \+ ISPB/);
  });
});

describe('7. mapeamento de erro', () => {
  it('passa com codigo canonico especifico', () => {
    const error = new BaasError(BaasErrorCode.INSUFFICIENT_FUNDS);
    expect(checkErrorMapped(error, 'pix-out/sem-saldo')).toEqual([]);
  });

  it('PEGA fallback e diz qual codigo adicionar na tabela', () => {
    const error = new BaasError(BaasErrorCode.PROVIDER_REJECTED, {
      provider: { slug: 'CELCOIN', code: 'CBE099' },
    });
    const failures = checkErrorMapped(error, 'pix-out/novo-erro');
    expect(failures[0]?.message).toMatch(/Adicione o codigo 'CBE099' na tabela de mapeamento/);
  });

  it('PEGA excecao que nao e BaasError vazando do adapter', () => {
    const failures = checkErrorMapped(new TypeError('undefined nao tem .map'), 'balance/erro');
    expect(failures[0]?.message).toMatch(/lancou TypeError em vez de BaasError/);
  });
});

describe('8. identidade de evento', () => {
  it('passa quando a identidade e estavel', () => {
    expect(checkEventIdentityStable('evt_1', 'evt_1')).toEqual([]);
  });

  it('PEGA identidade derivada do instante de recebimento', () => {
    // O bug: identidade gerada de Date.now() faz cada reentrega virar evento
    // novo, e o cliente ve o mesmo PIX duas vezes.
    const failures = checkEventIdentityStable('evt_1756400000', 'evt_1756400001');
    expect(failures[0]?.message).toMatch(/evento duplicado para o cliente/);
  });
});

describe('9. vazamento de dado sensivel', () => {
  it('passa quando o log esta redigido', () => {
    const log = JSON.stringify([{ payload: { cpf: '***.***.247-25' } }]);
    expect(checkNoLeaks(log, LEAK_CANARIES)).toEqual([]);
  });

  it('PEGA CPF cru no log', () => {
    const log = JSON.stringify([{ payload: { holder: { cpf: '52998224725' } } }]);
    const failures = checkNoLeaks(log, LEAK_CANARIES);
    expect(failures[0]?.message).toMatch(/52998224725/);
  });

  it('PEGA client secret no registro de chamada', () => {
    const calls = JSON.stringify([
      { requestBody: { client_secret: 'super-secret-client-secret' } },
    ]);
    expect(checkNoLeaks(calls, LEAK_CANARIES)).toHaveLength(1);
  });
});

describe('10. baseUrl injetada', () => {
  it('passa quando as chamadas chegaram ao cassette server', () => {
    expect(checkUsedInjectedBaseUrl(3)).toEqual([]);
  });

  it('PEGA adapter com URL fixa no codigo', () => {
    const failures = checkUsedInjectedBaseUrl(0);
    expect(failures[0]?.message).toMatch(/ignora ctx.baseUrl/);
  });
});

describe('assertNoFailures', () => {
  it('nao lanca quando nao ha falha', () => {
    expect(() => assertNoFailures([])).not.toThrow();
  });

  it('agrega todas as falhas numa mensagem legivel', () => {
    expect(() =>
      assertNoFailures([
        { check: 'a', message: 'primeira' },
        { check: 'b', message: 'segunda' },
      ]),
    ).toThrow(/\[a\] primeira[\s\S]*\[b\] segunda/);
  });
});
