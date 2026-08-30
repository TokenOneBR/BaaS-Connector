import { defineManifest } from '@baasconn/provider-spi';
import { SupportLevel } from '@baasconn/taxonomy';

/**
 * O que o Mock Bank REALMENTE oferece.
 *
 * Tudo que nao aparece aqui vira UNSUPPORTED automaticamente e o conector
 * devolve 501 com esta nota ANTES de qualquer chamada de rede. Declarar de
 * menos e facil de corrigir; declarar de mais produz erro opaco em producao —
 * e a suite de conformidade cobra: `SUPPORTED` que lanca `NotImplemented`
 * reprova, e `PARTIAL`/`EMULATED` sem nota tambem.
 */
export const mockbankManifest = defineManifest({
  'accounts.create.pf': { level: SupportLevel.SUPPORTED },
  'accounts.create.pj': { level: SupportLevel.SUPPORTED },
  'accounts.get': { level: SupportLevel.SUPPORTED },
  'accounts.list': {
    level: SupportLevel.PARTIAL,
    note: 'Devolve todas as contas do cliente de uma vez, sem cursor. hasMore e sempre false.',
  },
  'accounts.updateStatus': { level: SupportLevel.SUPPORTED },
  'accounts.close': { level: SupportLevel.SUPPORTED },

  'onboarding.kyc.submit': {
    level: SupportLevel.EMULATED,
    note:
      'O caso e criado implicitamente na abertura da conta; nao ha rota de submissao. ' +
      'A chamada le o caso existente em vez de criar um.',
  },
  'onboarding.kyb.submit': {
    level: SupportLevel.EMULATED,
    note:
      'O caso e criado implicitamente na abertura da conta; nao ha rota de submissao. ' +
      'A chamada le o caso existente em vez de criar um.',
  },
  'onboarding.status.get': { level: SupportLevel.SUPPORTED },
  'onboarding.requirements.list': { level: SupportLevel.SUPPORTED },
  'onboarding.document.upload': {
    level: SupportLevel.SUPPORTED,
    constraints: { requiredFields: ['sha256'] },
  },
  'onboarding.requirements.fulfill': {
    level: SupportLevel.EMULATED,
    note:
      'A pendencia e cumprida pelo envio do documento; nao ha rota dedicada. ' +
      'A chamada apenas rele o caso.',
  },

  'balance.get': { level: SupportLevel.SUPPORTED },
  'balance.blocked': { level: SupportLevel.SUPPORTED },

  'pix.keys.create': {
    level: SupportLevel.SUPPORTED,
    constraints: { allowedPixKeyTypes: ['CPF', 'CNPJ', 'EMAIL', 'PHONE', 'EVP'] },
  },
  'pix.keys.list': { level: SupportLevel.SUPPORTED },
  'pix.keys.delete': { level: SupportLevel.SUPPORTED },
  'pix.keys.resolve': { level: SupportLevel.SUPPORTED },

  'pix.charge.static.create': { level: SupportLevel.SUPPORTED },
  'pix.charge.dynamic.create': {
    level: SupportLevel.SUPPORTED,
    constraints: { maxExpirySeconds: 86_400 },
  },
  'pix.charge.get': { level: SupportLevel.SUPPORTED },
  'pix.charge.list': {
    level: SupportLevel.PARTIAL,
    note: 'Sem cursor e sem filtro de periodo: devolve todas as cobrancas da conta.',
  },
  'pix.charge.cancel': { level: SupportLevel.SUPPORTED },

  'pix.in.receive': { level: SupportLevel.SUPPORTED },
  'pix.out.send': {
    level: SupportLevel.SUPPORTED,
    note:
      'Aceita destino por chave PIX ou por dados bancarios. Copia e cola precisa ser ' +
      'parseado antes; o Mock Bank nao recebe EMV no envio.',
    constraints: {
      // Limite diario do Mock Bank; entre 20h e 6h ele cai para R$ 1.000.
      maxAmount: { amount: '2000000', currency: 'BRL', scale: 2 },
    },
  },
  'pix.transaction.get': { level: SupportLevel.SUPPORTED },
  'pix.refund.create': {
    level: SupportLevel.SUPPORTED,
    constraints: { requiredFields: ['originalEndToEndId'] },
  },
  'pix.refund.get': { level: SupportLevel.SUPPORTED },

  'statement.list': {
    level: SupportLevel.SUPPORTED,
    note: 'Cursor de keyset por (liquidacao, id). Devolve saldo de abertura e de fechamento.',
  },
  'reconciliation.statement.pull': {
    level: SupportLevel.SUPPORTED,
    note: 'Mesma rota de extrato, com os saldos que fecham o passe de conferencia de saldo.',
  },

  'webhooks.inbound': { level: SupportLevel.SUPPORTED },
  'webhooks.signature.verify': {
    level: SupportLevel.SUPPORTED,
    note: 'HMAC-SHA256 sobre "<timestamp>.<corpo cru>", no esquema da Stripe.',
  },
});
