import type { Freshness } from '@baasconn/contracts';

/**
 * As seis regras que tornam o padrao `cached` seguro.
 *
 * Servir saldo do cache por padrao e a decisao certa — dashboards e apps
 * atualizam saldo constantemente, e martelar o endpoint do provedor e o
 * caminho mais rapido para tomar rate limit e derrubar a conexao
 * COMPARTILHADA, prejudicando todos os clientes de uma vez.
 *
 * Mas o padrao so e seguro POR CAUSA desta lista. Cada regra existe por um
 * incidente concreto, e cada uma e um predicado nomeado e testavel
 * isoladamente: uma condicao enterrada num `if` composto e uma condicao que
 * ninguem revisa.
 */
export interface BypassInput {
  /** O cliente pediu leitura forte. */
  consistency: 'cached' | 'strong';
  /** Estamos autorizando um PIX out. */
  authorizationPath: boolean;
  /** Instante do ultimo movimento local nesta conta. */
  lastLocalMovementAt?: Date | null;
  /** A conexao entrega webhook de entrada. */
  hasInboundWebhooks: boolean;
  /** A conta tem break de conciliacao aberto com severidade alta. */
  hasHighSeverityBreak: boolean;
  /** `asOf` do valor em cache. */
  cachedAsOf?: Date | null;
  /** Ultimo movimento conhecido da conta, de qualquer origem. */
  lastKnownMovementAt?: Date | null;
  now: Date;
  postMutationWindowSeconds: number;
}

export type BypassReason =
  | 'consistency_strong'
  | 'authorization_path'
  | 'recent_local_mutation'
  | 'no_inbound_webhooks'
  | 'open_reconciliation_break'
  | 'cache_older_than_movement';

interface Rule {
  reason: BypassReason;
  applies: (input: BypassInput) => boolean;
}

const RULES: readonly Rule[] = Object.freeze([
  {
    // 1. O cliente pediu explicitamente. Ignorar seria mentir na resposta.
    reason: 'consistency_strong',
    applies: (input) => input.consistency === 'strong',
  },
  {
    // 2. Autorizacao de PIX out. HARD-CODED, nao configuravel: um operador
    // afrouxando isto por engano autoriza pagamento contra saldo velho.
    reason: 'authorization_path',
    applies: (input) => input.authorizationPath,
  },
  {
    // 3. Acabamos de mexer no saldo desta conta. O provedor pode nao ter
    // propagado, mas o cache com certeza esta velho.
    reason: 'recent_local_mutation',
    applies: (input) =>
      input.lastLocalMovementAt != null &&
      input.now.getTime() - input.lastLocalMovementAt.getTime() <
        input.postMutationWindowSeconds * 1000,
  },
  {
    // 4. Sem webhook de entrada nao ha invalidacao por evento, e saldo por TTL
    // vira chute: o valor pode estar errado por 30s sem ninguem saber.
    reason: 'no_inbound_webhooks',
    applies: (input) => !input.hasInboundWebhooks,
  },
  {
    // 5. Ja sabemos que os numeros divergem. Servir cache aqui e repetir um
    // valor que temos motivo para duvidar.
    reason: 'open_reconciliation_break',
    applies: (input) => input.hasHighSeverityBreak,
  },
  {
    // 6. Houve movimento depois do instante em que o cache foi populado.
    reason: 'cache_older_than_movement',
    applies: (input) =>
      input.cachedAsOf != null &&
      input.lastKnownMovementAt != null &&
      input.cachedAsOf < input.lastKnownMovementAt,
  },
]);

/** Devolve o motivo do bypass, ou `undefined` quando o cache pode servir. */
export function bypassReason(input: BypassInput): BypassReason | undefined {
  return RULES.find((rule) => rule.applies(input))?.reason;
}

/** Todos os motivos aplicaveis. Existe para o teste e para o log de suporte. */
export function allBypassReasons(input: BypassInput): BypassReason[] {
  return RULES.filter((rule) => rule.applies(input)).map((rule) => rule.reason);
}

export function freshnessOf(options: {
  source: Freshness['source'];
  asOf: Date;
  now: Date;
  ttlSeconds: number;
  degraded?: boolean;
}): Freshness {
  return {
    source: options.source,
    as_of: options.asOf.toISOString(),
    age_ms: Math.max(0, options.now.getTime() - options.asOf.getTime()),
    stale_after: new Date(options.asOf.getTime() + options.ttlSeconds * 1000).toISOString(),
    ...(options.degraded ? { degraded: true } : {}),
  };
}
