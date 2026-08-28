import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

/**
 * Invariantes que so o BANCO garante.
 *
 * Roda contra Postgres compilado para WASM (PGlite), entao vale no CI sem
 * container e sem rede. O que esta aqui nao pode ser testado em codigo de
 * aplicacao: sao CHECK constraints, triggers e indices parciais, e o ponto
 * deles e justamente barrar caminhos que NAO passam pela aplicacao (migration
 * com bug, script de correcao, sessao psql).
 */

const MIGRATIONS_DIR = join(import.meta.dirname, '../prisma/migrations');
const MIGRATION_NAMES = ['20260828110000_init', '20260828120000_hardening'];
const ENV = 'HOMOLOGACAO';

const migrations = MIGRATION_NAMES.map((name) =>
  readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8'),
);

type Db = Awaited<ReturnType<typeof freshDb>>;

/** Banco novo por teste: um erro nao contamina o proximo. */
async function freshDb() {
  const db = await new PGlite({ extensions: { pg_trgm, pgcrypto } });
  for (const sql of migrations) await db.exec(sql);
  await db.exec(`
    INSERT INTO ledger_account (id, environment, code, name, type, normal_balance, owner_type, allows_negative, updated_at)
    VALUES
      ('lac_a', '${ENV}', '2000.a', 'Cliente A', 'LIABILITY', 'CREDIT', 'CUSTOMER', false, now()),
      ('lac_b', '${ENV}', '2000.b', 'Cliente B', 'LIABILITY', 'CREDIT', 'CUSTOMER', false, now()),
      ('lac_ext', '${ENV}', '9000', 'Mundo externo', 'ASSET', 'DEBIT', 'EXTERNAL', true, now());
  `);
  return db;
}

let db: Db;

async function open(): Promise<Db> {
  db = await freshDb();
  return db;
}

afterEach(async () => {
  await db?.close();
});

const tx = (database: Db, id: string, key: string) =>
  database.exec(
    `INSERT INTO ledger_transaction (id, environment, type, status, amount_cents, idempotency_key, effective_at)
     VALUES ('${id}', '${ENV}', 'TEST', 'POSTED', 100, '${key}', now())`,
  );

const entry = (
  database: Db,
  id: string,
  txId: string,
  accountId: string,
  direction: 'DEBIT' | 'CREDIT',
  amount: number,
  sequence: number,
) =>
  database.exec(
    `INSERT INTO ledger_entry (id, environment, transaction_id, ledger_account_id, direction, amount_cents, phase, sequence, resulting_posted_cents, effective_at)
     VALUES ('${id}', '${ENV}', '${txId}', '${accountId}', '${direction}', ${amount}, 'POSTED', ${sequence}, 0, now())`,
  );

const audit = (database: Db, id: string, action: string) =>
  database.exec(
    `INSERT INTO audit_log (id, environment, occurred_at, actor_type, action, resource_type, row_hash)
     VALUES ('${id}', '${ENV}', now(), 'SYSTEM', '${action}', 'account', '\\x00')`,
  );

async function seedAccount(database: Db) {
  await database.exec(`
    INSERT INTO account_holder (id, environment, type, tax_id_type, tax_id_ciphertext, tax_id_iv,
      tax_id_tag, tax_id_wrapped_key, tax_id_key_id, tax_id_blind_index, tax_id_last4,
      legal_name, email, email_blind_index, phone_area_code, phone_number, updated_at)
    VALUES ('hld_1', '${ENV}', 'INDIVIDUAL', 'CPF', '\\x00','\\x00','\\x00','\\x00','local:v1','idx1','4725',
      'Maria','a@b.com','eidx','11','987654321', now());
    INSERT INTO provider_connection (id, environment, provider, credentials_ciphertext, credentials_iv,
      credentials_tag, credentials_wrapped_key, credentials_key_id, updated_at)
    VALUES ('con_1', '${ENV}', 'MOCK_BANK', '\\x00','\\x00','\\x00','\\x00','local:v1', now());
    INSERT INTO account (id, environment, holder_id, provider, provider_connection_id, updated_at)
    VALUES ('acc_1', '${ENV}', 'hld_1', 'MOCK_BANK', 'con_1', now());
  `);
}

const pixKey = (database: Db, id: string, value: string, status: string) =>
  database.exec(
    `INSERT INTO pix_key (id, environment, account_id, type, value, value_blind_index, status, updated_at)
     VALUES ('${id}', '${ENV}', 'acc_1', 'EVP', '${value}', 'bidx', '${status}', now())`,
  );

