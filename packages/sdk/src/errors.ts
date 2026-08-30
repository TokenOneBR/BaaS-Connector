import { BaasErrorCode } from '@baasconn/taxonomy';

/**
 * Erro devolvido pela API, preservado como veio.
 *
 * O SDK NAO reescreve mensagem nem reclassifica codigo. O corpo canonico ja
 * traz `message_ptbr` de catalogo, `docs_url` e — quando originado no provedor
 * — o `provider.{slug,code,message}` literal, que e o que o suporte usa para
 * escalar. Traduzir aqui perderia exatamente a informacao que faz a
 * escalacao funcionar.
 */
export interface BaasApiErrorBody {
  code: string;
  category?: string;
  message: string;
  message_ptbr?: string;
  details?: unknown[];
  request_id?: string;
  docs_url?: string;
  provider?: { slug?: string; code?: string; message?: string };
}

export class BaasApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId?: string;
  readonly body: BaasApiErrorBody;

  constructor(status: number, body: BaasApiErrorBody) {
    super(body.message_ptbr ?? body.message);
    this.name = 'BaasApiError';
    this.status = status;
    this.code = body.code;
    this.requestId = body.request_id;
    this.body = body;
  }

  /**
   * Seguro repetir a MESMA requisicao.
   *
   * Deliberadamente conservador e deliberadamente separado de "o erro e
   * transitorio": um timeout num GET e as duas coisas; num POST de
   * transferencia so e seguro porque mandamos chave de idempotencia ao
   * provedor. Quando o SDK nao sabe, responde `false` — repetir uma
   * transferencia por engano custa dinheiro, e nao repetir custa um clique.
   */
  get safeToRetry(): boolean {
    if (this.status === 429 || this.status === 503) return true;
    return this.code === BaasErrorCode.PROVIDER_TIMEOUT && this.status >= 500;
  }
}

/**
 * Falha ANTES de a requisicao chegar ao servidor.
 *
 * DNS, conexao recusada, timeout de connect. Distinta de `BaasApiError` de
 * proposito: aqui e provado que nada aconteceu do outro lado, entao repetir e
 * seguro mesmo numa rota de dinheiro.
 */
export class BaasTransportError extends Error {
  constructor(
    message: string,
    override readonly cause: unknown,
  ) {
    super(message);
    this.name = 'BaasTransportError';
  }
}

/**
 * Desfecho DESCONHECIDO.
 *
 * A API respondeu 202 numa rota de movimentacao: ela mandou ao provedor e nao
 * sabe se o dinheiro se moveu. NAO e erro — o `operation_id` e como se
 * descobre o desfecho, e o SDK o entrega em vez de esconder atras de uma
 * excecao generica. Reenviar aqui e o caminho direto para o pagamento
 * duplicado.
 */
export class BaasOutcomeUnknown extends Error {
  constructor(readonly operationId: string) {
    super(
      `Desfecho desconhecido. Consulte GET /v1/operations/${operationId} — NUNCA reenvie a transferencia.`,
    );
    this.name = 'BaasOutcomeUnknown';
  }
}
