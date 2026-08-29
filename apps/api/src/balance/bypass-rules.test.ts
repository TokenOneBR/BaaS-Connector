import { describe, expect, it } from 'vitest';

import { allBypassReasons, bypassReason, freshnessOf, type BypassInput } from './bypass-rules.js';

const NOW = new Date('2026-08-28T12:00:00.000Z');

/** Cenario em que o cache PODE servir. Cada teste quebra uma regra por vez. */
const servivel = (overrides: Partial<BypassInput> = {}): BypassInput => ({
  consistency: 'cached',
  authorizationPath: false,
  lastLocalMovementAt: new Date('2026-08-28T11:00:00.000Z'),
  hasInboundWebhooks: true,
  hasHighSeverityBreak: false,
  cachedAsOf: new Date('2026-08-28T11:59:50.000Z'),
  lastKnownMovementAt: new Date('2026-08-28T11:00:00.000Z'),
  now: NOW,
  postMutationWindowSeconds: 60,
  ...overrides,
});

describe('regras de bypass do cache de saldo', () => {
  it('serve do cache quando nenhuma regra se aplica', () => {
    // Este e o caso comum, e e o que justifica o cache existir: dashboards
    // atualizam saldo constantemente.
    expect(bypassReason(servivel())).toBeUndefined();
  });

  it('1. consistency=strong ignora o cache', () => {
    expect(bypassReason(servivel({ consistency: 'strong' }))).toBe('consistency_strong');
  });

  it('2. a autorizacao de PIX out sempre ignora o cache', () => {
    // Hard-coded, nao configuravel: autorizar pagamento contra saldo velho e
    // como se aprova uma transferencia que nao cabe.
    expect(bypassReason(servivel({ authorizationPath: true }))).toBe('authorization_path');
  });

  it('3. movimento local recente ignora o cache', () => {
    const agoraMesmo = new Date(NOW.getTime() - 10_000);
    expect(bypassReason(servivel({ lastLocalMovementAt: agoraMesmo }))).toBe(
      'recent_local_mutation',
    );
  });

  it('3. fora da janela, o movimento local nao ignora mais', () => {
    const velho = new Date(NOW.getTime() - 61_000);
    expect(bypassReason(servivel({ lastLocalMovementAt: velho }))).toBeUndefined();
  });

  it('4. conexao sem webhook de entrada ignora o cache', () => {
    // Sem invalidacao por evento, saldo por TTL e chute.
    expect(bypassReason(servivel({ hasInboundWebhooks: false }))).toBe('no_inbound_webhooks');
  });

  it('5. break de conciliacao aberto ignora o cache', () => {
    expect(bypassReason(servivel({ hasHighSeverityBreak: true }))).toBe(
      'open_reconciliation_break',
    );
  });

  it('6. cache anterior ao ultimo movimento conhecido ignora o cache', () => {
    expect(
      bypassReason(
        servivel({
          cachedAsOf: new Date('2026-08-28T11:00:00.000Z'),
          lastKnownMovementAt: new Date('2026-08-28T11:30:00.000Z'),
        }),
      ),
    ).toBe('cache_older_than_movement');
  });

  it('sem valor em cache, a regra 6 nao dispara sozinha', () => {
    // Nao ha o que comparar; o miss ja leva a origem de qualquer forma.
    const motivos = allBypassReasons(servivel({ cachedAsOf: null }));
    expect(motivos).not.toContain('cache_older_than_movement');
  });

  it('a primeira regra vence, e a ordem e a declarada', () => {
    // Ordem importa para o motivo reportado no log de suporte: "pediu strong"
    // e uma explicacao diferente de "havia break aberto".
    const motivos = allBypassReasons(
      servivel({ consistency: 'strong', authorizationPath: true, hasHighSeverityBreak: true }),
    );
    expect(motivos).toEqual([
      'consistency_strong',
      'authorization_path',
      'open_reconciliation_break',
    ]);
    expect(bypassReason(servivel({ consistency: 'strong', authorizationPath: true }))).toBe(
      'consistency_strong',
    );
  });

  it('as seis regras existem e nenhuma sumiu', () => {
    // Um refactor que apagasse uma regra deixaria o padrao `cached` inseguro
    // sem quebrar nenhum outro teste.
    const todas = allBypassReasons({
      consistency: 'strong',
      authorizationPath: true,
      lastLocalMovementAt: NOW,
      hasInboundWebhooks: false,
      hasHighSeverityBreak: true,
      cachedAsOf: new Date('2026-08-28T10:00:00.000Z'),
      lastKnownMovementAt: new Date('2026-08-28T11:00:00.000Z'),
      now: NOW,
      postMutationWindowSeconds: 60,
    });
    expect(todas).toHaveLength(6);
  });
});

describe('declaracao de frescura', () => {
  it('reporta idade e validade', () => {
    const freshness = freshnessOf({
      source: 'cache',
      asOf: new Date('2026-08-28T11:59:45.000Z'),
      now: NOW,
      ttlSeconds: 30,
    });

    expect(freshness).toMatchObject({
      source: 'cache',
      as_of: '2026-08-28T11:59:45.000Z',
      age_ms: 15_000,
      stale_after: '2026-08-28T12:00:15.000Z',
    });
    // `degraded` so aparece quando de fato houve degradacao.
    expect(freshness.degraded).toBeUndefined();
  });

  it('marca degradado quando serve stale por erro do provedor', () => {
    const freshness = freshnessOf({
      source: 'cache-stale',
      asOf: new Date('2026-08-28T11:00:00.000Z'),
      now: NOW,
      ttlSeconds: 30,
      degraded: true,
    });
    expect(freshness).toMatchObject({ source: 'cache-stale', degraded: true });
  });

  it('nunca reporta idade negativa', () => {
    // Relogio do provedor adiantado nao pode virar `age_ms` negativo numa
    // resposta publica.
    const freshness = freshnessOf({
      source: 'provider',
      asOf: new Date(NOW.getTime() + 5_000),
      now: NOW,
      ttlSeconds: 30,
    });
    expect(freshness.age_ms).toBe(0);
  });
});
