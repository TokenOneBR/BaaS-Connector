-- Verificacao da cadeia de auditoria.
--
-- A formula do encadeamento vive no trigger `compute_audit_chain`, criado na
-- migration de hardening. Reimplementa-la em TypeScript criaria DUAS
-- definicoes da mesma formula, e elas divergem na primeira mudanca — o
-- sintoma seria o verificador acusar adulteracao que nao houve, ou, pior,
-- deixar de ver a que houve.
--
-- Entao a verificacao mora aqui, ao lado do trigger, e recalcula com o MESMO
-- `concat_ws`. Quem chama e `GET /admin/v1/audit/verify`.
--
-- Somente leitura. O papel da aplicacao nao tem UPDATE nem DELETE em
-- `audit_log`, e esta funcao nao precisa deles.
CREATE OR REPLACE FUNCTION verify_audit_chain(
  p_environment TEXT,
  p_from TIMESTAMPTZ,
  p_to TIMESTAMPTZ
)
RETURNS TABLE (
  checked_count BIGINT,
  divergent_id VARCHAR,
  divergent_sequence BIGINT,
  divergent_occurred_at TIMESTAMPTZ
) AS $$
DECLARE
  v_row          RECORD;
  v_prev_hash    BYTEA;
  v_first        BOOLEAN := TRUE;
  v_payload      TEXT;
  v_expected     BYTEA;
  v_count        BIGINT := 0;
BEGIN
  divergent_id := NULL;
  divergent_sequence := NULL;
  divergent_occurred_at := NULL;

  FOR v_row IN
    SELECT * FROM audit_log
    WHERE environment::TEXT = p_environment
      AND occurred_at >= p_from
      AND occurred_at <= p_to
    ORDER BY sequence ASC
  LOOP
    v_count := v_count + 1;

    -- O elo com a linha ANTERIOR. Na primeira linha da janela nao ha o que
    -- comparar: a cadeia comeca antes do recorte, e cobrar o elo aqui
    -- acusaria adulteracao em toda consulta que nao comecasse do zero.
    IF NOT v_first AND v_row.prev_hash IS DISTINCT FROM v_prev_hash THEN
      divergent_id := v_row.id;
      divergent_sequence := v_row.sequence;
      divergent_occurred_at := v_row.occurred_at;
      checked_count := v_count;
      RETURN NEXT;
      RETURN;
    END IF;

    -- Mesmo `concat_ws` do trigger. Divergir daqui e o defeito que este
    -- desenho existe para impedir.
    v_payload := concat_ws('|',
      v_row.sequence::TEXT,
      v_row.occurred_at::TEXT,
      v_row.actor_type::TEXT,
      COALESCE(v_row.actor_id, ''),
      v_row.action,
      v_row.outcome::TEXT,
      v_row.resource_type,
      COALESCE(v_row.resource_id, ''),
      COALESCE(v_row.before::TEXT, ''),
      COALESCE(v_row.after::TEXT, ''),
      COALESCE(v_row.request_id, '')
    );
    v_expected := digest(
      v_payload || COALESCE(encode(v_row.prev_hash, 'hex'), ''),
      'sha256'
    );

    IF v_expected IS DISTINCT FROM v_row.row_hash THEN
      divergent_id := v_row.id;
      divergent_sequence := v_row.sequence;
      divergent_occurred_at := v_row.occurred_at;
      checked_count := v_count;
      RETURN NEXT;
      RETURN;
    END IF;

    v_prev_hash := v_row.row_hash;
    v_first := FALSE;
  END LOOP;

  checked_count := v_count;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql STABLE;
