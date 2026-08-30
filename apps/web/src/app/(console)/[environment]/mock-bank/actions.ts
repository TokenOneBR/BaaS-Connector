'use server';

import { defineAction } from '@/server/actions';
import { mockBank } from '@/server/mock-bank';

const CAMINHO = '/[environment]/mock-bank';

export const injetarPixIn = defineAction(
  async (form) =>
    mockBank.post('/pix/inbound', {
      account_id: String(form.get('account_id') || '') || undefined,
      pix_key: String(form.get('pix_key') || '') || undefined,
      // Decimal em string, que e o formato da REST do Mock Bank. Converter
      // para centavos aqui e no servidor dele criaria dois arredondamentos.
      amount: String(form.get('amount')),
      payer_name: String(form.get('payer_name') || '') || undefined,
    }),
  { revalidate: CAMINHO },
);

export const decidirOnboarding = defineAction(
  async (form) =>
    mockBank.post('/onboarding/decide', {
      onboarding_id: String(form.get('onboarding_id')),
      decision: String(form.get('decision')),
      reason: String(form.get('reason') || '') || undefined,
    }),
  { revalidate: CAMINHO },
);

export const configurarFalhas = defineAction(
  async (form) =>
    mockBank.post('/faults', {
      latency_ms: Number(form.get('latency_ms') ?? 0),
      error_rate: Number(form.get('error_rate') ?? 0),
      // String vazia significa "sem status forcado". `null` e o valor que o
      // Mock Bank interpreta como limpar; `undefined` manteria o atual, e a
      // diferenca e o que faz o campo conseguir ser DESLIGADO pelo formulario.
      force_status: form.get('force_status') ? Number(form.get('force_status')) : null,
      duplicate_webhooks: form.get('duplicate_webhooks') === 'on',
      reorder_webhooks: form.get('reorder_webhooks') === 'on',
      invalid_signature: form.get('invalid_signature') === 'on',
    }),
  { revalidate: CAMINHO },
);

export const limparFalhas = defineAction(async () => mockBank.post('/faults/clear'), {
  revalidate: CAMINHO,
});

export const avancarRelogio = defineAction(
  async (form) =>
    mockBank.post('/clock/advance', {
      seconds: Number(form.get('seconds') ?? 0),
      days: Number(form.get('days') ?? 0),
    }),
  { revalidate: CAMINHO },
);

export const resetarRelogio = defineAction(async () => mockBank.post('/clock/reset'), {
  revalidate: CAMINHO,
});

/**
 * Zera o Mock Bank inteiro.
 *
 * Destrutivo e sem volta: apaga contas, pagamentos, razao e tokens. O
 * formulario exige digitar `RESETAR` — nao por cerimonia, mas porque esta e a
 * unica acao da tela que um clique errado torna impossivel de desfazer.
 */
export const resetarTudo = defineAction(
  async (form) => {
    if (String(form.get('confirmacao')) !== 'RESETAR') {
      throw new Error('Digite RESETAR para confirmar.');
    }
    return mockBank.post('/reset');
  },
  { revalidate: CAMINHO },
);
