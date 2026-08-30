import { defineManifest } from '@baasconn/provider-spi';
import { SupportLevel } from '@baasconn/taxonomy';

/**
 * Manifesto da Woovi.
 *
 * A Woovi e um PSP de recebimento: o produto dela e a cobranca PIX, nao a
 * conta. Nao ha abertura de conta, nao ha onboarding de titular, nao ha PIX
 * out por chave. Declarar essas capacidades por simetria com os outros
 * adapters seria a forma mais rapida de tornar a matriz inutil.
 *
 * Fixtures `handcrafted-from-docs`. Ver `docs/providers/woovi.md`.
 */
export const wooviManifest = defineManifest({
  'pix.charge.dynamic.create': {
    level: SupportLevel.SUPPORTED,
    docRef: 'https://developers.woovi.com/en/docs/charge/how-to-create-charge-using-api',
    constraints: { minAmount: { amount: '1', currency: 'BRL', scale: 2 } },
  },
  'pix.charge.get': { level: SupportLevel.SUPPORTED },
  'pix.charge.list': { level: SupportLevel.SUPPORTED },

  // `webhooks.inbound` fica de FORA, e a suite de conformidade e quem cobrou
  // isso: declarei sem implementar a faceta e o grupo 1 reprovou na hora. A
  // Woovi entrega webhook sem assinatura por padrao — a verificacao depende de
  // um HMAC configurado no painel, cujo esquema nao esta na documentacao
  // publica. Declarar `webhooks.signature.verify` sem saber o esquema seria
  // prometer uma verificacao que nao acontece, que e pior do que nao ter.
});
