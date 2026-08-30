import {
  ActorType,
  ApiKeyStatus,
  AuditOutcome,
  BreakSeverity,
  BreakStatus,
  BreakType,
  ConnectionStatus,
  ConsoleRole,
  Environment,
  ProviderSlug,
  ReconciliationRunStatus,
  ReconciliationScope,
  ResolutionAction,
  SupportLevel,
} from '@baasconn/taxonomy';
import { z } from 'zod';

import { zPaginationQuery } from '../common/pagination.js';
import { zEffectiveDate, zEnum, zMoney, zTimestamp } from '../common/primitives.js';

// --------------------------------------------------------------------------
// Provedores e conexoes
// --------------------------------------------------------------------------

export const zCapabilityEntry = z.object({
  level: zEnum(SupportLevel),
  note: z.string().optional(),
  doc_ref: z.string().optional(),
  constraints: z
    .object({
      min_amount: z.string().optional(),
      max_amount: z.string().optional(),
      allowed_person_types: z.array(z.string()).optional(),
      allowed_pix_key_types: z.array(z.string()).optional(),
      max_expiry_seconds: z.number().int().optional(),
      required_fields: z.array(z.string()).optional(),
      ignored_fields: z.array(z.string()).optional(),
      rate_limit: z
        .object({ requests: z.number().int(), per_seconds: z.number().int() })
        .optional(),
    })
    .optional(),
});

export const zProviderSummary = z.object({
  slug: zEnum(ProviderSlug),
  display_name: z.string(),
  capabilities: z.record(z.string(), zCapabilityEntry),
  endpoints: z.record(z.string(), z.string()),
});

/**
 * Credencial escrita.
 *
 * Nao ha schema de leitura correspondente de proposito: nenhum endpoint do
 * admin devolve material de credencial. A leitura retorna apenas fingerprint,
 * last4 e metadados de rotacao.
 */
export const zCreateConnection = z.object({
  provider: zEnum(ProviderSlug),
  environment: zEnum(Environment),
  label: z.string().min(1).max(64).default('default'),
  base_url: z.string().url().optional(),
  /** Validado contra o `credentialsSchema` do adapter antes de ser cifrado. */
  credentials: z.record(z.string(), z.unknown()),
  webhook_secret: z.string().max(512).optional(),
  config: z.record(z.string(), z.unknown()).default({}),
});

export const zConnection = z.object({
  id: z.string(),
  provider: zEnum(ProviderSlug),
  environment: zEnum(Environment),
  label: z.string(),
  status: zEnum(ConnectionStatus),
  base_url: z.string().nullish(),
  /** Prova que ha credencial gravada, sem revelar nada dela. */
  credentials: z.object({
    set: z.boolean(),
    fingerprint: z.string().nullish(),
    last4: z.string().nullish(),
    updated_at: zTimestamp.nullish(),
    updated_by: z.string().nullish(),
    expires_at: zTimestamp.nullish(),
  }),
  webhook_url: z.string(),
  last_health_check_at: zTimestamp.nullish(),
  last_health_status: z.string().nullish(),
  created_at: zTimestamp,
});

export const zHealthReport = z.object({
  healthy: z.boolean(),
  checked_at: zTimestamp,
  latency_ms: z.number().int().nullish(),
  error_code: z.string().nullish(),
  message: z.string().nullish(),
});

// --------------------------------------------------------------------------
// API keys
// --------------------------------------------------------------------------

