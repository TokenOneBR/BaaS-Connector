/**
 * Chaves de capacidade.
 *
 * Lista achatada de proposito: o guard de rota resolve `manifest[key].level`
 * em O(1) e devolve 501 antes de qualquer chamada de rede. Uma arvore
 * aninhada tornaria isso uma travessia.
 */
export const CAPABILITY_KEYS = [
  // contas
  'accounts.create.pf',
  'accounts.create.pj',
  'accounts.get',
  'accounts.list',
  'accounts.updateStatus',
  'accounts.close',
  // onboarding
  'onboarding.kyc.submit',
  'onboarding.kyb.submit',
  'onboarding.status.get',
  'onboarding.document.upload',
  'onboarding.requirements.list',
  'onboarding.requirements.fulfill',
  'onboarding.pld.screening',
  // saldo
  'balance.get',
  'balance.blocked',
  // chaves pix
  'pix.keys.create',
  'pix.keys.list',
  'pix.keys.delete',
  'pix.keys.claim',
  'pix.keys.resolve',
  // cobrancas
  'pix.charge.static.create',
  'pix.charge.dynamic.create',
  'pix.charge.dynamic.update',
  'pix.charge.get',
  'pix.charge.list',
  'pix.charge.cancel',
  // movimentacao
  'pix.in.receive',
  'pix.out.send',
  'pix.out.scheduled',
  'pix.transaction.get',
  'pix.refund.create',
  'pix.refund.get',
  // extrato
  'statement.list',
  'statement.export',
  // infraestrutura
  'webhooks.inbound',
  'webhooks.signature.verify',
  'reconciliation.statement.pull',
] as const;

export type CapabilityKey = (typeof CAPABILITY_KEYS)[number];

export enum SupportLevel {
  /** Nativo, primeira classe. */
  SUPPORTED = 'SUPPORTED',
  /** O kit ou o adapter sintetiza (ex.: polling no lugar de webhook). */
  EMULATED = 'EMULATED',
  /** Funciona com restricoes documentadas em `note`. */
  PARTIAL = 'PARTIAL',
  /** Devolve 501. */
  UNSUPPORTED = 'UNSUPPORTED',
}

/** Classes de operacao usadas para idempotencia e limites por provedor. */
export type OperationClass =
  | 'pix.out'
  | 'pix.refund'
  | 'accounts.create'
  | 'pix.keys.create'
  | 'pix.charge.create'
  | 'default';

export function isCapabilityKey(value: string): value is CapabilityKey {
  return (CAPABILITY_KEYS as readonly string[]).includes(value);
}
