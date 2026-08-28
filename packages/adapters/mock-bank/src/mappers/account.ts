import type { ProviderAccount, TaxIdInput } from '@baasconn/provider-spi';
import { AccountStatus, HolderType, TaxIdType } from '@baasconn/taxonomy';

import type { MbAccount, MbAccountSituacao } from '../dto/index.js';

/**
 * Vocabulario de status de conta: portugues no REST, ingles no webhook.
 *
 * Sim, o mesmo provedor usa os dois. A tabela e explicita e exaustiva porque a
 * alternativa — um `switch` com `default` otimista — transforma um status novo
 * do provedor em "ATIVA" silenciosamente, e uma conta bloqueada tratada como
 * ativa e uma transferencia que nao deveria sair.
 */
const SITUACAO_TO_STATUS: Readonly<Record<MbAccountSituacao, AccountStatus>> = Object.freeze({
  ATIVA: AccountStatus.ACTIVE,
  BLOQUEADA: AccountStatus.BLOCKED,
  SUSPENSA: AccountStatus.SUSPENDED,
  RECUSADA: AccountStatus.REJECTED,
  ENCERRADA: AccountStatus.CLOSED,
  EM_ENCERRAMENTO: AccountStatus.CLOSING,
  EM_ANALISE: AccountStatus.UNDER_REVIEW,
});

export function toAccountStatus(situacao: string): AccountStatus {
  const mapped = SITUACAO_TO_STATUS[situacao as MbAccountSituacao];
  if (!mapped) {
    // Nao adivinhamos. Um status desconhecido vira UNDER_REVIEW, que e o
    // estado que segura movimentacao ate alguem olhar.
    return AccountStatus.UNDER_REVIEW;
  }
  return mapped;
}

/**
 * O webhook `account.status_changed` carrega o enum INGLES, nao a forma
 * portuguesa do REST. Aceitamos os dois vocabularios.
 */
export function toAccountStatusFromEvent(status: string): AccountStatus {
  if (status in AccountStatus) return AccountStatus[status as keyof typeof AccountStatus];
  return toAccountStatus(status);
}

export function toHolderType(tipoPessoa: string): HolderType {
  return tipoPessoa === 'PJ' ? HolderType.BUSINESS : HolderType.INDIVIDUAL;
}

export function taxIdOf(documento: string): TaxIdInput {
  const digits = documento.replace(/\D/g, '');
  return { type: digits.length === 14 ? TaxIdType.CNPJ : TaxIdType.CPF, value: digits };
}

export function toProviderAccount(account: MbAccount): ProviderAccount {
  return {
    providerAccountId: account.id,
    status: toAccountStatus(account.situacao),
    personType: toHolderType(account.tipo_pessoa),
    bank: {
      ispb: account.ispb,
      branch: account.agencia,
      number: account.conta,
      checkDigit: account.conta_digito,
    },
    openedAt: account.aberto_em ?? undefined,
    raw: account,
  };
}
