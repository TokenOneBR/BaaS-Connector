import { createHmac } from 'node:crypto';

/**
 * Fixtures de webhook.
 *
 * A assinatura e CALCULADA aqui, e nao colada como constante, de proposito: um
 * hex fixo obrigaria a regravar a fixture a cada ajuste no corpo, e o atalho
 * inevitavel seria copiar o valor que o codigo produziu — o que faria o teste
 * concordar consigo mesmo em vez de com o esquema. Calcular a partir do
 * ALGORITMO DOCUMENTADO mantem a fixture independente da implementacao.
 */
const SECRET = 'segredo-de-conformidade';

/**
 * Instante da assinatura, calculado agora.
 *
 * A verificacao rejeita timestamp fora de +/- 300s do `receivedAt`, e o
 * `receivedAt` da suite e o relogio real. Um instante fixo na fixture faria o
 * teste passar no dia em que foi escrito e falhar em todos os outros — a
 * classe de teste que ninguem conserta, so deleta.
 */
const TIMESTAMP = Math.floor(Date.now() / 1000);

function sign(body: string, secret = SECRET, timestamp = TIMESTAMP): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

function envelope(id: string, type: string, data: Record<string, unknown>): string {
  // `occurredAt` em camelCase e a unica chave assim no wire do Mock Bank.
  return JSON.stringify({ id, type, occurredAt: '2026-08-28T12:00:00.000Z', data });
}

const accountActivated = envelope('mbevt_0000000001', 'account.status_changed', {
  account_id: 'conformance-account',
  // O evento carrega o enum INGLES, nao a forma portuguesa do REST.
  status: 'ACTIVE',
});

const pixSettled = envelope('mbevt_0000000002', 'pix_out.settled', {
  transaction_id: 'conformance-tx',
  account_id: 'conformance-account',
  direction: 'out',
  status: 'SETTLED',
  // No evento o valor vem em CENTAVOS; no REST vem em decimal.
  amount_cents: '15075',
  fee_cents: '0',
  end_to_end_id: 'E99999001202608281200ABCDEFGHIJK',
  created_at: '2026-08-28T11:59:00.000Z',
  settled_at: '2026-08-28T11:59:30.000Z',
});

export const webhooks = [
  {
    name: 'conta ativada',
    body: accountActivated,
    headers: {
      'x-mockbank-signature': `t=${TIMESTAMP},v1=${sign(accountActivated)}`,
      'x-mockbank-event-id': 'mbevt_0000000001',
      'x-mockbank-event-type': 'account.status_changed',
    },
    secret: SECRET,
    expectedEventTypes: ['account.status_changed'],
  },
  {
    name: 'pix out liquidado',
    body: pixSettled,
    headers: {
      'x-mockbank-signature': `t=${TIMESTAMP},v1=${sign(pixSettled)}`,
      'x-mockbank-event-id': 'mbevt_0000000002',
      'x-mockbank-event-type': 'pix_out.settled',
    },
    secret: SECRET,
    expectedEventTypes: ['pix_out.settled'],
  },
] as const;
