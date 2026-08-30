import type {
  zAccount,
  zBalance,
  zCreateAccount,
  zCreateCharge,
  zCreatePixKey,
  zCreateRefund,
  zOnboardingCase,
  zOperation,
  zPixCharge,
  zPixKey,
  zPixKeyResolution,
  zSendPix,
  zStatementEntry,
  zTransaction,
} from '@baasconn/contracts';
import type { z } from 'zod';

import type { BaasClient, RequestOptions } from './client.js';
import { BaasOutcomeUnknown } from './errors.js';

type Account = z.infer<typeof zAccount>;
type Balance = z.infer<typeof zBalance>;
type CreateAccount = z.infer<typeof zCreateAccount>;
type CreateCharge = z.infer<typeof zCreateCharge>;
type CreatePixKey = z.infer<typeof zCreatePixKey>;
type CreateRefund = z.infer<typeof zCreateRefund>;
type OnboardingCase = z.infer<typeof zOnboardingCase>;
type Operation = z.infer<typeof zOperation>;
type PixCharge = z.infer<typeof zPixCharge>;
type PixKey = z.infer<typeof zPixKey>;
type PixKeyResolution = z.infer<typeof zPixKeyResolution>;
type SendPix = z.infer<typeof zSendPix>;
type StatementEntry = z.infer<typeof zStatementEntry>;
type Transaction = z.infer<typeof zTransaction>;

/**
 * Pagina por cursor.
 *
 * Sem `total`, e a ausencia e honesta: computar o total de uma lista servida
 * pelo provedor e impossivel ou caro, e um numero aproximado num extrato
 * financeiro e pior que numero nenhum.
 */
export interface Page<T> {
  object: 'list';
  data: T[];
  page: { has_more: boolean; next_cursor: string | null; limit: number };
}

/**
 * Tipos inferidos dos MESMOS schemas Zod que a API usa para validar.
 *
 * Nao ha um segundo conjunto de interfaces escrito a mao. Uma mudanca em
 * `@baasconn/contracts` que quebre o cliente vira erro de compilacao aqui, e
 * nao uma surpresa em runtime de quem integra.
 */
export class Accounts {
  constructor(private readonly http: BaasClient) {}

  async create(input: CreateAccount, options?: RequestOptions): Promise<Account> {
    return (await this.http.request<Account>('POST', '/v1/accounts', input, options)).data;
  }

  async get(id: string, options?: RequestOptions): Promise<Account> {
    return (await this.http.request<Account>('GET', `/v1/accounts/${id}`, undefined, options)).data;
  }

  async list(query?: RequestOptions['query'], options?: RequestOptions): Promise<Page<Account>> {
    return (
      await this.http.request<Page<Account>>('GET', '/v1/accounts', undefined, {
        ...options,
        query,
      })
    ).data;
  }

  async block(id: string, reason: string, options?: RequestOptions): Promise<Account> {
    return (
      await this.http.request<Account>('POST', `/v1/accounts/${id}/block`, { reason }, options)
    ).data;
  }

  async unblock(id: string, reason: string, options?: RequestOptions): Promise<Account> {
    return (
      await this.http.request<Account>('POST', `/v1/accounts/${id}/unblock`, { reason }, options)
    ).data;
  }

  /**
   * Saldo, com a FRESCURA sempre declarada.
   *
   * `_meta.freshness` nao e opcional no contrato, e por isso o SDK nao o
   * esconde: o padrao serve do cache quando ele tem menos de 30s, e um
   * cliente que decide sobre saldo precisa saber se esta olhando um numero de
   * agora ou de meio minuto atras. `consistency: 'strong'` forca a ida ao
   * provedor.
   */
  async balance(
    id: string,
    query?: { consistency?: 'strong' | 'cached'; source?: 'provider' | 'ledger' },
    options?: RequestOptions,
  ): Promise<Balance> {
    return (
      await this.http.request<Balance>('GET', `/v1/accounts/${id}/balance`, undefined, {
        ...options,
        query,
      })
    ).data;
  }

  async statement(
    id: string,
    query?: RequestOptions['query'],
    options?: RequestOptions,
  ): Promise<Page<StatementEntry>> {
    return (
      await this.http.request<Page<StatementEntry>>(
        'GET',
        `/v1/accounts/${id}/statement`,
        undefined,
        { ...options, query },
      )
    ).data;
  }

  async onboarding(id: string, options?: RequestOptions): Promise<OnboardingCase> {
    return (
      await this.http.request<OnboardingCase>(
        'GET',
        `/v1/accounts/${id}/onboarding`,
        undefined,
        options,
      )
    ).data;
  }
}

export class PixKeys {
  constructor(private readonly http: BaasClient) {}

  async create(accountId: string, input: CreatePixKey, options?: RequestOptions): Promise<PixKey> {
    return (
      await this.http.request<PixKey>('POST', `/v1/accounts/${accountId}/pix/keys`, input, options)
    ).data;
  }

  async list(accountId: string, options?: RequestOptions): Promise<Page<PixKey>> {
    return (
      await this.http.request<Page<PixKey>>(
        'GET',
        `/v1/accounts/${accountId}/pix/keys`,
        undefined,
        options,
      )
    ).data;
  }

