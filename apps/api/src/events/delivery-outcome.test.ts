import { WEBHOOK_RETRY_SCHEDULE_SECONDS } from '@baasconn/taxonomy';
import { describe, expect, it } from 'vitest';

import { decideDelivery, nextAttemptAt } from './delivery-outcome.js';
import { matchesEventType } from './event-type-filter.js';

describe('desfecho de entrega', () => {
  it('2xx e sucesso', () => {
    for (const status of [200, 201, 204, 299]) {
      expect(decideDelivery({ status })).toEqual({ kind: 'succeeded' });
    }
  });

  it('410 desabilita o endpoint na hora', () => {
    // E literalmente o que o codigo pede. Continuar batendo depois dele e
    // ignorar o que o cliente disse.
    expect(decideDelivery({ status: 410 })).toMatchObject({ kind: 'disable_endpoint' });
  });

  it('os demais 4xx RETENTAM', () => {
    // Um 401 quase sempre e segredo rotacionado do lado do cliente; um 404 e
    // rota que ainda vai subir. Desistir no primeiro 4xx perderia evento por
    // um erro que nao e nosso nem permanente.
    for (const status of [400, 401, 403, 404, 422]) {
      expect(decideDelivery({ status })).toMatchObject({ kind: 'retry' });
    }
  });

  it('3xx nao e seguido', () => {
    // Redirect para host de terceiro transforma payload assinado, com dado de
    // pagamento, em vazamento — e o `Location` vem de fora.
    for (const status of [301, 302, 307, 308]) {
      const decision = decideDelivery({ status });
      expect(decision).toMatchObject({ kind: 'retry' });
      expect(decision.kind === 'retry' && decision.reason).toContain('redirect');
    }
  });

  it('429 e 503 honram Retry-After', () => {
    expect(decideDelivery({ status: 429, retryAfterSeconds: 120 })).toMatchObject({
      kind: 'retry',
      retryAfterSeconds: 120,
    });
  });

  it('5xx retenta', () => {
    expect(decideDelivery({ status: 500 })).toMatchObject({ kind: 'retry' });
    expect(decideDelivery({ status: 502 })).toMatchObject({ kind: 'retry' });
  });
});

describe('escada de retry', () => {
  const now = new Date('2026-08-29T12:00:00.000Z');
  const semJitter = () => 0.5;

  it('segue a escada da taxonomia', () => {
    const primeira = nextAttemptAt({
      attempt: 1,
      schedule: WEBHOOK_RETRY_SCHEDULE_SECONDS,
      now,
      random: semJitter,
    });
    expect(primeira?.getTime()).toBe(now.getTime() + 10_000);
  });

  it('esgota depois do ultimo degrau', () => {
    // Dez tentativas em ~72h. Passou disso, a entrega e terminal — insistir
    // para sempre so enche a tabela.
    expect(
      nextAttemptAt({
        attempt: WEBHOOK_RETRY_SCHEDULE_SECONDS.length + 1,
        schedule: WEBHOOK_RETRY_SCHEDULE_SECONDS,
        now,
        random: semJitter,
      }),
    ).toBeUndefined();
  });

  it('Retry-After maior vence a escada', () => {
    const at = nextAttemptAt({
      attempt: 1,
      schedule: WEBHOOK_RETRY_SCHEDULE_SECONDS,
      retryAfterSeconds: 600,
      now,
      random: semJitter,
    });
    expect(at?.getTime()).toBe(now.getTime() + 600_000);
  });

  it('Retry-After menor NAO acelera a escada', () => {
    // Nao vamos bater mais rapido por pedido de terceiro.
    const at = nextAttemptAt({
      attempt: 4,
      schedule: WEBHOOK_RETRY_SCHEDULE_SECONDS,
      retryAfterSeconds: 1,
      now,
      random: semJitter,
    });
    expect(at?.getTime()).toBe(now.getTime() + 600_000);
  });

  it('o jitter fica dentro de +/-20%', () => {
    // Sem jitter, uma queda de 30s do cliente vira uma rajada no mesmo
    // milissegundo, e a segunda queda e culpa nossa.
    const base = WEBHOOK_RETRY_SCHEDULE_SECONDS[2]!;
    for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
      const at = nextAttemptAt({
        attempt: 3,
        schedule: WEBHOOK_RETRY_SCHEDULE_SECONDS,
        now,
        random: () => r,
      })!;
      const seconds = (at.getTime() - now.getTime()) / 1000;
      expect(seconds).toBeGreaterThanOrEqual(base * 0.8);
      expect(seconds).toBeLessThanOrEqual(base * 1.2);
    }
  });

  it('valores diferentes de random produzem instantes diferentes', () => {
    const a = nextAttemptAt({ attempt: 5, schedule: WEBHOOK_RETRY_SCHEDULE_SECONDS, now, random: () => 0 })!;
    const b = nextAttemptAt({ attempt: 5, schedule: WEBHOOK_RETRY_SCHEDULE_SECONDS, now, random: () => 1 })!;
    expect(a.getTime()).not.toBe(b.getTime());
  });
});

describe('filtro de tipo de evento', () => {
  it('lista vazia casa com tudo', () => {
    expect(matchesEventType([], 'pix_out.settled')).toBe(true);
  });

  it('curinga total casa com tudo', () => {
    expect(matchesEventType(['*'], 'account.created')).toBe(true);
  });

  it('curinga de recurso casa so o recurso', () => {
    expect(matchesEventType(['pix_out.*'], 'pix_out.settled')).toBe(true);
    expect(matchesEventType(['pix_out.*'], 'pix_in.received')).toBe(false);
  });

  it('tipo exato nao casa prefixo parecido', () => {
    // `pix_out` nao pode casar `pix_out_scheduled` de um recurso futuro.
    expect(matchesEventType(['pix_out.settled'], 'pix_out.settled')).toBe(true);
    expect(matchesEventType(['pix_out.settled'], 'pix_out.settled_late')).toBe(false);
  });

  it('nao compila regex de string armazenada', () => {
    // Regex vinda do cliente e superficie de ReDoS num caminho que roda por
    // evento e por endpoint. Um filtro com metacaracteres e so texto.
    expect(matchesEventType(['(a+)+$'], 'pix_out.settled')).toBe(false);
    expect(matchesEventType(['.*'], 'pix_out.settled')).toBe(false);
  });
});
