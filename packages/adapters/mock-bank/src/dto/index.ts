/**
 * Tipos do wire do Mock Bank.
 *
 * Deliberadamente separados do canonico: sao a forma que o provedor devolve, e
 * o unico lugar do adapter onde `situacao`, `valor` e `documento` aparecem com
 * esses nomes. Tudo depois disso fala canonico.
 */

export interface MbToken {
  access_token: string;
  token_type: string;
  expires_in: number;
}

/** `situacao` de conta vem em portugues. Transacao e cobranca vem em ingles. */
export type MbAccountSituacao =
  'ATIVA' | 'BLOQUEADA' | 'SUSPENSA' | 'RECUSADA' | 'ENCERRADA' | 'EM_ENCERRAMENTO' | 'EM_ANALISE';

export interface MbAccount {
  id: string;
  tipo_pessoa: 'PF' | 'PJ';
  documento: string;
  nome: string;
  email: string;
  situacao: MbAccountSituacao;
  agencia: string;
  conta: string;
  conta_digito: string;
  ispb: string;
  id_externo: string | null;
  criado_em: string;
  aberto_em: string | null;
}

export interface MbBalance {
  /** Decimal string. No webhook o mesmo valor vem em centavos. */
  saldo_disponivel: string;
  saldo_bloqueado: string;
  saldo_a_liberar: string;
  moeda: string;
  consultado_em: string;
}

export interface MbOnboarding {
  id: string;
  conta_id: string;
  tipo: 'KYC' | 'KYB';
  situacao: string;
  pendencias: Array<{ codigo: string; situacao: string }>;
  verificacoes: Array<{ tipo: string; resultado: string }>;
  motivo_recusa: string | null;
  mensagem_recusa: string | null;
  atualizado_em: string;
}

export interface MbDocumentReceipt {
  documento_id: string;
  codigo: string;
  situacao: string;
  sha256: string;
  tamanho_bytes: number;
  onboarding: MbOnboarding;
}

export interface MbPixKey {
  id: string;
  tipo: string;
  chave: string;
  situacao: string;
  criada_em: string;
}

export interface MbDictEntry {
  chave: string;
  tipo: string;
  nome_titular: string;
  documento_titular: string;
  ispb: string;
  agencia: string;
  conta: string;
  consultado_em: string;
}

export interface MbCharge {
  txid: string;
  tipo: 'ESTATICA' | 'DINAMICA';
  situacao: string;
  valor: string | null;
  chave: string;
  emv: string;
  expira_em: string | null;
  valor_pago: string;
  pago_em: string | null;
  revisao: number;
  criada_em: string;
}

/** Contraparte tem chaves em camelCase dentro de um envelope snake_case. */
export interface MbCounterparty {
  name?: string;
  taxId?: string;
  ispb?: string;
  branch?: string;
  accountNumber?: string;
  pixKey?: string;
}

export interface MbPayment {
  id: string;
  conta_id: string;
  tipo: 'CREDITO' | 'DEBITO';
  situacao: string;
  valor: string;
  tarifa: string;
  end_to_end_id: string | null;
  id_devolucao: string | null;
  end_to_end_id_original?: string | null;
  txid: string | null;
  contraparte: MbCounterparty | null;
  descricao: string | null;
  data_movimento: string;
  data_liquidacao: string | null;
}

export interface MbList<T> {
  dados: T[];
}

/** Uma linha de extrato. Um pagamento com tarifa produz DUAS. */
export interface MbStatementLine extends MbPayment {
  categoria: 'PAGAMENTO' | 'TARIFA' | 'DEVOLUCAO';
}

export interface MbStatementPage {
  dados: MbStatementLine[];
  /** Saldos da JANELA, repetidos em toda pagina. Decimal string. */
  saldo_inicial: string;
  saldo_final: string;
  moeda: string;
  proximo_cursor: string | null;
  tem_mais: boolean;
}

export interface MbEnvelope<T> {
  dados: T | null;
}

export interface MbError {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

/** Envelope de webhook. `occurredAt` e a unica chave camelCase do wire. */
export interface MbWebhookEnvelope {
  id: string;
  type: string;
  occurredAt: string;
  data: Record<string, unknown>;
}

/** Nos eventos os valores vem em CENTAVOS como string, nao em decimal. */
export interface MbPaymentEvent {
  transaction_id: string;
  account_id: string;
  direction: 'in' | 'out';
  status: string;
  amount_cents: string;
  fee_cents: string;
  end_to_end_id?: string;
  return_id?: string;
  txid?: string;
  counterparty?: MbCounterparty;
  created_at: string;
  settled_at?: string;
}
