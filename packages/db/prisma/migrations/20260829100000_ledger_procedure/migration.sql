-- Procedure de escrita do razao.
--
-- A migration de hardening revoga UPDATE nos contadores materializados do
-- papel da aplicacao. Sem uma funcao SECURITY DEFINER, isso deixa o razao
-- IMPOSSIVEL de escrever em producao — e passando em todo teste de
-- desenvolvimento, onde o papel `baas_app` nao existe e o REVOKE e pulado.
--
-- Esta funcao e a unica porta de escrita. Ela NAO reimplementa as invariantes:
-- balanceamento continua no trigger DEFERRABLE, saldo nao-negativo no CHECK,
-- imutabilidade no trigger de mutacao. Duplicar a regra em plpgsql criaria
-- duas verdades que divergem na primeira correcao.

CREATE SCHEMA IF NOT EXISTS ledger;

/**
 * Persiste uma transacao do razao com seus lancamentos e contadores.
 *
 * Os tres argumentos vem do motor em `packages/ledger`, que ja decidiu o que
 * lancar e quanto cada contador muda. A funcao escreve; ela nao decide.
 *
 * `SECURITY DEFINER` com `search_path` fixo: sem o SET, um chamador poderia
 * criar uma tabela `ledger_entry` num schema proprio e fazer a funcao — que
 * roda como dona — escrever nela.
 */
CREATE OR REPLACE FUNCTION ledger.post_transaction(
  p_transaction jsonb,
  p_entries     jsonb,
  p_accounts    jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Espera patologica por lock vira erro limpo em vez de conexao pendurada.
  SET LOCAL lock_timeout = '3s';

  INSERT INTO ledger_transaction (
    id, environment, type, status, currency, amount_cents, idempotency_key,
    external_ref, description, pending_transaction_id,
    effective_at, posted_at, voided_at, metadata
  )
  SELECT
    t.id, t.environment::"Environment", t.type, t.status::"LedgerTransactionStatus",
    t.currency, t.amount_cents, t.idempotency_key,
    t.external_ref, t.description, t.pending_transaction_id,
    t.effective_at, t.posted_at, t.voided_at, COALESCE(t.metadata, '{}'::jsonb)
  FROM jsonb_to_record(p_transaction) AS t(
    id text, environment text, type text, status text, currency text,
    amount_cents bigint, idempotency_key text, external_ref text,
    description text, pending_transaction_id text,
    effective_at timestamptz, posted_at timestamptz, voided_at timestamptz,
    metadata jsonb
  )
  ON CONFLICT (id) DO UPDATE SET
    -- Resolver uma pendente reescreve o status da original, e so isso.
    status    = EXCLUDED.status,
    posted_at = EXCLUDED.posted_at,
    voided_at = EXCLUDED.voided_at;

  IF jsonb_array_length(COALESCE(p_entries, '[]'::jsonb)) > 0 THEN
    INSERT INTO ledger_entry (
      id, environment, transaction_id, ledger_account_id, direction,
      amount_cents, phase, currency, sequence, resulting_posted_cents, effective_at
    )
    SELECT
      e.id, e.environment::"Environment", e.transaction_id, e.ledger_account_id,
      e.direction::"EntryDirection", e.amount_cents, e.phase::"EntryPhase",
      e.currency, e.sequence, e.resulting_posted_cents, e.effective_at
    FROM jsonb_to_recordset(p_entries) AS e(
      id text, environment text, transaction_id text, ledger_account_id text,
      direction text, amount_cents bigint, phase text, currency text,
      sequence int, resulting_posted_cents bigint, effective_at timestamptz
    );
  END IF;

  IF jsonb_array_length(COALESCE(p_accounts, '[]'::jsonb)) > 0 THEN
    UPDATE ledger_account AS a
    SET debits_posted   = c.debits_posted,
        credits_posted  = c.credits_posted,
        debits_pending  = c.debits_pending,
        credits_pending = c.credits_pending,
        entry_count     = c.entry_count,
        last_entry_id   = c.last_entry_id,
        -- Contador otimista: cresce a cada escrita, para a conciliacao poder
        -- detectar que a linha mudou entre duas leituras.
        version         = a.version + 1,
        updated_at      = now()
    FROM jsonb_to_recordset(p_accounts) AS c(
      id text, debits_posted bigint, credits_posted bigint,
      debits_pending bigint, credits_pending bigint,
      entry_count bigint, last_entry_id text
    )
    WHERE a.id = c.id;
  END IF;
END;
$$;

COMMENT ON FUNCTION ledger.post_transaction(jsonb, jsonb, jsonb) IS
  'Unica porta de escrita do razao. Contadores so mudam por aqui.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'baas_app') THEN
    GRANT USAGE ON SCHEMA ledger TO baas_app;
    GRANT EXECUTE ON FUNCTION ledger.post_transaction(jsonb, jsonb, jsonb) TO baas_app;
    -- Reforca o ponto: a aplicacao chama a funcao e nao toca nos contadores.
    REVOKE UPDATE (debits_posted, credits_posted, debits_pending, credits_pending)
      ON ledger_account FROM baas_app;
  END IF;
END $$;
