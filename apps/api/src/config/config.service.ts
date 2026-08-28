import { Environment } from '@baasconn/taxonomy';
import { Injectable } from '@nestjs/common';

export type NodeEnv = 'development' | 'test' | 'production';

/**
 * Configuracao do conector.
 *
 * Falha no boot quando falta segredo obrigatorio em producao. Descobrir que a
 * chave mestra do KMS nao esta configurada na primeira gravacao de credencial
 * e pior do que nao subir.
 */
@Injectable()
export class ApiConfig {
  readonly nodeEnv: NodeEnv = (process.env.NODE_ENV as NodeEnv) ?? 'development';
  readonly port = Number(process.env.PORT ?? 3001);
  /** Porta separada: /metrics em listener publico e vazamento e vetor de DoS. */
  readonly metricsPort = Number(process.env.METRICS_PORT ?? 9464);

  readonly databaseUrl = process.env.DATABASE_URL ?? '';
  readonly redisUrl = process.env.REDIS_URL ?? '';

  readonly kmsDriver = (process.env.KMS_DRIVER ?? 'local') as 'local' | 'aws-kms' | 'gcp-kms' | 'azure-kv';
  readonly kmsKeyId = process.env.KMS_KEY_ID;
  readonly kmsMasterSecret = process.env.KMS_MASTER_SECRET ?? '';
  readonly blindIndexPepper = process.env.BLIND_INDEX_PEPPER ?? '';

  readonly jwtPrivateKey = process.env.JWT_PRIVATE_KEY ?? '';
  readonly jwtPublicKey = process.env.JWT_PUBLIC_KEY ?? '';
  readonly accessTokenTtlSeconds = Number(process.env.ACCESS_TOKEN_TTL ?? 900);
  readonly refreshTokenTtlSeconds = Number(process.env.REFRESH_TOKEN_TTL ?? 2_592_000);

  readonly publicBaseUrl = process.env.PUBLIC_BASE_URL ?? `http://localhost:${this.port}`;
  readonly consoleOrigin = process.env.CONSOLE_ORIGIN ?? 'http://localhost:3000';

  /** TTL do cache de saldo. Ver a regra de bypass em BalanceService. */
  readonly balanceCacheTtlSeconds = Number(process.env.BALANCE_CACHE_TTL ?? 30);
  /** Janela apos mutacao local em que o cache e ignorado, mesmo repovoado. */
  readonly postMutationBypassSeconds = Number(process.env.POST_MUTATION_BYPASS ?? 60);
  /** Versao global do cache: incrementar e o "limpar tudo" no deploy. */
  readonly cacheVersion = Number(process.env.CACHE_VERSION ?? 1);

  readonly requestTimeoutMs = Number(process.env.REQUEST_TIMEOUT_MS ?? 30_000);
  readonly signatureToleranceSeconds = Number(process.env.SIGNATURE_TOLERANCE ?? 300);

  /** Mensagem crua do provedor no corpo do erro. Off em producao. */
  readonly exposeProviderMessages = process.env.EXPOSE_PROVIDER_MESSAGES === 'true';

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  get isTest(): boolean {
    return this.nodeEnv === 'test';
  }

  /** Ambientes que este deploy atende. */
  readonly environments: readonly Environment[] = Object.freeze([
    Environment.HOMOLOGACAO,
    Environment.PRODUCAO,
  ]);

  /**
   * Valida a configuracao no boot.
   *
   * Em teste tudo tem default; em producao, faltar segredo e erro fatal.
   */
  validate(): void {
    if (this.isTest) return;

    const missing: string[] = [];
    if (!this.databaseUrl) missing.push('DATABASE_URL');
    if (!this.redisUrl) missing.push('REDIS_URL');
    if (this.kmsDriver === 'local' && !this.kmsMasterSecret) missing.push('KMS_MASTER_SECRET');
    if (this.kmsDriver !== 'local' && !this.kmsKeyId) missing.push('KMS_KEY_ID');
    if (!this.blindIndexPepper) missing.push('BLIND_INDEX_PEPPER');
    if (!this.jwtPrivateKey) missing.push('JWT_PRIVATE_KEY');

    if (missing.length > 0) {
      throw new Error(
        `Configuracao incompleta. Faltam: ${missing.join(', ')}. ` +
          `Ver .env.example e docs/guides/local-development.md.`,
      );
    }

    if (this.isProduction && this.kmsDriver === 'local') {
      throw new Error(
        'KMS_DRIVER=local em producao: a chave mestra ficaria numa variavel de ambiente. ' +
          'Use aws-kms, gcp-kms ou azure-kv.',
      );
    }
  }
}