  async remove(accountId: string, keyId: string, options?: RequestOptions): Promise<void> {
    await this.http.request<void>(
      'DELETE',
      `/v1/accounts/${accountId}/pix/keys/${keyId}`,
      undefined,
      options,
    );
  }

  /** Consulta o DICT. */
  async resolve(
    accountId: string,
    key: string,
    options?: RequestOptions,
  ): Promise<PixKeyResolution> {
    return (
      await this.http.request<PixKeyResolution>(
        'GET',
        `/v1/accounts/${accountId}/pix/keys/resolve`,
        undefined,
        { ...options, query: { key } },
      )
    ).data;
  }
}

export class PixCharges {
  constructor(private readonly http: BaasClient) {}

  async create(
    accountId: string,
    input: CreateCharge,
    options?: RequestOptions,
  ): Promise<PixCharge> {
    return (
      await this.http.request<PixCharge>(
        'POST',
        `/v1/accounts/${accountId}/pix/charges`,
        input,
        options,
      )
    ).data;
  }

  async get(accountId: string, txid: string, options?: RequestOptions): Promise<PixCharge> {
    return (
      await this.http.request<PixCharge>(
        'GET',
        `/v1/accounts/${accountId}/pix/charges/${txid}`,
        undefined,
        options,
      )
    ).data;
  }

  async list(
    accountId: string,
    query?: RequestOptions['query'],
    options?: RequestOptions,
  ): Promise<Page<PixCharge>> {
    return (
      await this.http.request<Page<PixCharge>>(
        'GET',
        `/v1/accounts/${accountId}/pix/charges`,
        undefined,
        {
          ...options,
          query,
        },
      )
    ).data;
  }

  async cancel(accountId: string, txid: string, options?: RequestOptions): Promise<PixCharge> {
    return (
      await this.http.request<PixCharge>(
        'POST',
        `/v1/accounts/${accountId}/pix/charges/${txid}/cancel`,
        {},
        options,
      )
    ).data;
  }
}

export class PixTransfers {
  constructor(private readonly http: BaasClient) {}

  /**
   * Envia um PIX.
   *
   * Devolve a transacao quando a API responde 201. Quando responde **202**, o
   * desfecho e DESCONHECIDO — a API mandou ao provedor e nao sabe se o
   * dinheiro se moveu — e o SDK lanca `BaasOutcomeUnknown` com o
   * `operation_id`.
   *
   * Nao e um erro disfarcado de sucesso nem o contrario: e um terceiro
   * desfecho, e ele existe no tipo justamente para que quem integra nao possa
   * trata-lo como falha e reenviar. `operations.get()` resolve; reenviar paga
   * duas vezes.
   */
  async send(accountId: string, input: SendPix, options?: RequestOptions): Promise<Transaction> {
    const resposta = await this.http.request<Transaction & { operation_id?: string }>(
      'POST',
      `/v1/accounts/${accountId}/pix/transfers`,
      input,
      options,
    );

    if (resposta.status === 202) {
      throw new BaasOutcomeUnknown(resposta.data.operation_id ?? 'desconhecido');
    }
    return resposta.data;
  }

  async refund(
    accountId: string,
    input: CreateRefund,
    options?: RequestOptions,
  ): Promise<Transaction> {
    const resposta = await this.http.request<Transaction & { operation_id?: string }>(
      'POST',
      `/v1/accounts/${accountId}/pix/refunds`,
      input,
      options,
    );

    if (resposta.status === 202) {
      throw new BaasOutcomeUnknown(resposta.data.operation_id ?? 'desconhecido');
    }
    return resposta.data;
  }
}

export class Transactions {
  constructor(private readonly http: BaasClient) {}

  async get(id: string, options?: RequestOptions): Promise<Transaction> {
    return (
      await this.http.request<Transaction>('GET', `/v1/transactions/${id}`, undefined, options)
    ).data;
  }

  async list(
    query?: RequestOptions['query'],
    options?: RequestOptions,
  ): Promise<Page<Transaction>> {
    return (
      await this.http.request<Page<Transaction>>('GET', '/v1/transactions', undefined, {
        ...options,
        query,
      })
    ).data;
  }
}

export class Operations {
  constructor(private readonly http: BaasClient) {}

  /** Estado de uma operacao assincrona ou em `UNKNOWN`. */
  async get(id: string, options?: RequestOptions): Promise<Operation> {
    return (await this.http.request<Operation>('GET', `/v1/operations/${id}`, undefined, options))
      .data;
  }

  /**
   * Pede ao servidor que consulte o provedor AGORA.
   *
   * Tenta, em ordem: busca pela chave de idempotencia, consulta pelo E2EID, e
   * varredura do extrato casando valor e destino. NUNCA reenvia — nem esta
   * rota nem nenhuma outra do produto.
   */
  async reconcile(id: string, options?: RequestOptions): Promise<Operation> {
    return (
      await this.http.request<Operation>('POST', `/v1/operations/${id}/reconcile`, {}, options)
    ).data;
  }
}
