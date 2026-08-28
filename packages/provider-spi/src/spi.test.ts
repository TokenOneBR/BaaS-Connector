import { CAPABILITY_KEYS, SupportLevel } from '@baasconn/taxonomy';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { defineManifest, isSupported, supportedKeys } from './capabilities/manifest.js';
import type { ProviderAdapter } from './facets/index.js';
import {
  assertManifestValid,
  FACET_FOR_CAPABILITY,
  validateManifest,
  type ProviderAdapterFactory,
} from './factory.js';
import { resolveProviderKey } from './idempotency.js';

const stubAdapter = (overrides: Partial<ProviderAdapter> = {}): ProviderAdapter => ({
  slug: 'stub',
  displayName: 'Stub',
  health: async () => ({ healthy: true, checkedAt: new Date().toISOString() }),
  ...overrides,
});

const stubFactory = (
  manifest: ReturnType<typeof defineManifest>,
  idempotency: ProviderAdapterFactory['idempotency'] = {},
): ProviderAdapterFactory => ({
  slug: 'stub',
  displayName: 'Stub',
  manifest,
  credentialsSchema: z.object({}) as never,
  endpoints: { HOMOLOGACAO: 'https://h.example', PRODUCAO: 'https://p.example' },
  idempotency,
  create: () => stubAdapter(),
});

describe('defineManifest', () => {
  it('preenche como UNSUPPORTED tudo que nao foi declarado', () => {
    const manifest = defineManifest({ 'balance.get': SupportLevel.SUPPORTED });
    expect(manifest['balance.get'].level).toBe(SupportLevel.SUPPORTED);
    expect(manifest['pix.out.send'].level).toBe(SupportLevel.UNSUPPORTED);
  });

  it('cobre toda chave de capacidade, sem deixar undefined', () => {
    const manifest = defineManifest({});
    for (const key of CAPABILITY_KEYS) {
      expect(manifest[key], key).toBeDefined();
    }
  });

  it('aceita nivel abreviado ou entrada completa com nota', () => {
    const manifest = defineManifest({
      'balance.get': SupportLevel.SUPPORTED,
      'pix.out.send': { level: SupportLevel.PARTIAL, note: 'Exige saldo pre-alocado.' },
    });
    expect(manifest['pix.out.send'].note).toBe('Exige saldo pre-alocado.');
  });

  it('e imutavel: ninguem altera capacidade em runtime', () => {
    const manifest = defineManifest({});
    expect(Object.isFrozen(manifest)).toBe(true);
  });

  it('supportedKeys ignora o que e UNSUPPORTED', () => {
    const manifest = defineManifest({
      'balance.get': SupportLevel.SUPPORTED,
      'statement.list': SupportLevel.PARTIAL,
      'pix.in.receive': SupportLevel.EMULATED,
    });
    expect(supportedKeys(manifest).sort()).toEqual(
      ['balance.get', 'pix.in.receive', 'statement.list'].sort(),
    );
    expect(isSupported(manifest, 'pix.out.send')).toBe(false);
  });
});

describe('FACET_FOR_CAPABILITY', () => {
  it('mapeia toda chave de capacidade para uma faceta', () => {
    for (const key of CAPABILITY_KEYS) {
      expect(FACET_FOR_CAPABILITY[key], `capacidade ${key} sem faceta`).toBeDefined();
    }
  });
});

describe('validateManifest', () => {
  it('aceita manifesto vazio com adapter sem facetas', () => {
    const factory = stubFactory(defineManifest({}));
    expect(validateManifest(factory, stubAdapter())).toEqual([]);
  });

  it('detecta capacidade declarada sem a faceta correspondente', () => {
    // O modo de falha que isto existe para matar: um manifesto que promete
    // PIX out e so descobre no primeiro pagamento de producao que a faceta
    // nunca foi implementada.
    const factory = stubFactory(defineManifest({ 'pix.out.send': SupportLevel.SUPPORTED }));
    const issues = validateManifest(factory, stubAdapter());
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ capability: 'pix.out.send', problem: 'facet_missing' });
  });

  it('assertManifestValid lanca com mensagem legivel', () => {
    const factory = stubFactory(defineManifest({ 'balance.get': SupportLevel.SUPPORTED }));
    expect(() => assertManifestValid(factory, stubAdapter())).toThrow(
      /declara 'balance.get' mas nao expoe a faceta 'balance'/,
    );
  });

  it('aceita quando a faceta existe', () => {
    const factory = stubFactory(defineManifest({ 'balance.get': SupportLevel.SUPPORTED }));
    const adapter = stubAdapter({
      balance: {
        get: async () => ({ available: { amount: '0', currency: 'BRL', scale: 2 }, asOf: '' }),
      },
    });
    expect(validateManifest(factory, adapter)).toEqual([]);
  });

  it('exige findByIdempotencyKey quando o provedor nao tem idempotencia', () => {
    const factory = stubFactory(defineManifest({ 'pix.out.send': SupportLevel.SUPPORTED }), {
      'pix.out': { mode: 'none' },
    });
    const adapter = stubAdapter({
      pixTransfers: { send: async () => ({}) as never, get: async () => ({}) as never },
    });
    const issues = validateManifest(factory, adapter);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.problem).toBe('idempotency_missing');
    expect(issues[0]?.message).toMatch(/reenviando o pagamento/);
  });

  it('aceita idempotencia none quando ha busca pela nossa chave', () => {
    const factory = stubFactory(defineManifest({ 'pix.out.send': SupportLevel.SUPPORTED }), {
      'pix.out': { mode: 'none' },
    });
    const adapter = stubAdapter({
      pixTransfers: {
        send: async () => ({}) as never,
        get: async () => ({}) as never,
        findByIdempotencyKey: async () => null,
      },
    });
    expect(validateManifest(factory, adapter)).toEqual([]);
  });
});

describe('idempotencia do provedor', () => {
  it('deriva a chave do nosso operationId, nao da chave do cliente', () => {
    expect(resolveProviderKey({ mode: 'header', header: 'Idempotency-Key' }, 'opr_01')).toBe(
      'opr_01',
    );
  });

  it('aplica o formatador quando o provedor exige forma propria', () => {
    const key = resolveProviderKey(
      { mode: 'body_field', path: 'clientRequestId', format: (id) => `baas-${id}` },
      'opr_01',
    );
    expect(key).toBe('baas-opr_01');
  });

  it('nao produz chave quando o dedupe e por E2EID ou externalId', () => {
    expect(resolveProviderKey({ mode: 'end_to_end_id' }, 'opr_01')).toBeUndefined();
    expect(resolveProviderKey({ mode: 'external_id' }, 'opr_01')).toBeUndefined();
    expect(resolveProviderKey({ mode: 'none' }, 'opr_01')).toBeUndefined();
  });
});