export const API_SCOPES = [
  'accounts:read',
  'accounts:write',
  'accounts:close',
  'onboarding:read',
  'onboarding:write',
  'onboarding:documents',
  'balance:read',
  'pix:read',
  'pix:write',
  'pix:refund',
  'pix:keys:read',
  'pix:keys:write',
  'statement:read',
  'webhooks:read',
  'webhooks:write',
  'reconciliation:read',
  /** Desmascara CPF/CNPJ. Todo uso e auditado. */
  'pii:read',
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

export const zApiScope = z.enum(API_SCOPES);

export const zCreateApiKey = z.object({
  name: z.string().min(1).max(128),
  environment: zEnum(Environment),
  scopes: z.array(zApiScope).min(1),
  expires_at: zTimestamp.optional(),
  ip_allowlist: z.array(z.string()).max(50).default([]),
  default_connection_id: z.string().optional(),
  /**
   * Assinatura HMAC nas rotas de movimentacao.
   *
   * Opcional para poder LIGAR em homologacao. Em producao com `pix:write` ela
   * e forcada, e um `false` explicito e RECUSADO com 422 em vez de
   * sobrescrito em silencio: o operador precisa aprender a regra, e nao achar
   * que a desligou.
   */
  signing_required: z.boolean().optional(),
});

export const zApiKey = z.object({
  id: z.string(),
  name: z.string(),
  environment: zEnum(Environment),
  /** Prefixo exibivel, ex.: bck_hml_key_01JB. */
  prefix: z.string(),
  last4: z.string(),
  scopes: z.array(z.string()),
  signing_required: z.boolean(),
  ip_allowlist: z.array(z.string()),
  status: zEnum(ApiKeyStatus),
  last_used_at: zTimestamp.nullish(),
  expires_at: zTimestamp.nullish(),
  created_at: zTimestamp,
});

/** Resposta da criacao: a unica vez em que o segredo existe fora do hash. */
export const zApiKeyCreated = zApiKey.extend({
  secret: z.string(),
  signing_secret: z.string().nullish(),
  warning: z.literal('Guarde esta chave agora: ela nao pode ser recuperada depois.'),
});

// --------------------------------------------------------------------------
// Conciliacao
// --------------------------------------------------------------------------

export const zReconciliationRun = z.object({
  id: z.string(),
  connection_id: z.string(),
  environment: zEnum(Environment),
  account_id: z.string().nullish(),
  scope: zEnum(ReconciliationScope),
  window_start: zTimestamp,
  window_end: zTimestamp,
  status: zEnum(ReconciliationRunStatus),
  provider_item_count: z.number().int(),
  local_item_count: z.number().int(),
  ledger_item_count: z.number().int(),
  matched_count: z.number().int(),
  break_count: z.number().int(),
  /** Numero de manchete do dashboard. */
  balance_delta: zMoney.nullish(),
  started_at: zTimestamp.nullish(),
  finished_at: zTimestamp.nullish(),
  triggered_by: z.string(),
});

export const zReconciliationBreak = z.object({
  id: z.string(),
  run_id: z.string(),
  first_seen_run_id: z.string(),
  connection_id: z.string(),
  account_id: z.string().nullish(),
  type: zEnum(BreakType),
  severity: zEnum(BreakSeverity),
  status: zEnum(BreakStatus),
  amount: zMoney.nullish(),
  delta: zMoney.nullish(),
  effective_date: zEffectiveDate,
  end_to_end_id: z.string().nullish(),
  description: z.string(),
  /** Os dois lados normalizados e redigidos, para revisao lado a lado. */
  evidence: z.record(z.string(), z.unknown()),
  age_days: z.number().int(),
  assigned_to: z.string().nullish(),
  resolution: zEnum(ResolutionAction).nullish(),
  resolution_note: z.string().nullish(),
  resolved_by: z.string().nullish(),
  resolved_at: zTimestamp.nullish(),
  /** Lancamento de ajuste criado pela resolucao, quando houve. */
  adjustment_transaction_id: z.string().nullish(),
  created_at: zTimestamp,
});

export const zResolveBreak = z.object({
  action: zEnum(ResolutionAction),
  /** Obrigatorio: toda resolucao manual precisa de justificativa auditavel. */
  note: z.string().min(10).max(2000),
});

/**
 * Disparo de uma execucao de conciliacao.
 *
 * `account_id` e OBRIGATORIO. A chave unica de `ReconciliationRun` inclui a
 * conta, e em Postgres NULL nao e igual a NULL num indice unico — um run de
 * conexao inteira escaparia da deduplicacao e dois pods criariam dois runs
 * para a mesma janela. Reconciliar uma conexao inteira e outra operacao: um
 * *sweep*, que enumera as contas e cria um run por conta.
 */
export const zTriggerReconciliation = z.object({
  connection_id: z.string(),
  account_id: z.string(),
  scope: zEnum(ReconciliationScope).default(ReconciliationScope.MANUAL),
  window_start: zTimestamp,
  window_end: zTimestamp,
});

export const zListBreaksQuery = zPaginationQuery.extend({
  status: zEnum(BreakStatus).optional(),
  severity: zEnum(BreakSeverity).optional(),
  type: zEnum(BreakType).optional(),
  connection_id: z.string().optional(),
  account_id: z.string().optional(),
  min_age_days: z.coerce.number().int().optional(),
});

// --------------------------------------------------------------------------
// Auditoria
// --------------------------------------------------------------------------

export const zAuditLog = z.object({
  id: z.string(),
  environment: zEnum(Environment),
  sequence: z.string(),
  actor_type: zEnum(ActorType),
  actor_id: z.string().nullish(),
  actor_label: z.string().nullish(),
  actor_ip: z.string().nullish(),
  action: z.string(),
  outcome: zEnum(AuditOutcome),
  error_code: z.string().nullish(),
  resource_type: z.string(),
  resource_id: z.string().nullish(),
  /** Ja redigidos: valores sensiveis nunca chegam a esta tabela em claro. */
  before: z.unknown().nullish(),
  after: z.unknown().nullish(),
  changed_fields: z.array(z.string()).default([]),
  request_id: z.string().nullish(),
  occurred_at: zTimestamp,
});

export const zListAuditQuery = zPaginationQuery.extend({
  actor_type: zEnum(ActorType).optional(),
  actor_id: z.string().optional(),
  action: z.string().optional(),
  resource_type: z.string().optional(),
  resource_id: z.string().optional(),
  outcome: zEnum(AuditOutcome).optional(),
  occurred_after: z.string().optional(),
  occurred_before: z.string().optional(),
});

/** Verificacao da cadeia de hash da trilha de auditoria. */
export const zAuditVerification = z.object({
  verified: z.boolean(),
  checked_count: z.number().int(),
  from: zTimestamp,
  to: zTimestamp,
  first_divergence: z
    .object({ audit_id: z.string(), sequence: z.string(), occurred_at: zTimestamp })
    .nullish(),
});

// --------------------------------------------------------------------------
// Console: usuarios e sessao
// --------------------------------------------------------------------------

export const zLogin = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(256),
  totp_code: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
});

