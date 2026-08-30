import type { BalanceDto, Freshness, MoneyDto } from '@baasconn/contracts';
import type { ProviderBalance } from '@baasconn/provider-spi';
import { BaasError, BaasErrorCode, Money, type Clock, type Environment } from '@baasconn/taxonomy';
import { Inject, Injectable, Logger } from '@nestjs/common';

import type { ActorContext } from '../accounts/accounts.service.js';
import {
  ACCOUNT_REPOSITORY,
  type AccountRecord,
  type AccountRepository,
} from '../accounts/accounts.types.js';
import { CACHE_STORE, accountTag, cacheKey, type CacheStore } from '../cache/cache.types.js';
import { CLOCK } from '../common/clock.js';
import { ApiConfig } from '../config/config.service.js';
import { ShadowLedgerService } from '../ledger/shadow-ledger.service.js';
import { ProviderRegistry } from '../providers/provider.registry.js';
import { ProviderResolver } from '../providers/provider.resolver.js';

import { bypassReason, freshnessOf, type BypassReason } from './bypass-rules.js';

export interface BalanceQuery {
  consistency: 'cached' | 'strong';
  source: 'provider' | 'ledger';
  onProviderError: 'fail' | 'serve_stale';
}

export interface BalanceResult {
  dto: Omit<BalanceDto, '_meta'>;
  freshness: Freshness;
  bypass?: BypassReason;
}

/** Estado consultivo que decide o bypass. Substituivel no teste. */
export const BALANCE_SIGNALS = Symbol('BAAS_BALANCE_SIGNALS');

export interface BalanceSignals {
  /** Ha break de conciliacao aberto com severidade alta nesta conta? */
  hasHighSeverityBreak(environment: Environment, accountId: string): Promise<boolean>;
  /** Ultimo movimento conhecido, de qualquer origem. */
  lastKnownMovementAt(environment: Environment, accountId: string): Promise<Date | undefined>;
}

@Injectable()
export class BalanceService {
  private readonly logger = new Logger(BalanceService.name);