const pixDetail = (database: Db, txId: string, endToEndId: string | null) =>
  database.exec(`
    INSERT INTO transaction (id, environment, account_id, type, direction, amount_cents, net_amount_cents,
      provider, provider_connection_id, effective_date, updated_at)
    VALUES ('${txId}', '${ENV}', 'acc_1', 'PIX_IN', 'CREDIT', 100, 100, 'MOCK_BANK', 'con_1', CURRENT_DATE, now());
    INSERT INTO pix_detail (transaction_id, environment, end_to_end_id, initiation_method)
    VALUES ('${txId}', '${ENV}', ${endToEndId ? `'${endToEndId}'` : 'NULL'}, 'KEY');
  `);

describe('migrations', () => {
  it('aplicam de vazio ate o estado atual', async () => {
    const database = await open();
    const tables = await database.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    expect(tables.rows[0]!.n).toBeGreaterThan(30);
  });
});

describe('CHECK de saldo do razao', () => {
  it('recusa saldo negativo em conta de cliente', async () => {
    const database = await open();
    await expect(
      database.exec(`UPDATE ledger_account SET debits_posted = 500 WHERE id = 'lac_a'`),
    ).rejects.toThrow(/no_overdraft/);
  });

  it('permite negativo apenas na conta marcada, como a contraparte externa', async () => {
    const database = await open();
    await expect(
      database.exec(`UPDATE ledger_account SET credits_posted = 500 WHERE id = 'lac_ext'`),
    ).resolves.toBeDefined();
  });

  it('recusa lancamento com valor zero ou negativo: o sinal vive em direction', async () => {
    const database = await open();
    await tx(database, 'ltx_zero', 'k-zero');
    await expect(entry(database, 'len_zero', 'ltx_zero', 'lac_a', 'DEBIT', 0, 0)).rejects.toThrow(
      /amount_positive/,
    );
    await expect(entry(database, 'len_neg', 'ltx_zero', 'lac_a', 'DEBIT', -100, 1)).rejects.toThrow(
      /amount_positive/,
    );
  });
});

describe('trigger de balanceamento (DEFERRABLE)', () => {
  it('recusa transacao desbalanceada no COMMIT', async () => {
    const database = await open();
    await database.exec('BEGIN');
    await tx(database, 'ltx_unb', 'k-unb');
    await entry(database, 'len_u1', 'ltx_unb', 'lac_a', 'CREDIT', 100, 0);
    await entry(database, 'len_u2', 'ltx_unb', 'lac_b', 'DEBIT', 99, 1);
    // A checagem so roda no COMMIT, quando todas as pernas ja foram inseridas.
    await expect(database.exec('COMMIT')).rejects.toThrow(/LEDGER_UNBALANCED/);
    await database.exec('ROLLBACK').catch(() => undefined);
  });

  it('aceita transacao balanceada', async () => {
    const database = await open();
    await database.exec('BEGIN');
    await tx(database, 'ltx_ok', 'k-ok');
    await entry(database, 'len_o1', 'ltx_ok', 'lac_ext', 'DEBIT', 100, 0);
    await entry(database, 'len_o2', 'ltx_ok', 'lac_a', 'CREDIT', 100, 1);
    await expect(database.exec('COMMIT')).resolves.toBeDefined();
  });

  it('recusa lancamento solitario, que por definicao nao balanceia', async () => {
    const database = await open();
    await database.exec('BEGIN');
    await tx(database, 'ltx_solo', 'k-solo');
    await entry(database, 'len_solo', 'ltx_solo', 'lac_a', 'CREDIT', 100, 0);
    await expect(database.exec('COMMIT')).rejects.toThrow(/LEDGER_UNBALANCED/);
    await database.exec('ROLLBACK').catch(() => undefined);
  });
});

