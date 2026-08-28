import { Registry } from 'prom-client';
import { describe, expect, it } from 'vitest';

import {
  contextBindings,
  enrichContext,
  getContext,
  requireContext,
  runWithContext,
  type RequestContext,
} from './context.js';
import { createLogger, deepRedact, maskSensitive } from './logger.js';
import { Metrics } from './metrics.js';

const baseContext = (): RequestContext => ({
  requestId: 'req_01',
  correlationId: 'corr_01',
  environment: 'HOMOLOGACAO',
  startedAtMs: 0,
});

describe('contexto de requisicao', () => {
  it('propaga por toda a cadeia assincrona', async () => {
    await runWithContext(baseContext(), async () => {
      await Promise.resolve();
      expect(getContext()?.requestId).toBe('req_01');
    });
  });

  it('nao vaza para fora do escopo', () => {
    runWithContext(baseContext(), () => undefined);
    expect(getContext()).toBeUndefined();
  });

  it('requireContext explica que trabalho de background precisa ser envolvido', () => {
    expect(() => requireContext()).toThrow(/runWithContext/);
  });

  it('camadas internas enriquecem o contexto', () => {
    runWithContext(baseContext(), () => {
      enrichContext({ provider: 'CELCOIN', operationId: 'opr_01' });
      expect(getContext()).toMatchObject({ provider: 'CELCOIN', operationId: 'opr_01' });
    });
  });

  it('produz os bindings que todo log carrega', () => {
    runWithContext({ ...baseContext(), apiKeyId: 'key_01' }, () => {
      expect(contextBindings()).toMatchObject({
        request_id: 'req_01',
        correlation_id: 'corr_01',
        api_key_id: 'key_01',
      });
    });
  });

  it('devolve bindings vazios fora de contexto, sem lancar', () => {
    expect(contextBindings()).toEqual({});
  });
});

describe('redacao do logger', () => {
  /** Captura o que o pino realmente escreveria. */
  function capture(payload: Record<string, unknown>): string {
    const lines: string[] = [];
    const logger = createLogger({
      service: 'test',
      destination: { write: (line: string) => lines.push(line) },
    });
    logger.info(payload);
    return lines.join('\n');
  }

  it('redige documento no TOPO do objeto', () => {
    // A opcao redact.paths do pino falharia aqui: `*.cpf` casa exatamente um
    // nivel de aninhamento e deixa passar a chave no topo.
    const line = capture({ cpf: '52998224725' });
    expect(line).not.toContain('52998224725');
  });

  it('redige documento em profundidade arbitraria', () => {
    const line = capture({ a: { b: { c: { d: { holder: { cpf: '52998224725' } } } } } });
    expect(line).not.toContain('52998224725');
  });

  it('preserva os campos nao sensiveis', () => {
    const line = capture({ holder: { cpf: '52998224725', name: 'Maria' } });
    expect(line).not.toContain('52998224725');
    expect(line).toContain('Maria');
  });

  it('redige credencial de provedor', () => {
    const line = capture({ credentials: { clientSecret: 'super-secreto' } });
    expect(line).not.toContain('super-secreto');
  });

  it('redige header de autorizacao', () => {
    const line = capture({ req: { headers: { authorization: 'Bearer abc123' } } });
    expect(line).not.toContain('abc123');
  });

  it('redige dentro de array', () => {
    const line = capture({ holders: [{ cpf: '52998224725' }, { cpf: '11222333000181' }] });
    expect(line).not.toContain('52998224725');
    expect(line).not.toContain('11222333000181');
  });

  it('remove blob de documento em vez de mascarar', () => {
    const line = capture({ upload: { fileContent: 'AAAA'.repeat(500), kind: 'RG' } });
    expect(line).not.toContain('AAAA');
    expect(line).toContain('RG');
  });

  it('sobrevive a objeto ciclico sem travar o processo', () => {
    const node: Record<string, unknown> = { cpf: '52998224725' };
    node.self = node;
    const line = capture({ node });
    expect(line).toContain('[CIRCULAR]');
    expect(line).not.toContain('52998224725');
  });

  it('um objeto com todos os campos sensiveis nao vaza nenhum', () => {
    // O teste que justifica redigir por NOME DE CHAVE em vez de por caminho:
    // um log acidental de objeto inteiro continua seguro.
    const line = capture({
      cpf: '52998224725',
      cnpj: '11222333000181',
      password: 'senha-do-usuario',
      clientSecret: 'segredo-do-cliente',
      accessToken: 'token-de-acesso',
      pixKey: 'chave@exemplo.com',
      cardNumber: '4111111111111111',
      motherName: 'Maria Silva Santos',
      email: 'lnugnes@tokenone.com.br',
    });

    for (const leak of [
      '52998224725',
      '11222333000181',
      'senha-do-usuario',
      'segredo-do-cliente',
      'token-de-acesso',
      'chave@exemplo.com',
      '4111111111111111',
      'Maria Silva Santos',
      'lnugnes@',
    ]) {
      expect(line, `vazou ${leak}`).not.toContain(leak);
    }
  });

  it('mascara preservando o final, que e o que o suporte usa', () => {
    expect(maskSensitive('529.982.247-25')).toBe('***.***.247-25');
    expect(maskSensitive('lnugnes@tokenone.com.br')).toBe('l******@tokenone.com.br');
    expect(maskSensitive('curto')).toBe('[REDACTED]');
  });

  it('deepRedact preserva valores primitivos e datas', () => {
    const date = new Date('2026-08-28T12:00:00Z');
    expect(deepRedact({ amount: 1000, active: true, at: date })).toEqual({
      amount: 1000,
      active: true,
      at: date,
    });
  });
});

describe('metricas', () => {
  it('registra as metricas de invariante, que sao a razao do ledger existir', async () => {
    const metrics = new Metrics({ registry: new Registry(), defaultMetrics: false });
    const rendered = await metrics.render();
    expect(rendered).toContain('baas_ledger_imbalance_detected_total');
    expect(rendered).toContain('DEVE permanecer em zero');
  });

  it('registra o SLI primario de dependencia de provedor', async () => {
    const metrics = new Metrics({ registry: new Registry(), defaultMetrics: false });
    metrics.providerRequestDuration
      .labels('CELCOIN', 'pix.out.send', 'HOMOLOGACAO', 'ok')
      .observe(0.42);
    const rendered = await metrics.render();
    expect(rendered).toContain('baas_provider_request_duration_seconds');
    expect(rendered).toContain('provider="CELCOIN"');
  });

  it('conta falha de assinatura separadamente, porque e evento de seguranca', async () => {
    const metrics = new Metrics({ registry: new Registry(), defaultMetrics: false });
    metrics.webhookSignatureFailures.labels('CELCOIN').inc();
    expect(await metrics.render()).toContain(
      'baas_webhook_signature_failures_total{provider="CELCOIN"} 1',
    );
  });

  it('expoe o timestamp da ultima conciliacao, para detectar obsolescencia', async () => {
    const metrics = new Metrics({ registry: new Registry(), defaultMetrics: false });
    metrics.reconciliationLastSuccess.labels('CELCOIN').set(1_756_400_000);
    expect(await metrics.render()).toContain('baas_reconciliation_last_success_timestamp_seconds');
  });

  it('nao colide nomes de metrica entre instancias', () => {
    expect(() => {
      new Metrics({ registry: new Registry(), defaultMetrics: false });
      new Metrics({ registry: new Registry(), defaultMetrics: false });
    }).not.toThrow();
  });
});
