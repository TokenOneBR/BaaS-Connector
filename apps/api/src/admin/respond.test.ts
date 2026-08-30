import { zReconciliationBreak } from '@baasconn/contracts';
import { BreakSeverity, BreakStatus, BreakType, Environment } from '@baasconn/taxonomy';
import { describe, expect, it } from 'vitest';

import { respond } from './respond.js';

/**
 * `respond` so vale se ele REPROVAR a deriva.
 *
 * As duas direcoes abaixo nao sao hipoteticas: as duas existiam neste
 * repositorio quando este arquivo foi escrito. Um campo que o contrato declara
 * e o mapper esquece (`evidence`, que nunca saiu do banco) e um campo que o
 * mapper emite e o contrato nao conhece (`adjustment_transaction_id`). Nenhum
 * dos dois e pego por typecheck, porque o retorno de um handler Nest e
 * `unknown` na pratica.
 */
const quebraValida = () => ({
  id: 'brk_1',
  run_id: 'rec_1',
  first_seen_run_id: 'rec_1',
  connection_id: 'con_1',
  account_id: 'acc_1',
  type: BreakType.MISSING_ON_PROVIDER,
  severity: BreakSeverity.CRITICAL,
  status: BreakStatus.OPEN,
  environment: Environment.HOMOLOGACAO,
  amount: { amount: '50000', currency: 'BRL', scale: 2 },
  delta: null,
  effective_date: '2026-08-29',
  end_to_end_id: null,
  description: 'Debito registrado que o provedor nunca teve.',
  evidence: { provedor: null, local: { valor_cents: '50000' } },
  age_days: 0,
  assigned_to: null,
  resolution: null,
  resolution_note: null,
  resolved_by: null,
  resolved_at: null,
  adjustment_transaction_id: null,
  created_at: '2026-08-30T12:00:00.000Z',
});

describe('respond', () => {
  it('deixa passar o corpo que o contrato descreve', () => {
    expect(respond(zReconciliationBreak, quebraValida())).toMatchObject({ id: 'brk_1' });
  });

  it('REPROVA campo obrigatorio que o mapper esqueceu', () => {
    // Era exatamente o caso da `evidence`: coluna `Json NOT NULL`, contrato
    // exigindo, mapper nao copiando, e a tela lado a lado sem fonte de dados.
    const { evidence: _omitido, ...semEvidencia } = quebraValida();
    expect(() => respond(zReconciliationBreak, semEvidencia)).toThrow();
  });

  it('REMOVE campo que o contrato nao declara', () => {
    // O Zod remove chave desconhecida por padrao, entao um mapper que passe a
    // emitir um campo novo nao o vaza: ele so aparece depois de o contrato
    // declarar, que e onde a revisao acontece.
    const comExtra = { ...quebraValida(), segredo_interno: 'nao-deveria-vazar' };
    const saida = respond(zReconciliationBreak, comExtra) as Record<string, unknown>;

    expect(saida.segredo_interno).toBeUndefined();
    expect(saida.id).toBe('brk_1');
  });

  it('REPROVA tipo errado, e nao so campo ausente', () => {
    // `age_days` como string passaria despercebido ate o console tentar
    // ordenar por idade e comparar texto com numero.
    expect(() =>
      respond(zReconciliationBreak, { ...quebraValida(), age_days: 'trinta' }),
    ).toThrow();
  });
});
