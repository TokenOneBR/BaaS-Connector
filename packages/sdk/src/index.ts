import { BaasClient, type BaasClientOptions } from './client.js';
import {
  Accounts,
  Operations,
  PixCharges,
  PixKeys,
  PixTransfers,
  Transactions,
} from './resources.js';

export { BaasApiError, BaasOutcomeUnknown, BaasTransportError } from './errors.js';
export type { BaasApiErrorBody } from './errors.js';
export type { BaasClientOptions, RequestOptions } from './client.js';
export type { Page } from './resources.js';

/**
 * Verificador de assinatura de webhook, reexportado de `@baasconn/crypto`.
 *
 * Quem recebe nossos eventos precisa verifica-los, e obrigar essa pessoa a
 * instalar um segundo pacote para isso seria obriga-la a nao verificar. E o
 * mesmo codigo que assina do lado do servidor — nao uma reimplementacao, que
 * divergiria na primeira mudanca de formato.
 */
export {
  parseSignatureHeader,
  verifyWebhookSignature,
  type SignatureFailure,
  type VerifyWebhookSignatureInput,
} from '@baasconn/crypto';

/**
 * Cliente do BaaS Connector.
 *
 * ```ts
 * const baas = new BaasConnector({
 *   baseUrl: 'https://api.example.com',
 *   apiKey: process.env.BAAS_API_KEY!,
 *   signingSecret: process.env.BAAS_SIGNING_SECRET,
 * });
 *
 * const conta = await baas.accounts.create({ ... });
 * const saldo = await baas.accounts.balance(conta.id, { consistency: 'strong' });
 * ```
 *
 * O AMBIENTE vem da chave (`bck_hml_` ou `bck_prd_`), nunca de um parametro:
 * uma opcao `environment` no construtor estaria a um typo de uma
 * transferencia PIX real.
 */
export class BaasConnector {
  readonly http: BaasClient;
  readonly accounts: Accounts;
  readonly pixKeys: PixKeys;
  readonly pixCharges: PixCharges;
  readonly pixTransfers: PixTransfers;
  readonly transactions: Transactions;
  readonly operations: Operations;

  constructor(options: BaasClientOptions) {
    this.http = new BaasClient(options);
    this.accounts = new Accounts(this.http);
    this.pixKeys = new PixKeys(this.http);
    this.pixCharges = new PixCharges(this.http);
    this.pixTransfers = new PixTransfers(this.http);
    this.transactions = new Transactions(this.http);
    this.operations = new Operations(this.http);
  }

  /** `HOMOLOGACAO` ou `PRODUCAO`, derivado do prefixo da chave. */
  get environment(): 'HOMOLOGACAO' | 'PRODUCAO' | 'UNKNOWN' {
    return this.http.environment;
  }
}

export { BaasClient };
