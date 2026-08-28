import { describe, expect, it } from 'vitest';

import { BlindIndex } from './blind-index.js';
import { EnvelopeCrypto, safeEqual } from './envelope.js';
import { LocalKmsDriver, createKmsDriver } from './kms.js';
import {
  constantTimeEqual,
  generateApiKey,
  hashSecret,
  parseApiKey,
  secretLookup,
  verifySecret,
} from './secrets.js';

const MASTER = 'chave-mestra-local-de-teste-com-tamanho';
const PEPPER = 'pepper-de-teste-com-mais-de-trinta-e-dois-caracteres';

const kms = () => new LocalKmsDriver(MASTER);
const crypto = () => new EnvelopeCrypto({ kms: kms() });

describe('driver KMS local', () => {
  it('envolve e desenvolve uma chave de dados', async () => {
    const driver = kms();
    const dataKey = Buffer.from('0'.repeat(32));
    const { wrapped, keyId } = await driver.wrap(dataKey);

    expect(wrapped.equals(dataKey)).toBe(false);
    expect(await driver.unwrap(wrapped, keyId)).toEqual(dataKey);
  });

  it('marca o keyId como local, para auditoria identificar', async () => {
    const { keyId } = await kms().wrap(Buffer.alloc(32));
    expect(keyId).toMatch(/^local:/);
  });

  it('recusa desenvolver blob de outro driver', async () => {
    await expect(kms().unwrap(Buffer.alloc(64), 'aws:arn:...')).rejects.toThrow(
      /nao foi envolvida pelo driver local/,
    );
  });

  it('recusa chave mestra curta', () => {
    expect(() => new LocalKmsDriver('curta')).toThrow(/16 caracteres/);
  });

  it('nao desenvolve com chave mestra diferente', async () => {
    const { wrapped, keyId } = await kms().wrap(Buffer.alloc(32, 7));
    const outro = new LocalKmsDriver('outra-chave-mestra-completamente-diferente');
    await expect(outro.unwrap(wrapped, keyId)).rejects.toThrow();
  });

  it('createKmsDriver exige master secret no modo local', async () => {
    await expect(createKmsDriver({ driver: 'local' })).rejects.toThrow(/KMS_MASTER_SECRET/);
  });

  it('createKmsDriver diz o que falta para os drivers de nuvem', async () => {
    await expect(createKmsDriver({ driver: 'aws-kms' })).rejects.toThrow(/ainda nao implementado/);
  });
});

describe('envelope encryption', () => {
  it('faz round-trip de string', async () => {
    const c = crypto();
    const envelope = await c.encrypt('client_secret_super_sensivel');
    expect(await c.decryptToString(envelope)).toBe('client_secret_super_sensivel');
  });

  it('faz round-trip de JSON', async () => {
    const c = crypto();
    const credentials = { clientId: 'abc', clientSecret: 'xyz', certPem: '-----BEGIN...' };
    const envelope = await c.encryptJson(credentials);
    expect(await c.decryptJson(envelope)).toEqual(credentials);
  });

  it('o ciphertext nao contem o plaintext', async () => {
    const envelope = await crypto().encrypt('valor-secreto-identificavel');
    expect(envelope.ciphertext.toString('utf8')).not.toContain('valor-secreto');
    expect(envelope.ciphertext.toString('hex')).not.toContain(
      Buffer.from('valor-secreto').toString('hex'),
    );
  });

  it('gera DEK diferente a cada cifragem, entao o mesmo valor da ciphertext diferente', async () => {
    const c = crypto();
    const first = await c.encrypt('mesmo-valor');
    const second = await c.encrypt('mesmo-valor');
    expect(first.ciphertext.equals(second.ciphertext)).toBe(false);
    expect(first.wrappedKey.equals(second.wrappedKey)).toBe(false);
  });

  it('detecta ciphertext adulterado pelo authTag do GCM', async () => {
    const c = crypto();
    const envelope = await c.encrypt('valor');
    envelope.ciphertext[0] = (envelope.ciphertext[0]! + 1) % 256;
    await expect(c.decrypt(envelope)).rejects.toThrow();
  });

  it('detecta authTag adulterado', async () => {
    const c = crypto();
    const envelope = await c.encrypt('valor');
    envelope.authTag[0] = (envelope.authTag[0]! + 1) % 256;
    await expect(c.decrypt(envelope)).rejects.toThrow();
  });

  it('cacheia a DEK por versao, entao rotacionar invalida por construcao', async () => {
    let unwraps = 0;
    const driver = kms();
    const counting = {
      name: driver.name,
      wrap: (key: Buffer) => driver.wrap(key),
      unwrap: (wrapped: Buffer, keyId: string) => {
        unwraps += 1;
        return driver.unwrap(wrapped, keyId);
      },
    };
    const c = new EnvelopeCrypto({ kms: counting });

    const v1 = await c.encrypt('segredo', 1);
    await c.decrypt(v1, 'con_1');
    await c.decrypt(v1, 'con_1');
    expect(unwraps).toBe(1);

    const v2 = await c.encrypt('segredo-rotacionado', 2);
    await c.decrypt(v2, 'con_1');
    // Versao nova, chave de cache nova: nao reusa a DEK antiga.
    expect(unwraps).toBe(2);
  });

  it('fingerprint prova que ha segredo gravado sem revelar nada', () => {
    const fingerprint = EnvelopeCrypto.fingerprint('client_secret_real');
    expect(fingerprint).toMatch(/^sha256:[0-9a-f]{16}$/);
    expect(fingerprint).not.toContain('client_secret');
    expect(EnvelopeCrypto.fingerprint('client_secret_real')).toBe(fingerprint);
  });
});

