import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
  type Registry as PromRegistry,
} from 'prom-client';

/**
 * Metricas do conector.
 *
 * As que importam num conector de BaaS nao sao as de HTTP genericas: sao as de
 * saude da dependencia (e onde um conector de fato falha), fluxo de dinheiro e
 * INVARIANTE. `baas_ledger_imbalance_detected_total` precisa ficar
 * permanentemente em zero: qualquer incremento e incidente, nao alerta.
 */
export class Metrics {
  readonly registry: PromRegistry;

  // Dependencia de provedor: o SLI primario de um conector.
  readonly providerRequestDuration: Histogram<string>;
  readonly providerRequests: Counter<string>;
  readonly providerRetries: Counter<string>;
  readonly providerRateLimited: Counter<string>;
  readonly providerCircuitState: Gauge<string>;
  readonly providerTokenRefresh: Counter<string>;
  /** Certificado mTLS vencendo as 3h da manha e outage classico. */
  readonly providerCredentialExpiry: Gauge<string>;

  // Fluxo de dinheiro.
  readonly pixTransactions: Counter<string>;
  readonly pixAmountMinor: Counter<string>;
  /** Aceite -> SETTLED. O numero que o negocio pergunta. */
  readonly pixSettlementLatency: Histogram<string>;
  readonly pixOutRejections: Counter<string>;

  // Integridade de eventos.
  readonly webhookEvents: Counter<string>;
  /** Um pico aqui e evento de SEGURANCA, nao bug. */
  readonly webhookSignatureFailures: Counter<string>;
  readonly webhookDuplicates: Counter<string>;
  readonly webhookLag: Histogram<string>;

  // Invariantes: a razao de o ledger existir.
  readonly ledgerImbalanceDetected: Counter<string>;
  readonly balanceDriftMinor: Gauge<string>;
  readonly reconciliationBreaksOpen: Gauge<string>;
  readonly reconciliationRunDuration: Histogram<string>;
  /** Obsolescencia e detectada DISTO, nao de um contador de execucoes. */
  readonly reconciliationLastSuccess: Gauge<string>;

  // Plataforma.
  readonly idempotencyConflicts: Counter<string>;
  readonly outboxPending: Gauge<string>;
  readonly outboxOldestAgeSeconds: Gauge<string>;
  readonly queueDepth: Gauge<string>;
  readonly jobDuration: Histogram<string>;
  readonly dlqSize: Gauge<string>;
  readonly cacheOperations: Counter<string>;
  readonly apiKeyAuthFailures: Counter<string>;
  readonly onboardingTotal: Counter<string>;

