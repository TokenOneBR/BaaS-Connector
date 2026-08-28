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

/**
 * Operacoes cujo `where` aceita filtro composto.
 *
 * Aqui o ambiente entra dentro de um `AND`, que compoe com o que o chamador
 * ja tenha escrito sem sobrescrever nada.
 */
const FILTERABLE_OPERATIONS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'deleteMany',
]);

/**
 * Operacoes que exigem o seletor UNICO no topo do `where`.
 *
 * Aqui o ambiente precisa ser mesclado no mesmo nivel: envolver o `where` num
 * `AND` tira o campo unico do topo e o Prisma recusa com "Argument where needs
 * at least one of ...". O Prisma 5+ aceita filtros adicionais ao lado do
 * seletor unico, entao a mesclagem e suficiente e continua sendo uma leitura
 * indexada.
 */
const UNIQUE_SELECTOR_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'update',
  'delete',
  'upsert',
]);

const CREATE_DATA_OPERATIONS = new Set(['create', 'createMany']);

export interface ScopeArgs {
  where?: Record<string, unknown>;
  data?: Record<string, unknown> | Record<string, unknown>[];
  create?: Record<string, unknown>;
}

const injectEnvironment = (
  data: Record<string, unknown>,
  environment: Environment,
): Record<string, unknown> => ({ environment, ...data });

/**
 * Injeta o filtro de ambiente nos argumentos de uma operacao.
 *
 * Existe para nenhum caminho de codigo precisar LEMBRAR de filtrar. Um
 * `where` esquecido num servico e como dado de homologacao vaza para uma
 * resposta de producao, e o contrario e pior.
 *
 * O ambiente e injetado ANTES do que o chamador passou (`{ environment,
 * ...data }`), entao um `environment` explicito no repositorio vence. Isso e
 * deliberado: o filtro explicito e o contrato, este helper e a rede.
 */
export function applyEnvironmentScope(
  model: string,
  operation: string,
  args: ScopeArgs,
  environment: Environment,
): ScopeArgs {
  if (!ENVIRONMENT_SCOPED_MODELS.has(model)) return args;

  if (FILTERABLE_OPERATIONS.has(operation)) {
    return { ...args, where: { AND: [args.where ?? {}, { environment }] } };
  }

  if (UNIQUE_SELECTOR_OPERATIONS.has(operation)) {
    const scoped: ScopeArgs = { ...args, where: { environment, ...(args.where ?? {}) } };
    // O `upsert` carrega os dois lados: filtra pelo unico e cria com ambiente.
    if (operation === 'upsert' && scoped.create) {
      scoped.create = injectEnvironment(scoped.create, environment);
    }
    return scoped;
  }

  if (CREATE_DATA_OPERATIONS.has(operation)) {
    return {
      ...args,
      data: Array.isArray(args.data)
        ? args.data.map((row) => injectEnvironment(row, environment))
        : injectEnvironment(args.data ?? {}, environment),
    };
  }

  return args;
}