describe('safeEqual', () => {
  it('compara valores iguais e diferentes', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('blind index', () => {
  it('produz o mesmo indice para o mesmo documento, com ou sem mascara', () => {
    const index = new BlindIndex(PEPPER);
    expect(index.taxId('529.982.247-25')).toBe(index.taxId('52998224725'));
  });

  it('produz indices diferentes para documentos diferentes', () => {
    const index = new BlindIndex(PEPPER);
    expect(index.taxId('52998224725')).not.toBe(index.taxId('11222333000181'));
  });

  it('nao vaza o documento no indice', () => {
    const index = new BlindIndex(PEPPER).taxId('52998224725');
    expect(index).not.toContain('52998224725');
    expect(index).toMatch(/^[0-9a-f]{64}$/);
  });

  it('pepper diferente da indice diferente: e o que protege contra vazamento do banco', () => {
    const a = new BlindIndex(PEPPER).taxId('52998224725');
    const b = new BlindIndex(`${PEPPER}-outro`).taxId('52998224725');
    expect(a).not.toBe(b);
  });

  it('separa dominios: o mesmo texto como email e como chave Pix nao colide', () => {
    const index = new BlindIndex(PEPPER);
    expect(index.email('a@b.com')).not.toBe(index.pixKey('a@b.com'));
  });

  it('normaliza email antes de indexar', () => {
    const index = new BlindIndex(PEPPER);
    expect(index.email('  Joao@Exemplo.COM ')).toBe(index.email('joao@exemplo.com'));
  });

  it('recusa pepper curto, que nao impede enumeracao de CPF', () => {
    expect(() => new BlindIndex('curto')).toThrow(/32 caracteres/);
  });
});

describe('segredos de API key', () => {
  it('faz hash e verifica', async () => {
    const hash = await hashSecret('bck_hml_key_01_abc');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifySecret(hash, 'bck_hml_key_01_abc')).toBe(true);
    expect(await verifySecret(hash, 'errado')).toBe(false);
  });

  it('verifySecret devolve false em hash malformado, sem lancar', async () => {
    expect(await verifySecret('nao-e-hash', 'x')).toBe(false);
  });

  it('o indice de lookup e deterministico e permite achar a linha numa leitura', () => {
    const a = secretLookup('mesmo-segredo');
    const b = secretLookup('mesmo-segredo');
    expect(constantTimeEqual(a, b)).toBe(true);
    expect(constantTimeEqual(a, secretLookup('outro'))).toBe(false);
  });

  it('gera chave com prefixo que carrega o ambiente', () => {
    const homolog = generateApiKey({ environment: 'HOMOLOGACAO', keyId: 'key01' });
    const producao = generateApiKey({ environment: 'PRODUCAO', keyId: 'key01' });

    expect(homolog.secret).toMatch(/^bck_hml_key01_/);
    expect(producao.secret).toMatch(/^bck_prd_key01_/);
    // O ambiente visivel no prefixo e o que permite perceber em log ou ticket
    // que uma chave de producao foi apontada para o lugar errado.
    expect(homolog.prefix).toBe('bck_hml_key01');
  });

  it('gera segredo diferente a cada chamada', () => {
    const first = generateApiKey({ environment: 'HOMOLOGACAO', keyId: 'k' });
    const second = generateApiKey({ environment: 'HOMOLOGACAO', keyId: 'k' });
    expect(first.secret).not.toBe(second.secret);
  });

  it('parseia a chave de volta para ambiente e keyId', () => {
    const generated = generateApiKey({ environment: 'PRODUCAO', keyId: 'key01' });
    expect(parseApiKey(generated.secret)).toMatchObject({
      environment: 'PRODUCAO',
      keyId: 'key01',
    });
  });

  it('parseApiKey recusa formato invalido', () => {
    expect(parseApiKey('nao-e-uma-chave')).toBeUndefined();
    expect(parseApiKey('bck_xxx_key_abc')).toBeUndefined();
  });
});
