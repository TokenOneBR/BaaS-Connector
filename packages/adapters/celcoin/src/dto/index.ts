/**
 * Formas de wire da Celcoin.
 *
 * Escritas a partir da documentacao publica em developers.celcoin.com.br.
 * NAO foram gravadas contra sandbox — o relatorio de conformidade publica essa
 * diferenca por meio do `source: 'handcrafted-from-docs'` das fixtures, e a
 * distincao existe justamente para ninguem confundir fixture escrita a mao com
 * comportamento verificado.
 *
 * Campos em camelCase e valores monetarios em NUMERO JSON, que sao as duas
 * caracteristicas do wire da Celcoin que mais surpreendem quem vem de outro
 * BaaS brasileiro. Ver `mappers/money.ts` para por que o numero nunca chega ao
 * dominio como `number`.
 */

export interface CcToken {
  access_token: string;
  token_type: string;
  expires_in: number;
}

/** Envelope padrao: `status` textual mais o corpo em `body`. */
export interface CcEnvelope<T> {
  version?: string;
  status: string;
  body: T;
}

export interface CcError {
  status?: string;
  error?: { errorCode?: string; message?: string };
  errorCode?: string;
  message?: string;
}

export interface CcAccount {
  clientCode: string;
  account?: string;
  branch?: string;
  documentNumber: string;
  status: string;
  createdAt?: string;
  proposalId?: string;
}

export interface CcProposal {
  proposalId: string;
  clientCode: string;
  status: string;
  documentNumber?: string;
  createdAt?: string;
  reason?: string;
  reasonCode?: string;
  pendingDocuments?: string[];
}

export interface CcBalance {
  amount: number;
  blockedAmount?: number;
  scheduledAmount?: number;
  currency?: string;
  updatedAt?: string;
}

export interface CcDictEntry {
  key: string;
  keyType: string;
  account?: {
    participant?: string;
    branch?: string;
    account?: string;
    accountType?: string;
    createDate?: string;
  };
  owner?: { type?: string; name?: string; taxId?: string; documentNumber?: string };
  createdAt?: string;
  status?: string;
}

export interface CcPixPayment {
  id?: string;
  transactionId?: string | number;
  endToEndId?: string;
  clientCode?: string;
  amount?: number;
  status: string;
  createDate?: string;
  lastUpdate?: string;
  error?: { errorCode?: string; message?: string };
  debitParty?: CcParty;
  creditParty?: CcParty;
}

export interface CcParty {
  account?: string;
  branch?: string;
  taxId?: string;
  name?: string;
  bank?: string;
  accountType?: string;
  key?: string;
}

export interface CcBrCode {
  transactionId?: string | number;
  transactionIdentification?: string;
  emvqrcps?: string;
  locationId?: string | number;
  amount?: number;
  status?: string;
  createDate?: string;
  expirationDate?: string;
}