  constructor(
    private readonly providers: ProviderResolver,
    private readonly registry: ProviderRegistry,
    private readonly ledger: ShadowLedgerService,
    private readonly config: ApiConfig,
    @Inject(ACCOUNT_REPOSITORY) private readonly accounts: AccountRepository,
    @Inject(CACHE_STORE) private readonly cache: CacheStore,
    @Inject(BALANCE_SIGNALS) private readonly signals: BalanceSignals,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Saldo da conta.
   *
   * O padrao serve do cache, e a resposta SEMPRE declara a frescura. As duas
   * coisas andam juntas: servir cache sem declarar seria mentir; declarar sem
   * cachear seria martelar o provedor. Os seis bypasses de `bypass-rules.ts`
   * sao o que torna o padrao defensavel.
   */
  async get(
    actor: ActorContext,
    accountId: string,
    query: BalanceQuery,
    options: { authorizationPath?: boolean } = {},
  ): Promise<BalanceResult> {
    const account = await this.requireAccount(actor.environment, accountId);

    if (query.source === 'ledger') {
      // Leitura do razao sombra: e como o operador enxerga drift, comparando
      // lado a lado com o que o provedor diz.
      return this.fromLedger(actor.environment, account);
    }

    const key = cacheKey({
      version: this.config.cacheVersion,
      environment: actor.environment,
      entity: 'balance',
      id: accountId,
    });

    const cached = await this.cache.get<ProviderBalanceSnapshot>(key);

    // Em paralelo: sao independentes, e ambos entram no caminho quente da
    // leitura mais batida da API. Em serie, cada consulta de saldo pagaria as
    // duas idas ao banco somadas.
    const [hasHighSeverityBreak, lastKnownMovementAt] = await Promise.all([
      this.signals.hasHighSeverityBreak(actor.environment, accountId),
      this.signals.lastKnownMovementAt(actor.environment, accountId),
    ]);

    const bypass = bypassReason({
      consistency: query.consistency,
      authorizationPath: options.authorizationPath ?? false,
      lastLocalMovementAt: account.lastEventAt,
      hasInboundWebhooks: this.registry.supports(account.provider, 'webhooks.inbound'),
      hasHighSeverityBreak,
      cachedAsOf: cached?.asOf,
      lastKnownMovementAt,
      now: this.clock.now(),
      postMutationWindowSeconds: this.config.postMutationBypassSeconds,
    });

    if (cached && !bypass) {
      return {
        dto: this.toDto(accountId, cached.value),
        freshness: freshnessOf({
          source: 'cache',
          asOf: cached.asOf,
          now: this.clock.now(),
          ttlSeconds: this.config.balanceCacheTtlSeconds,
        }),
      };
    }

    try {
      // Single-flight: 500 requisicoes concorrentes com miss viram UMA chamada
      // ao provedor. Sem isso, o primeiro pico derruba o rate limit da conexao
      // COMPARTILHADA e todos os clientes sofrem juntos.
      const fresh = await this.cache.singleFlight(key, () =>
        this.fetchFromProvider(account, actor),
      );
      const asOf = fresh.asOf ? new Date(fresh.asOf) : this.clock.now();

      await this.cache.set(key, fresh, {
        ttlSeconds: this.config.balanceCacheTtlSeconds,
        asOf,
        tags: [accountTag(actor.environment, accountId)],
      });

      return {
        dto: this.toDto(accountId, fresh),
        freshness: freshnessOf({
          source: 'provider',
          asOf,
          now: this.clock.now(),
          ttlSeconds: this.config.balanceCacheTtlSeconds,
        }),
        bypass,
      };
    } catch (error) {
      return this.onProviderFailure(accountId, query, cached, error);
    }
  }

  /** Invalida o saldo desta conta. Chamado por todo caminho que move dinheiro. */
  async invalidate(environment: Environment, accountId: string): Promise<void> {
    await this.cache.invalidateTag(accountTag(environment, accountId));
  }

  private async fetchFromProvider(
    account: AccountRecord,
    actor: ActorContext,
  ): Promise<ProviderBalanceSnapshot> {
    if (!account.providerAccountId) {
      throw new BaasError(BaasErrorCode.ACCOUNT_NOT_ACTIVE, {
        message: 'A conta ainda nao foi criada no provedor.',
      });
    }

    const bound = await this.providers.require(account.providerConnectionId, 'balance.get', {
      operationId: actor.operationId,
    });
    const balance = await bound.adapter.balance!.get({
      providerAccountId: account.providerAccountId,
    });

    return snapshotOf(balance);
  }

  private async fromLedger(
    environment: Environment,
    account: AccountRecord,
  ): Promise<BalanceResult> {
    if (!account.ledgerAvailableAccountId || !account.ledgerBlockedAccountId) {
      throw new BaasError(BaasErrorCode.RESOURCE_NOT_FOUND, {
        message: 'A conta nao possui contas de razao abertas.',
      });
    }

    const available = await this.ledger.balances(environment, account.ledgerAvailableAccountId);
    const blocked = await this.ledger.balances(environment, account.ledgerBlockedAccountId);
    const now = this.clock.now();

    return {
      dto: {
        object: 'balance',
        account_id: account.id,
        currency: 'BRL',
        available: money(available.available),
        blocked: money(blocked.posted),
        pending: money(available.pending),
        total: money(available.available + blocked.posted + available.pending),
        scheduled_outflow: money(available.posted - available.available),
      },
      freshness: freshnessOf({
        source: 'ledger',
        asOf: now,
        now,
        ttlSeconds: this.config.balanceCacheTtlSeconds,
      }),
    };
  }

  /**
   * O provedor falhou.
   *
   * O padrao e 503: nunca servimos valor velho em silencio numa leitura que o
   * cliente pediu forte. Com `serve_stale` explicito, devolvemos 200 marcado
   * como degradado — a escolha e do cliente, e ela fica registrada na resposta.
   */
  private async onProviderFailure(
    accountId: string,
    query: BalanceQuery,
    cached: { value: ProviderBalanceSnapshot; asOf: Date } | undefined,
    error: unknown,
  ): Promise<BalanceResult> {
    if (query.onProviderError !== 'serve_stale' || !cached) {
      if (error instanceof BaasError) throw error;
      throw new BaasError(BaasErrorCode.PROVIDER_UNAVAILABLE, {
        message: 'Nao foi possivel consultar o saldo no provedor.',
        cause: error,
      });
    }

    this.logger.warn(
      { err: error, account_id: accountId },
      'Provedor indisponivel; servindo saldo em cache marcado como degradado',
    );

    return {
      dto: this.toDto(accountId, cached.value),
      freshness: freshnessOf({
        source: 'cache-stale',
        asOf: cached.asOf,
        now: this.clock.now(),
        ttlSeconds: this.config.balanceCacheTtlSeconds,
        degraded: true,
      }),
    };
  }

  private toDto(accountId: string, snapshot: ProviderBalanceSnapshot): BalanceResult['dto'] {
    const available = BigInt(snapshot.available);
    const blocked = BigInt(snapshot.blocked ?? '0');
    const pending = BigInt(snapshot.pending ?? '0');

    return {
      object: 'balance',
      account_id: accountId,
      currency: 'BRL',
      available: money(available),
      blocked: money(blocked),
      pending: money(pending),
      // Invariante do contrato: total = disponivel + bloqueado + a liberar.
      total: money(available + blocked + pending),
      scheduled_outflow: null,
    };
  }

  private async requireAccount(
    environment: Environment,
    accountId: string,
  ): Promise<AccountRecord> {
    const account = await this.accounts.findById(environment, accountId);
    if (!account) {
      throw new BaasError(BaasErrorCode.ACCOUNT_NOT_FOUND, {
        message: `Conta ${accountId} nao encontrada.`,
      });
    }
    return account;
  }
}

/**
 * Forma guardada no cache.
 *
 * Centavos como STRING, e nao o `MoneyJSON` inteiro nem `bigint`: `bigint` nao
 * sobrevive a `JSON.stringify` sem o patch global, e guardar o objeto completo
 * gravaria `currency` e `scale` repetidos em toda chave.
 */
interface ProviderBalanceSnapshot {
  available: string;
  blocked?: string;
  pending?: string;
  asOf?: string;
}

function snapshotOf(balance: ProviderBalance): ProviderBalanceSnapshot {
  return {
    available: balance.available.amount,
    blocked: balance.blocked?.amount,
    pending: balance.pending?.amount,
    asOf: balance.asOf,
  };
}

function money(cents: bigint): MoneyDto {
  return Money.of(cents).toJSON();
}