describe('imutabilidade de lancamento', () => {
  async function withPostedEntry(database: Db) {
    await database.exec('BEGIN');
    await tx(database, 'ltx_i', 'k-i');
    await entry(database, 'len_i1', 'ltx_i', 'lac_ext', 'DEBIT', 100, 0);
    await entry(database, 'len_i2', 'ltx_i', 'lac_a', 'CREDIT', 100, 1);
    await database.exec('COMMIT');
  }

  it('recusa UPDATE: correcao e sempre lancamento novo', async () => {
    const database = await open();
    await withPostedEntry(database);
    await expect(
      database.exec(`UPDATE ledger_entry SET amount_cents = 999 WHERE id = 'len_i1'`),
    ).rejects.toThrow(/IMMUTABLE/);
  });

  it('recusa DELETE', async () => {
    const database = await open();
    await withPostedEntry(database);
    await expect(database.exec(`DELETE FROM ledger_entry WHERE id = 'len_i1'`)).rejects.toThrow(
      /IMMUTABLE/,
    );
  });

  it('recusa sequence duplicado na mesma transacao', async () => {
    const database = await open();
    await database.exec('BEGIN');
    await tx(database, 'ltx_s', 'k-s');
    await entry(database, 'len_s1', 'ltx_s', 'lac_ext', 'DEBIT', 100, 0);
    await expect(entry(database, 'len_s2', 'ltx_s', 'lac_a', 'CREDIT', 100, 0)).rejects.toThrow(
      /sequence/,
    );
    await database.exec('ROLLBACK').catch(() => undefined);
  });
});

describe('trilha de auditoria append-only', () => {
  it('aceita insercao', async () => {
    const database = await open();
    await expect(audit(database, 'aud_1', 'account.create')).resolves.toBeDefined();
  });

  it('recusa UPDATE, independente do papel do banco', async () => {
    const database = await open();
    await audit(database, 'aud_1', 'account.create');
    await expect(
      database.exec(`UPDATE audit_log SET action = 'adulterado' WHERE id = 'aud_1'`),
    ).rejects.toThrow(/APPEND_ONLY/);
  });

  it('recusa DELETE', async () => {
    const database = await open();
    await audit(database, 'aud_1', 'account.create');
    await expect(database.exec(`DELETE FROM audit_log WHERE id = 'aud_1'`)).rejects.toThrow(
      /APPEND_ONLY/,
    );
  });

  it('encadeia as linhas por hash: apagar uma quebra a cadeia', async () => {
    const database = await open();
    await audit(database, 'aud_1', 'account.create');
    await audit(database, 'aud_2', 'account.block');

    const rows = await database.query<{ id: string; h: string; p: string | null }>(
      `SELECT id, encode(row_hash,'hex') AS h, encode(prev_hash,'hex') AS p
       FROM audit_log ORDER BY sequence`,
    );
    const [first, second] = rows.rows;

    expect(first!.h).not.toBe('00');
    expect(first!.p).toBeNull();
    expect(second!.p).toBe(first!.h);
  });

  it('duas acoes identicas produzem hashes diferentes', async () => {
    const database = await open();
    await audit(database, 'aud_1', 'mesma.acao');
    await audit(database, 'aud_2', 'mesma.acao');
    const rows = await database.query<{ h: string }>(
      `SELECT encode(row_hash,'hex') AS h FROM audit_log ORDER BY sequence`,
    );
    // Se o encadeamento nao entrasse no hash, reordenar o log seria indetectavel.
    expect(rows.rows[0]!.h).not.toBe(rows.rows[1]!.h);
  });
});

describe('indices unicos parciais', () => {
  it('recusa segunda chave Pix ATIVA com o mesmo valor', async () => {
    const database = await open();
    await seedAccount(database);
    await pixKey(database, 'pky_1', 'chave-1', 'ACTIVE');
    await expect(pixKey(database, 'pky_2', 'chave-1', 'ACTIVE')).rejects.toThrow(
      /pix_key_active_uq/,
    );
  });

  it('permite reusar o valor quando a anterior foi REMOVED', async () => {
    const database = await open();
    await seedAccount(database);
    await pixKey(database, 'pky_1', 'chave-1', 'REMOVED');
    await expect(pixKey(database, 'pky_2', 'chave-1', 'ACTIVE')).resolves.toBeDefined();
  });

  it('recusa EndToEndId duplicado: ele e a chave de dedupe de ultimo recurso', async () => {
    const database = await open();
    await seedAccount(database);
    await pixDetail(database, 'txn_1', 'E99999001202608281403ABCDE123456');
    await expect(pixDetail(database, 'txn_2', 'E99999001202608281403ABCDE123456')).rejects.toThrow(
      /pix_detail_e2eid_uq/,
    );
  });

  it('permite varios nulos: o E2EID so existe a partir de PROCESSING', async () => {
    const database = await open();
    await seedAccount(database);
    await pixDetail(database, 'txn_1', null);
    await expect(pixDetail(database, 'txn_2', null)).resolves.toBeDefined();
  });
});
