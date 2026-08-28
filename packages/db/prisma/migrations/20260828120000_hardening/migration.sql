-- Invariantes que apenas o BANCO consegue garantir.
--
-- O que esta aqui nao pode viver em codigo de aplicacao: uma checagem em
-- aplicacao e uma corrida, e um CHECK numa linha cujo lock ja detemos nao e.
-- Estes objetos tambem protegem contra caminhos que nao passam pela aplicacao:
-- migration com bug, script de correcao, sessao psql.

-- ---------------------------------------------------------------------------
-- 1. Ledger: saldo nao negativo
-- ---------------------------------------------------------------------------

-- E por causa DESTE constraint que os contadores sao materializados: um CHECK
-- nao consegue agregar outra tabela.
ALTER TABLE ledger_account
  ADD CONSTRAINT ledger_account_no_overdraft CHECK (
    allows_negative
    OR (normal_balance = 'CREDIT'
        AND credits_posted - debits_posted - debits_pending >= 0)
    OR (normal_balance = 'DEBIT'
        AND debits_posted - credits_posted - credits_pending >= 0)
  );

ALTER TABLE ledger_account
  ADD CONSTRAINT ledger_account_counters_nonneg CHECK (
    debits_posted >= 0 AND credits_posted >= 0
    AND debits_pending >= 0 AND credits_pending >= 0
  );

-- O sinal vive em `direction`; valor sempre positivo.
ALTER TABLE ledger_entry
  ADD CONSTRAINT ledger_entry_amount_positive CHECK (amount_cents > 0);

-- ---------------------------------------------------------------------------
-- 2. Ledger: transacao sempre balanceada
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION assert_ledger_transaction_balanced()
RETURNS TRIGGER AS $$
DECLARE
  v_debits  BIGINT;
  v_credits BIGINT;
BEGIN
  SELECT
    COALESCE(SUM(amount_cents) FILTER (WHERE direction = 'DEBIT'), 0),
    COALESCE(SUM(amount_cents) FILTER (WHERE direction = 'CREDIT'), 0)
  INTO v_debits, v_credits
  FROM ledger_entry
  WHERE transaction_id = NEW.transaction_id;

  IF v_debits <> v_credits THEN
    RAISE EXCEPTION
      'LEDGER_UNBALANCED: transacao % tem debitos % e creditos %',
      NEW.transaction_id, v_debits, v_credits
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- DEFERRABLE INITIALLY DEFERRED: a checagem roda no COMMIT, quando todas as
-- pernas ja foram inseridas. Assim nem um INSERT direto, fora da procedure,
-- consegue deixar o razao desbalanceado.
CREATE CONSTRAINT TRIGGER ledger_entry_balanced
  AFTER INSERT ON ledger_entry
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_ledger_transaction_balanced();

-- Lancamento e imutavel: correcao e sempre lancamento novo.
CREATE OR REPLACE FUNCTION reject_ledger_entry_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'LEDGER_ENTRY_IMMUTABLE: lancamentos nao podem ser alterados nem removidos; '
    'registre um lancamento de ajuste'
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_entry_no_mutation
  BEFORE UPDATE OR DELETE ON ledger_entry
  FOR EACH ROW EXECUTE FUNCTION reject_ledger_entry_mutation();

-- Uma transacao pendente e resolvida no maximo uma vez.
CREATE UNIQUE INDEX ledger_tx_pending_resolution_uq
  ON ledger_transaction (pending_transaction_id)
  WHERE pending_transaction_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Trilha de auditoria: append-only com cadeia de hash
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION reject_audit_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'AUDIT_LOG_APPEND_ONLY: a trilha de auditoria nao pode ser alterada nem removida'
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

-- Sem excecao de papel: nem o superusuario passa por aqui sem derrubar o
-- trigger antes, o que por si so ja e um evento auditavel no log do banco.
CREATE TRIGGER audit_log_no_mutation
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

-- Cadeia de hash: apagar ou alterar uma linha quebra o encadeamento e fica
-- detectavel por GET /admin/v1/audit/verify.
CREATE OR REPLACE FUNCTION compute_audit_chain()
RETURNS TRIGGER AS $$
DECLARE
  v_prev_hash BYTEA;
  v_payload   TEXT;
BEGIN
  SELECT row_hash INTO v_prev_hash
  FROM audit_log
  WHERE environment = NEW.environment
  ORDER BY sequence DESC
  LIMIT 1;

  NEW.prev_hash := v_prev_hash;

  v_payload := concat_ws('|',
    NEW.sequence::TEXT,
    NEW.occurred_at::TEXT,
    NEW.actor_type::TEXT,
    COALESCE(NEW.actor_id, ''),
    NEW.action,
    NEW.outcome::TEXT,
    NEW.resource_type,
    COALESCE(NEW.resource_id, ''),
    COALESCE(NEW.before::TEXT, ''),
    COALESCE(NEW.after::TEXT, ''),
    COALESCE(NEW.request_id, '')
  );

  NEW.row_hash := digest(v_payload || COALESCE(encode(v_prev_hash, 'hex'), ''), 'sha256');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_chain
  BEFORE INSERT ON audit_log
  FOR EACH ROW EXECUTE FUNCTION compute_audit_chain();

-- ---------------------------------------------------------------------------
-- 4. Indices unicos parciais que o Prisma nao expressa
-- ---------------------------------------------------------------------------

-- Uma pendencia por (caso, codigo, sujeito). O COALESCE existe porque o
-- Postgres trata NULLs como distintos num UNIQUE comum, e a pendencia sem
-- representante especifico entraria duas vezes.
CREATE UNIQUE INDEX onboarding_requirement_uq
  ON onboarding_requirement (case_id, code, COALESCE(subject_representative_id, ''));

-- Apenas UMA chave Pix ativa por valor.
CREATE UNIQUE INDEX pix_key_active_uq
  ON pix_key (environment, type, value)
  WHERE status = 'ACTIVE';

-- O EndToEndId e globalmente unico no PIX e e a nossa chave de idempotencia de
-- ultimo recurso para webhooks. Parcial porque ele so existe a partir de
-- PROCESSING.
CREATE UNIQUE INDEX pix_detail_e2eid_uq
  ON pix_detail (environment, end_to_end_id)
  WHERE end_to_end_id IS NOT NULL;

CREATE UNIQUE INDEX pix_detail_return_id_uq
  ON pix_detail (environment, return_id)
  WHERE return_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. Busca textual em contas
-- ---------------------------------------------------------------------------

CREATE INDEX account_holder_legal_name_trgm
  ON account_holder USING gin (legal_name gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 6. Papel da aplicacao
-- ---------------------------------------------------------------------------

-- Executado apenas quando o papel existe: `docker compose up` usa o superusuario.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'baas_app') THEN
    -- A aplicacao insere e le auditoria, e nunca altera nem apaga.
    REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM baas_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON ledger_entry FROM baas_app;
    -- Os contadores materializados so mudam pela procedure do razao.
    REVOKE UPDATE (debits_posted, credits_posted, debits_pending, credits_pending)
      ON ledger_account FROM baas_app;
  END IF;
END $$;
