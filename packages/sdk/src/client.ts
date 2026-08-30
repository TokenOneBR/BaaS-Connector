import { randomUUID } from 'node:crypto';

import { buildSignature, generateNonce } from '@baasconn/crypto';

import { BaasApiError, BaasTransportError, type BaasApiErrorBody } from './errors.js';

/** Rotas que a API exige assinadas quando a chave e de producao. */
const ROTAS_ASSINADAS = /\/pix\/(transfers|refunds)$/;

export interface BaasClientOptions {
  baseUrl: string;
  /**
   * `bck_hml_<keyId>_<secret>` ou `bck_prd_<keyId>_<secret>`.
   *
   * O AMBIENTE vem da propria chave, e nao de um parametro: uma opcao
   * `environment` no construtor estaria a um typo de uma transferencia PIX
   * real. Amarrar ao segredo torna o erro catastrofico estruturalmente
   * impossivel — e e o que Stripe, Asaas e Woovi ja fazem, entao o dev
   * brasileiro nao precisa aprender nada novo.
   */
  apiKey: string;
  /**
   * Segredo de assinatura HMAC. Obrigatorio para rotas de dinheiro com chave
   * de PRODUCAO; a API recusa `signing_required: false` nesse caso.
   */
  signingSecret?: string;
  /** Total por requisicao. Padrao 30s, alinhado ao da API. */
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
  /** Injetavel para teste; `Date.now` em producao. */
  now?: () => number;
}

export interface RequestOptions {
  /**
   * Chave de idempotencia do CLIENTE.
   *
   * Obrigatoria em transferencia e devolucao. Nao e a chave que mandamos ao
   * provedor — o conector cunha um `operationId` proprio para isso, e confundir
   * as duas quebra assim que um cliente repete a chave depois de um 500 que
   * aconteceu DEPOIS de o provedor ter aceitado o pagamento.
   *
   * Quando ausente numa rota que exige, o SDK gera uma. Gerar e melhor que
   * omitir: sem chave, um retry de rede vira um segundo pagamento.
   */
  idempotencyKey?: string;
  query?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
}

interface Resposta<T> {
  data: T;
  status: number;
  requestId?: string;
  /** `true` quando a API respondeu do registro de idempotencia. */
  replayed: boolean;
}

/**
 * Cliente HTTP do `/v1`.
 *
 * Sem retry automatico, e a ausencia e deliberada. O kit do servidor so
 * retenta quando a falha e PROVADAMENTE pre-commit; um cliente nao tem como
 * saber isso, e um retry cego num `POST /pix/transfers` e o caminho mais curto
 * para o pagamento duplicado. `BaasApiError.safeToRetry` e
 * `BaasTransportError` dizem quando repetir e seguro — a decisao fica com
 * quem integra, com a informacao na mao.
 */
export class BaasClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private readonly now: () => number;

  constructor(private readonly options: BaasClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.now = options.now ?? Date.now;
  }

  /** `HOMOLOGACAO` ou `PRODUCAO`, lido do prefixo da chave. */
  get environment(): 'HOMOLOGACAO' | 'PRODUCAO' | 'UNKNOWN' {
    if (this.options.apiKey.startsWith('bck_prd_')) return 'PRODUCAO';
    if (this.options.apiKey.startsWith('bck_hml_')) return 'HOMOLOGACAO';
    return 'UNKNOWN';
  }

  async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
    options: RequestOptions = {},
  ): Promise<Resposta<T>> {
    const caminho = this.comQuery(path, options.query);
    const corpo = body === undefined ? '' : JSON.stringify(body);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.options.apiKey}`,
      Accept: 'application/json',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const exigeIdempotencia =
      method === 'POST' && /\/pix\/(transfers|refunds)$|\/accounts$/.test(path);
    if (options.idempotencyKey ?? exigeIdempotencia) {
      headers['Idempotency-Key'] = options.idempotencyKey ?? randomUUID();
    }

    if (this.options.signingSecret && ROTAS_ASSINADAS.test(path)) {
      // O caminho assinado inclui a QUERY: sem ela, a assinatura de
      // `?amount=1` valeria em `?amount=1000000`.
      const timestamp = String(Math.floor(this.now() / 1000));
      const nonce = generateNonce();
      headers['X-Baas-Timestamp'] = timestamp;
      headers['X-Baas-Nonce'] = nonce;
      headers['X-Baas-Signature'] = buildSignature(this.options.signingSecret, {
        method,
        path: caminho,
        rawBody: corpo,
        timestamp,
        nonce,
      });
    }

    const controller = new AbortController();
    const prazo = setTimeout(() => controller.abort(), this.timeoutMs);
    // O sinal de quem chama tambem aborta: um servidor que nos deu 15s nunca
    // deveria ficar preso numa chamada de 30s.
    options.signal?.addEventListener('abort', () => controller.abort(), { once: true });

    let resposta: Response;
    try {
      resposta = await this.fetchImpl(`${this.baseUrl}${caminho}`, {
        method,
        headers,
        body: body === undefined ? undefined : corpo,
        signal: controller.signal,
      });
    } catch (erro) {
      throw new BaasTransportError(
        `Falha de transporte em ${method} ${caminho}: ${erro instanceof Error ? erro.message : String(erro)}`,
        erro,
      );
    } finally {
      clearTimeout(prazo);
    }

    const requestId = resposta.headers.get('x-request-id') ?? undefined;
    if (resposta.status === 204) {
      return { data: undefined as T, status: 204, requestId, replayed: false };
    }

    const texto = await resposta.text();
    const json: unknown = texto ? JSON.parse(texto) : undefined;

    if (!resposta.ok) {
      const erro = (json as { error?: BaasApiErrorBody } | undefined)?.error;
      throw new BaasApiError(
        resposta.status,
        erro ?? { code: 'UNKNOWN', message: `HTTP ${resposta.status}`, request_id: requestId },
      );
    }

    return {
      data: json as T,
      status: resposta.status,
      requestId,
      replayed: resposta.headers.get('idempotency-replayed') === 'true',
    };
  }

  private comQuery(path: string, query?: RequestOptions['query']): string {
    if (!query) return path;
    const params = new URLSearchParams();
    for (const [chave, valor] of Object.entries(query)) {
      if (valor !== undefined) params.set(chave, String(valor));
    }
    const texto = params.toString();
    return texto ? `${path}?${texto}` : path;
  }
}
