import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { BlindIndex, EnvelopeCrypto } from '@baasconn/crypto';
import { Metrics } from '@baasconn/observability';

import { AppModule } from '../src/app.module.js';
import { ApiKeyService } from '../src/auth/api-key.service.js';
import { ApiConfig } from '../src/config/config.service.js';
import { HealthController } from '../src/health/health.controller.js';
import { PrismaService } from '../src/persistence/prisma.service.js';
import { CredentialResolver } from '../src/providers/credential.resolver.js';
import { ProviderRegistry } from '../src/providers/provider.registry.js';
import { ProviderResolver } from '../src/providers/provider.resolver.js';

/**
 * Compila o grafo de injecao inteiro.
 *
 * Este teste existe por um motivo especifico: quase todo servico do conector
 * recebe uma INTERFACE no construtor, e interface nao existe em runtime. Sem
 * o token de DI explicito, o `emitDecoratorMetadata` grava `Object` e o
 * container so falha no boot, com a mensagem inutil "can't resolve
 * dependencies (?, Object)". Um typecheck verde nao pega isso; compilar o
 * modulo pega.
 */
describe('grafo de injecao da API', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    process.env.DATABASE_URL ??= 'postgresql://baas:baas@127.0.0.1:5432/baas?schema=public';
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    await moduleRef.init();
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('resolve todo servico da raiz de composicao', () => {
    expect(moduleRef.get(ApiConfig)).toBeInstanceOf(ApiConfig);
    expect(moduleRef.get(ApiKeyService)).toBeInstanceOf(ApiKeyService);
    expect(moduleRef.get(CredentialResolver)).toBeInstanceOf(CredentialResolver);
    expect(moduleRef.get(ProviderRegistry)).toBeInstanceOf(ProviderRegistry);
    expect(moduleRef.get(ProviderResolver)).toBeInstanceOf(ProviderResolver);
    expect(moduleRef.get(PrismaService)).toBeInstanceOf(PrismaService);
    expect(moduleRef.get(EnvelopeCrypto)).toBeInstanceOf(EnvelopeCrypto);
    expect(moduleRef.get(BlindIndex)).toBeInstanceOf(BlindIndex);
    expect(moduleRef.get(Metrics)).toBeInstanceOf(Metrics);
  });

  it('valida o manifesto de cada adapter no boot', () => {
    // O `onModuleInit` do registry constroi um adapter de sonda e roda
    // `assertManifestValid`. Se o manifesto prometesse pix.out.send sem a
    // faceta pixTransfers, o boot teria falhado antes deste ponto — o erro
    // apareceria aqui, e nao na primeira transferencia de producao.
    const registered = moduleRef.get(ProviderRegistry).list();
    expect(registered.map((factory) => factory.slug)).toEqual(['MOCK_BANK']);
  });

  it('o registro expoe capacidade por conexao sem tocar a rede', () => {
    const registry = moduleRef.get(ProviderRegistry);
    expect(registry.supports('MOCK_BANK', 'pix.out.send')).toBe(true);
    // Declarada UNSUPPORTED no manifesto: o guard devolve 501 com a nota
    // ANTES de qualquer round-trip ao provedor.
    expect(registry.supports('MOCK_BANK', 'pix.out.scheduled')).toBe(false);
  });

  it('/healthz responde sem tocar em Postgres nem Redis', async () => {
    // Se a liveness checasse o banco, uma oscilacao de Postgres reiniciaria
    // todos os pods e transformaria degradacao em outage.
    expect(moduleRef.get(HealthController).liveness()).toEqual({ status: 'ok' });
  });

  it('/readyz reporta not_ready quando a infraestrutura nao responde', async () => {
    const result = await moduleRef.get(HealthController).readiness();
    expect(result.status).toBe('not_ready');
    expect(Object.keys(result.checks).sort()).toEqual(['postgres', 'redis']);
  });

  it('exporta as metricas de invariante do ledger', async () => {
    const rendered = await moduleRef.get(Metrics).render();
    // Esta metrica DEVE permanecer em zero. Que ela exista no registro desde o
    // boot e o que permite alertar sobre a primeira ocorrencia, em vez de
    // sobre a segunda.
    expect(rendered).toContain('baas_ledger_imbalance_detected_total');
  });
});
