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
const MIGRATION_NAMES = [
  '20260828110000_init',
  '20260828120000_hardening',
  '20260829100000_ledger_procedure',
  '20260829140000_break_dedupe',
  '20260830120000_audit_verify',
];
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

  it('a verificacao confirma uma cadeia intacta', async () => {
    const database = await open();
    await audit(database, 'aud_1', 'account.create');
    await audit(database, 'aud_2', 'account.block');
    await audit(database, 'aud_3', 'account.close');

    const { rows } = await database.query<{
      checked_count: string;
      divergent_id: string | null;
    }>(
      `SELECT * FROM verify_audit_chain('${ENV}', '2000-01-01'::timestamptz, '2100-01-01'::timestamptz)`,
    );

    expect(Number(rows[0]!.checked_count)).toBe(3);
    expect(rows[0]!.divergent_id).toBeNull();
  });

  it('a verificacao ACHA a linha adulterada, e nomeia qual', async () => {
    // A formula do encadeamento vive no trigger; a verificacao recalcula com o
    // MESMO `concat_ws`, na mesma migration. Reimplementa-la em TypeScript
    // criaria duas definicoes que divergem na primeira mudanca — e o sintoma
    // seria acusar adulteracao que nao houve, ou perder a que houve.
    const database = await open();
    await audit(database, 'aud_1', 'account.create');
    await audit(database, 'aud_2', 'account.block');
    await audit(database, 'aud_3', 'account.close');

    // A aplicacao NAO consegue fazer isto: o trigger recusa UPDATE. Aqui o
    // teste desliga o trigger para simular comprometimento do banco, que e
    // exatamente a ameaca que a cadeia existe para detectar.
    await database.exec(`ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_mutation`);
    await database.exec(`UPDATE audit_log SET action = 'adulterado' WHERE id = 'aud_2'`);
    await database.exec(`ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_mutation`);

    const { rows } = await database.query<{
      checked_count: string;
      divergent_id: string | null;
      divergent_sequence: string | null;
    }>(
      `SELECT * FROM verify_audit_chain('${ENV}', '2000-01-01'::timestamptz, '2100-01-01'::timestamptz)`,
    );

    expect(rows[0]!.divergent_id).toBe('aud_2');
    // Para na PRIMEIRA divergencia: seguir depois dela reportaria toda linha
    // seguinte como quebrada, e o operador perderia qual foi a alterada.
    expect(Number(rows[0]!.checked_count)).toBe(2);
  });

  it('apagar uma linha e detectado pelo elo, nao pelo hash da propria linha', async () => {
    const database = await open();
    await audit(database, 'aud_1', 'account.create');
    await audit(database, 'aud_2', 'account.block');
    await audit(database, 'aud_3', 'account.close');

    await database.exec(`ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_mutation`);
    await database.exec(`DELETE FROM audit_log WHERE id = 'aud_2'`);
    await database.exec(`ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_mutation`);

    // A linha 3 continua com hash proprio valido — o que a denuncia e o
    // `prev_hash`, que aponta para uma linha que nao existe mais.
    const { rows } = await database.query<{ divergent_id: string | null }>(
      `SELECT * FROM verify_audit_chain('${ENV}', '2000-01-01'::timestamptz, '2100-01-01'::timestamptz)`,
    );
    expect(rows[0]!.divergent_id).toBe('aud_3');
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

/**
 * A procedure do razao.
 *
 * Ela existe porque a migration de hardening revoga UPDATE nos contadores do
 * papel da aplicacao. Sem SECURITY DEFINER, o razao fica impossivel de
 * escrever em producao — e passando em todo teste de desenvolvimento, onde o
 * papel nao existe e o REVOKE e pulado. Os testes abaixo exercitam a funcao
 * pelo mesmo caminho que a aplicacao usa.
 */
describe('ledger.post_transaction', () => {
  const post = (
    database: Db,
    transaction: Record<string, unknown>,
    entries: Array<Record<string, unknown>>,
    accounts: Array<Record<string, unknown>>,
  ) =>
    database.query('SELECT ledger.post_transaction($1::jsonb, $2::jsonb, $3::jsonb)', [
      JSON.stringify(transaction),
      JSON.stringify(entries),
      JSON.stringify(accounts),
    ]);

  const transferOf = (id: string, key: string, amount: number, phase = 'POSTED') => ({
    transaction: {
      id,
      environment: ENV,
      type: 'PIX_IN_RECEIVE',
      status: phase === 'PENDING' ? 'PENDING' : 'POSTED',
      currency: 'BRL',
      amount_cents: amount,
      idempotency_key: key,
      effective_at: '2026-08-28T12:00:00.000Z',
      posted_at: phase === 'POSTED' ? '2026-08-28T12:00:00.000Z' : null,
      voided_at: null,
      external_ref: null,
      description: null,
      pending_transaction_id: null,
      metadata: {},
    },
    entries: [
      {
        id: `len_${id}_1`,
        environment: ENV,
        transaction_id: id,
        ledger_account_id: 'lac_ext',
        direction: 'DEBIT',
        amount_cents: amount,
        phase,
        currency: 'BRL',
        sequence: 0,
        resulting_posted_cents: amount,
        effective_at: '2026-08-28T12:00:00.000Z',
      },
      {
        id: `len_${id}_2`,
        environment: ENV,
        transaction_id: id,
        ledger_account_id: 'lac_a',
        direction: 'CREDIT',
        amount_cents: amount,
        phase,
        currency: 'BRL',
        sequence: 1,
        resulting_posted_cents: amount,
        effective_at: '2026-08-28T12:00:00.000Z',
      },
    ],
  });

  it('escreve transacao, lancamentos e contadores numa chamada', async () => {
    const database = await open();
    const { transaction, entries } = transferOf('ltx_1', 'chave-1', 150_000);

    await post(database, transaction, entries, [
      {
        id: 'lac_ext',
        debits_posted: 150_000,
        credits_posted: 0,
        debits_pending: 0,
        credits_pending: 0,
        entry_count: 1,
        last_entry_id: 'len_ltx_1_1',
      },
      {
        id: 'lac_a',
        debits_posted: 0,
        credits_posted: 150_000,
        debits_pending: 0,
        credits_pending: 0,
        entry_count: 1,
        last_entry_id: 'len_ltx_1_2',
      },
    ]);

    const conta = await database.query<{ credits_posted: bigint; version: bigint }>(
      `SELECT credits_posted, version FROM ledger_account WHERE id = 'lac_a'`,
    );
    expect(String(conta.rows[0]?.credits_posted)).toBe('150000');
    // A versao cresce a cada escrita: e o que permite a conciliacao detectar
    // que a linha mudou entre duas leituras.
    expect(String(conta.rows[0]?.version)).toBe('1');

    const lancamentos = await database.query(
      `SELECT id FROM ledger_entry WHERE transaction_id = 'ltx_1'`,
    );
    expect(lancamentos.rows).toHaveLength(2);
  });

  it('recusa transacao desbalanceada no COMMIT, nao antes', async () => {
    const database = await open();
    const { transaction, entries } = transferOf('ltx_2', 'chave-2', 100);
    // Uma perna alterada: debito 100, credito 90.
    entries[1]!.amount_cents = 90;

    // O trigger e DEFERRABLE INITIALLY DEFERRED de proposito — ele so pode
    // julgar quando todas as pernas ja entraram. Recusar no primeiro INSERT
    // tornaria impossivel escrever qualquer transacao.
    await expect(post(database, transaction, entries, [])).rejects.toThrow(/LEDGER_UNBALANCED/);
  });

  it('recusa contador que deixaria a conta negativa', async () => {
    const database = await open();
    const { transaction, entries } = transferOf('ltx_3', 'chave-3', 100);

    // O CHECK e o que de fato garante a propriedade: um erro de aplicacao, uma
    // migration com bug ou uma sessao psql batem todos aqui.
    await expect(
      post(database, transaction, entries, [
        {
          id: 'lac_a',
          debits_posted: 500,
          credits_posted: 0,
          debits_pending: 0,
          credits_pending: 0,
          entry_count: 1,
          last_entry_id: null,
        },
      ]),
    ).rejects.toThrow(/ledger_account_no_overdraft/);
  });

  it('deixa a conta com allows_negative ficar negativa', async () => {
    const database = await open();
    const { transaction, entries } = transferOf('ltx_4', 'chave-4', 100);

    // `9000` (mundo externo) existe justamente para toda transacao fechar sem
    // caso especial quando o outro lado nao e nosso.
    await expect(
      post(database, transaction, entries, [
        {
          id: 'lac_ext',
          debits_posted: 0,
          credits_posted: 999_999,
          debits_pending: 0,
          credits_pending: 0,
          entry_count: 1,
          last_entry_id: null,
        },
      ]),
    ).resolves.toBeDefined();
  });

  it('resolve uma pendente atualizando so o status da original', async () => {
    const database = await open();
    const pendente = transferOf('ltx_5', 'chave-5', 100, 'PENDING');
    await post(database, pendente.transaction, pendente.entries, []);

    // Segunda chamada com o mesmo id: o ON CONFLICT so reescreve status e
    // carimbos, nunca o valor nem a chave de idempotencia.
    await post(
      database,
      { ...pendente.transaction, status: 'POSTED', posted_at: '2026-08-28T12:05:00.000Z' },
      [],
      [],
    );

    const row = await database.query<{ status: string; amount_cents: bigint }>(
      `SELECT status, amount_cents FROM ledger_transaction WHERE id = 'ltx_5'`,
    );
    expect(row.rows[0]?.status).toBe('POSTED');
    expect(String(row.rows[0]?.amount_cents)).toBe('100');
  });

  it('recusa duas resolucoes para a mesma pendente', async () => {
    const database = await open();
    const pendente = transferOf('ltx_6', 'chave-6', 100, 'PENDING');
    await post(database, pendente.transaction, pendente.entries, []);

    const resolucao = (id: string, key: string) => ({
      ...transferOf(id, key, 100).transaction,
      pending_transaction_id: 'ltx_6',
    });

    await post(database, resolucao('ltx_7', 'chave-7'), [], []);
    // Uma pendente resolvida duas vezes seria dinheiro capturado em dobro.
    await expect(post(database, resolucao('ltx_8', 'chave-8'), [], [])).rejects.toThrow(
      /ledger_tx_pending_resolution_uq/,
    );
  });

  it('recusa chave de idempotencia repetida no mesmo ambiente', async () => {
    const database = await open();
    const primeira = transferOf('ltx_9', 'mesma-chave', 100);
    await post(database, primeira.transaction, primeira.entries, []);

    const segunda = transferOf('ltx_10', 'mesma-chave', 100);
    await expect(post(database, segunda.transaction, segunda.entries, [])).rejects.toThrow(
      /idempotency_key/,
    );
  });
});

/**
 * Dedup de quebra de conciliacao.
 *
 * O comentario no schema promete "a mesma quebra nao vira duas". Com um unique
 * comum e `end_to_end_id` nullable, ele mentia: em Postgres NULL nunca e igual
 * a NULL num indice unico. A execucao intraday roda a cada 30 minutos, entao a
 * mesma quebra de saldo virava 48 linhas por dia.
 *
 * A chave e uma coluna DERIVADA, e nao `COALESCE(end_to_end_id, '')` nem
 * `NULLS NOT DISTINCT`: as duas colapsariam numa linha so todas as quebras do
 * mesmo (conexao, tipo, data) sem E2EID, e o operador resolveria uma achando
 * que resolveu as duas.
 */
describe('dedup de quebra de conciliacao', () => {
  const RUN = 'rec_1';

  async function withRun(): Promise<Db> {
    const database = await open();
    await database.exec(`
      INSERT INTO reconciliation_run
        (id, environment, connection_id, scope, window_start, window_end, triggered_by)
      VALUES ('${RUN}', '${ENV}', 'con_1', 'INTRADAY',
              '2026-08-29T00:00:00Z', '2026-08-29T23:59:59Z', 'teste');
    `);
    return database;
  }

  const insertBreak = (
    database: Db,
    id: string,
    input: { type?: string; endToEndId?: string | null; dedupeKey: string },
  ) =>
    database.query(
      `INSERT INTO reconciliation_break
         (id, environment, run_id, first_seen_run_id, connection_id, type, severity,
          effective_date, end_to_end_id, dedupe_key, description, evidence, updated_at)
       VALUES ($1, '${ENV}', '${RUN}', '${RUN}', 'con_1', $2::"BreakType", 'HIGH',
               DATE '2026-08-29', $3, $4, 'divergencia', '{}'::jsonb, now())`,
      [id, input.type ?? 'BALANCE_MISMATCH', input.endToEndId ?? null, input.dedupeKey],
    );

  it('quebra SEM E2EID nao duplica entre execucoes', async () => {
    const database = await withRun();
    await insertBreak(database, 'brk_1', { dedupeKey: 'bal:acc_1' });

    // Este e o caso que escapava: sem chave derivada, a segunda execucao
    // abriria uma quebra nova para a MESMA divergencia de saldo, e o operador
    // veria ruido no lugar de trabalho.
    await expect(insertBreak(database, 'brk_2', { dedupeKey: 'bal:acc_1' })).rejects.toThrow(
      /reconciliation_break_dedupe_uq/,
    );
  });

  it('duas quebras DISTINTAS sem E2EID continuam distintas', async () => {
    const database = await withRun();
    // O que `NULLS NOT DISTINCT` e `COALESCE(.., '')` estragariam: dois
    // debitos fantasma diferentes no mesmo dia sao duas quebras, e resolver
    // uma nao resolve a outra.
    await insertBreak(database, 'brk_3', {
      type: 'MISSING_ON_PROVIDER',
      dedupeKey: 'litem:txn_a',
    });
    await insertBreak(database, 'brk_4', {
      type: 'MISSING_ON_PROVIDER',
      dedupeKey: 'litem:txn_b',
    });

    const rows = await database.query<{ count: bigint }>(
      `SELECT count(*) AS count FROM reconciliation_break WHERE type = 'MISSING_ON_PROVIDER'`,
    );
    expect(String(rows.rows[0]?.count)).toBe('2');
  });

  it('quebra COM E2EID continua deduplicando', async () => {
    const database = await withRun();
    const e2e = 'E1234567820260829120011111111111';
    await insertBreak(database, 'brk_5', { endToEndId: e2e, dedupeKey: `e2e:${e2e}` });

    await expect(
      insertBreak(database, 'brk_6', { endToEndId: e2e, dedupeKey: `e2e:${e2e}` }),
    ).rejects.toThrow(/reconciliation_break_dedupe_uq/);
  });

  it('a chave derivada e obrigatoria', async () => {
    const database = await withRun();
    // NOT NULL e o que garante que a dedup nunca volta a depender de NULL.
    await expect(
      database.exec(`
        INSERT INTO reconciliation_break
          (id, environment, run_id, first_seen_run_id, connection_id, type, severity,
           effective_date, description, evidence, updated_at)
        VALUES ('brk_7', '${ENV}', '${RUN}', '${RUN}', 'con_1', 'BALANCE_MISMATCH', 'HIGH',
                DATE '2026-08-29', 'sem chave', '{}'::jsonb, now());
      `),
    ).rejects.toThrow(/dedupe_key/);
  });
});
