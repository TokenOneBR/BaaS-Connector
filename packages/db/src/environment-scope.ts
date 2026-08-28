import type { Environment } from '@prisma/client';

/**
 * Modelos particionados por ambiente.
 *
 * Nenhuma consulta pode cruzar HOMOLOGACAO e PRODUCAO. Como o projeto e
 * single-tenant, `environment` e a UNICA dimensao de particionamento, e por
 * isso ela lidera toda chave composta.
 */
export const ENVIRONMENT_SCOPED_MODELS: ReadonlySet<string> = new Set([
  'ProviderConnection',
  'ApiKey',
  'AccountHolder',
  'Address',
  'LegalRepresentative',
  'Account',
  'AccountBalance',
  'OnboardingCase',
  'KycDocument',
  'ComplianceScreening',
  'PixKey',
  'PixCharge',
  'Transaction',
  'PixDetail',
  'IdempotencyRecord',
  'ProviderOperation',
  'InboundWebhookEvent',
  'OutboxEvent',
  'WebhookEndpoint',
  'AuditLog',
  'AuditAnchor',
  'ProviderCall',
  'LedgerAccount',
  'LedgerTransaction',
  'LedgerEntry',
  'LedgerBalanceSnapshot',
  'ReconciliationRun',
  'ReconciliationBreak',
]);

const READ_OPERATIONS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
]);

const FILTERED_WRITE_OPERATIONS = new Set(['updateMany', 'deleteMany', 'update', 'delete']);
const CREATE_OPERATIONS = new Set(['create', 'createMany', 'upsert']);

export interface ScopeArgs {
  where?: Record<string, unknown>;
  data?: Record<string, unknown> | Record<string, unknown>[];
}

/**
 * Injeta o filtro de ambiente nos argumentos de uma operacao.
 *
 * Existe para nenhum caminho de codigo precisar LEMBRAR de filtrar. Um
 * `where` esquecido num servico e como dado de homologacao vaza para uma
 * resposta de producao, e o contrario e pior.
 */
export function applyEnvironmentScope(
  model: string,
  operation: string,
  args: ScopeArgs,
  environment: Environment,
): ScopeArgs {
  if (!ENVIRONMENT_SCOPED_MODELS.has(model)) return args;

  if (READ_OPERATIONS.has(operation) || FILTERED_WRITE_OPERATIONS.has(operation)) {
    return { ...args, where: { AND: [args.where ?? {}, { environment }] } };
  }

  if (CREATE_OPERATIONS.has(operation)) {
    const inject = (data: Record<string, unknown>) => ({ environment, ...data });
    return {
      ...args,
      data: Array.isArray(args.data) ? args.data.map(inject) : inject(args.data ?? {}),
    };
  }

  return args;
}