/**
 * `GET /admin/v1/me`.
 *
 * Le a LINHA DO USUARIO, e nao so as claims do token. O console precisa de
 * `name` no cabecalho e de `mfa_enabled` em configuracoes, e um papel alterado
 * desde a emissao do token nao pode sobreviver quinze minutos no menu. E uma
 * leitura indexada, e a guarda ja faz uma.
 */
export const zSession = z.object({
  user: z.object({
    id: z.string(),
    email: z.string(),
    name: z.string(),
    role: zEnum(ConsoleRole),
    mfa_enabled: z.boolean(),
  }),
  session_id: z.string(),
  expires_at: zTimestamp,
});

/**
 * Resultado do login.
 *
 * Nao ha `mfa_required` aqui. A API LANCA `MFA_REQUIRED` quando o papel exige
 * segundo fator e ele nao veio — devolver tambem uma flag daria duas fontes
 * para a mesma verdade, e o cliente que lesse a errada trataria uma recusa
 * como sucesso. O console le o codigo do erro.
 */
export const zLoginResult = z.object({
  access_token: z.string(),
  token_type: z.literal('Bearer'),
  expires_in: z.number().int(),
  refresh_token: z.string(),
  user: z.object({
    id: z.string(),
    email: z.string(),
    name: z.string(),
    role: zEnum(ConsoleRole),
  }),
});

// --------------------------------------------------------------------------
// Painel
// --------------------------------------------------------------------------

/**
 * Agregado do dashboard: UMA rota, e nao nove.
 *
 * Duas razoes. O painel nao pode custar nove idas ao BFF, cada uma com o
 * round-trip de sessao; e um agregado proprio sao alguns `count`/`groupBy`, em
 * vez de paginar quatro listas para descartar quase tudo.
 */
export const zOverview = z.object({
  environment: zEnum(Environment),
  window_hours: z.number().int(),
  accounts: z.object({
    total: z.number().int(),
    active: z.number().int(),
    pending_onboarding: z.number().int(),
    blocked: z.number().int(),
  }),
  pix: z.object({
    in_count: z.number().int(),
    out_count: z.number().int(),
    in_amount: zMoney,
    out_amount: zMoney,
    settled: z.number().int(),
    failed: z.number().int(),
    unknown: z.number().int(),
  }),
  reconciliation: z.object({
    open_breaks: z.number().int(),
    critical_breaks: z.number().int(),
    /** Nulo enquanto nao houver execucao: zero mentiria "conciliado ha pouco". */
    last_success_at: zTimestamp.nullish(),
  }),
  outbox: z.object({
    pending: z.number().int(),
    oldest_age_seconds: z.number().int().nullish(),
  }),
});
