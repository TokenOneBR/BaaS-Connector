import type { Environment } from '@baasconn/taxonomy';

export type IdempotencyState = 'IN_FLIGHT' | 'COMPLETED' | 'FAILED';

export interface IdempotencyRecord {
  id: string;
  environment: Environment;
  apiKeyId: string;
  endpointKey: string;
  key: string;
  requestFingerprint: string;
  state: IdempotencyState;
  /** ULID cunhado uma vez. Vira a chave de idempotencia do PROVEDOR. */
  operationId: string;
  responseStatus?: number | null;
  responseBody?: unknown;
  errorCode?: string | null;
  lockedBy?: string | null;
  leaseExpiresAt?: Date | null;
  createdAt: Date;
  completedAt?: Date | null;
  expiresAt: Date;
}

export interface ClaimResult {
  /** Nos ganhamos a operacao e devemos executar o handler. */
  claimed: boolean;
  record: IdempotencyRecord;
  /** True quando roubamos um lease abandonado: exige reconciliar antes. */
  stolen: boolean;
}

export const IDEMPOTENCY_REPOSITORY = Symbol('BAAS_IDEMPOTENCY_REPOSITORY');

export interface IdempotencyRepository {
  /** INSERT ... ON CONFLICT DO NOTHING; devolve claimed=false no conflito. */
  claim(input: {
    environment: Environment;
    apiKeyId: string;
    endpointKey: string;
    key: string;
    requestFingerprint: string;
    leaseSeconds: number;
    ttlSeconds: number;
  }): Promise<ClaimResult>;

  find(
    environment: Environment,
    endpointKey: string,
    key: string,
  ): Promise<IdempotencyRecord | undefined>;

  /** Rouba um lease vencido. Devolve undefined se outro pod ganhou a corrida. */
  stealLease(id: string, leaseSeconds: number): Promise<IdempotencyRecord | undefined>;

  renewLease(id: string, leaseSeconds: number): Promise<void>;

  complete(input: {
    id: string;
    status: number;
    body: unknown;
    state: 'COMPLETED' | 'FAILED';
    errorCode?: string;
  }): Promise<void>;

  /** Remove o registro para o retry do cliente ter tentativa nova. */
  release(id: string): Promise<void>;
}

/** TTLs por classe de rota. */
export const IDEMPOTENCY_TTL_SECONDS: Readonly<Record<string, number>> = Object.freeze({
  /**
   * Movimentacao de dinheiro: 7 dias.
   *
   * Disputa e loop de retry de cliente duram dias, e e a janela que as regras
   * de devolucao do BACEN consideram.
   */
  'pix.out': 7 * 86_400,
  'pix.refund': 7 * 86_400,
  /** Criar conta duplicada para um CPF e incidente de compliance. */
  'accounts.create': 7 * 86_400,
  'onboarding.submit': 72 * 3_600,
  'pix.keys.create': 24 * 3_600,
  'pix.charge.create': 24 * 3_600,
  default: 24 * 3_600,
});

export const DEFAULT_LEASE_SECONDS = 90;

/** Rotas em que a chave de idempotencia e OBRIGATORIA. */
export const IDEMPOTENCY_REQUIRED_CLASSES: ReadonlySet<string> = new Set([
  'pix.out',
  'pix.refund',
  'accounts.create',
  'onboarding.submit',
]);