  constructor(options: { registry?: PromRegistry; defaultMetrics?: boolean } = {}) {
    this.registry = options.registry ?? new Registry();
    if (options.defaultMetrics !== false) {
      collectDefaultMetrics({ register: this.registry, prefix: 'baas_' });
    }

    const r = this.registry;

    this.providerRequestDuration = new Histogram({
      name: 'baas_provider_request_duration_seconds',
      help: 'Duracao das chamadas ao provedor',
      labelNames: ['provider', 'capability', 'environment', 'outcome'],
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
      registers: [r],
    });
    this.providerRequests = new Counter({
      name: 'baas_provider_requests_total',
      help: 'Chamadas ao provedor por status e codigo canonico',
      labelNames: ['provider', 'capability', 'http_status', 'error_code'],
      registers: [r],
    });
    this.providerRetries = new Counter({
      name: 'baas_provider_retries_total',
      help: 'Retentativas por motivo',
      labelNames: ['provider', 'capability', 'reason'],
      registers: [r],
    });
    this.providerRateLimited = new Counter({
      name: 'baas_provider_rate_limited_total',
      help: 'Respostas 429 do provedor',
      labelNames: ['provider'],
      registers: [r],
    });
    this.providerCircuitState = new Gauge({
      name: 'baas_provider_circuit_state',
      help: 'Estado do circuito: 0 fechado, 1 meio-aberto, 2 aberto',
      labelNames: ['provider', 'environment', 'endpoint_class'],
      registers: [r],
    });
    this.providerTokenRefresh = new Counter({
      name: 'baas_provider_token_refresh_total',
      help: 'Renovacoes de token OAuth2',
      labelNames: ['provider', 'outcome'],
      registers: [r],
    });
    this.providerCredentialExpiry = new Gauge({
      name: 'baas_provider_credential_expiry_seconds',
      help: 'Segundos ate a credencial (certificado mTLS) vencer',
      labelNames: ['provider', 'credential'],
      registers: [r],
    });

    this.pixTransactions = new Counter({
      name: 'baas_pix_transactions_total',
      help: 'Transacoes PIX por direcao e status',
      labelNames: ['direction', 'provider', 'status'],
      registers: [r],
    });
    this.pixAmountMinor = new Counter({
      name: 'baas_pix_amount_minor_total',
      help: 'Volume PIX em unidades menores (centavos)',
      labelNames: ['direction', 'provider', 'currency'],
      registers: [r],
    });
    this.pixSettlementLatency = new Histogram({
      name: 'baas_pix_settlement_latency_seconds',
      help: 'Aceite da requisicao ate SETTLED',
      labelNames: ['direction', 'provider'],
      buckets: [0.5, 1, 2, 5, 10, 30, 60, 300, 900],
      registers: [r],
    });
    this.pixOutRejections = new Counter({
      name: 'baas_pix_out_rejections_total',
      help: 'Recusas de PIX out por motivo canonico',
      labelNames: ['provider', 'reason'],
      registers: [r],
    });

    this.webhookEvents = new Counter({
      name: 'baas_webhook_events_total',
      help: 'Webhooks de entrada por resultado',
      labelNames: ['provider', 'type', 'outcome'],
      registers: [r],
    });
    this.webhookSignatureFailures = new Counter({
      name: 'baas_webhook_signature_failures_total',
      help: 'Falhas de verificacao de assinatura (evento de seguranca)',
      labelNames: ['provider'],
      registers: [r],
    });
    this.webhookDuplicates = new Counter({
      name: 'baas_webhook_duplicates_total',
      help: 'Reentregas absorvidas pela deduplicacao',
      labelNames: ['provider'],
      registers: [r],
    });
    this.webhookLag = new Histogram({
      name: 'baas_webhook_lag_seconds',
      help: 'Instante do evento no provedor ate a nossa ingestao',
      labelNames: ['provider'],
      buckets: [0.5, 1, 5, 15, 60, 300, 1800],
      registers: [r],
    });

    this.ledgerImbalanceDetected = new Counter({
      name: 'baas_ledger_imbalance_detected_total',
      help: 'Violacoes de invariante do razao. DEVE permanecer em zero.',
      labelNames: ['invariant'],
      registers: [r],
    });
    this.balanceDriftMinor = new Gauge({
      name: 'baas_balance_drift_minor',
      help: 'Diferenca absoluta entre o saldo do provedor e o do nosso ledger',
      labelNames: ['provider', 'account_kind'],
      registers: [r],
    });
    this.reconciliationBreaksOpen = new Gauge({
      name: 'baas_reconciliation_breaks_open',
      help: 'Quebras de conciliacao abertas',
      labelNames: ['provider', 'break_type', 'severity'],
      registers: [r],
    });
    this.reconciliationRunDuration = new Histogram({
      name: 'baas_reconciliation_run_duration_seconds',
      help: 'Duracao de uma execucao de conciliacao',
      labelNames: ['provider', 'scope'],
      buckets: [1, 5, 15, 60, 300, 900, 3600],
      registers: [r],
    });
    this.reconciliationLastSuccess = new Gauge({
      name: 'baas_reconciliation_last_success_timestamp_seconds',
      help: 'Unix timestamp da ultima conciliacao bem-sucedida',
      labelNames: ['provider'],
      registers: [r],
    });

    this.idempotencyConflicts = new Counter({
      name: 'baas_idempotency_conflicts_total',
      help: 'Conflitos de chave de idempotencia por tipo',
      labelNames: ['endpoint', 'kind'],
      registers: [r],
    });
    this.outboxPending = new Gauge({
      name: 'baas_outbox_pending',
      help: 'Eventos no outbox aguardando despacho',
      registers: [r],
    });
    this.outboxOldestAgeSeconds = new Gauge({
      name: 'baas_outbox_oldest_age_seconds',
      help: 'Idade do evento mais antigo nao despachado',
      registers: [r],
    });
    this.queueDepth = new Gauge({
      name: 'baas_queue_depth',
      help: 'Profundidade da fila',
      labelNames: ['queue'],
      registers: [r],
    });
    this.jobDuration = new Histogram({
      name: 'baas_job_duration_seconds',
      help: 'Duracao de job de background',
      labelNames: ['queue', 'outcome'],
      buckets: [0.1, 0.5, 1, 5, 15, 60, 300],
      registers: [r],
    });
    this.dlqSize = new Gauge({
      name: 'baas_dlq_size',
      help: 'Itens na dead-letter queue',
      labelNames: ['queue'],
      registers: [r],
    });
    this.cacheOperations = new Counter({
      name: 'baas_cache_operations_total',
      help: 'Operacoes de cache por resultado',
      labelNames: ['cache', 'result'],
      registers: [r],
    });
    this.apiKeyAuthFailures = new Counter({
      name: 'baas_api_key_auth_failures_total',
      help: 'Falhas de autenticacao por motivo',
      labelNames: ['reason'],
      registers: [r],
    });
    this.onboardingTotal = new Counter({
      name: 'baas_onboarding_total',
      help: 'Casos de onboarding por tipo e status',
      labelNames: ['type', 'provider', 'status'],
      registers: [r],
    });
  }

  async render(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }
}

export const CIRCUIT_STATE_VALUE: Readonly<Record<string, number>> = Object.freeze({
  CLOSED: 0,
  HALF_OPEN: 1,
  OPEN: 2,
});
