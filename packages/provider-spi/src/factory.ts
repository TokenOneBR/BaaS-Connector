import { SupportLevel, type CapabilityKey, type Environment } from '@baasconn/taxonomy';
import type { ZodType } from 'zod';

import type { CapabilityDescriptor } from './capabilities/manifest.js';
import type { ProviderContext, ProviderCredentials } from './context.js';
import type { ProviderAdapter } from './facets/index.js';
import type { ProviderIdempotency } from './idempotency.js';

/** Classes de operacao com politica propria de idempotencia e limite. */
export type OperationClass =
  | 'pix.out'
  | 'pix.refund'
  | 'accounts.create'
  | 'pix.keys.create'
  | 'pix.charge.create'
  | 'default';

export interface ProviderAdapterFactory {
  readonly slug: string;
  readonly displayName: string;
  readonly manifest: CapabilityDescriptor;

  /** Valida a forma do blob de credenciais ANTES de ele ser cifrado. */
  readonly credentialsSchema: ZodType<ProviderCredentials>;

  readonly endpoints: Readonly<Record<Environment, string>>;

  readonly idempotency: Partial<Record<OperationClass, ProviderIdempotency>>;

  /** Link para a documentacao publica de onde o adapter foi implementado. */
  readonly docsUrl?: string;

  /**
   * Chamada uma vez por operacao logica, nao por resolucao de DI.
   *
   * Precisa ser barata: sem I/O, sem buscar token. Devolver instancia ja
   * ligada evita passar o contexto por 30 assinaturas e permite ao adapter
   * guardar um HttpClient pre-configurado. Adapters sao objetos descartaveis;
   * a pressao de GC e irrelevante ao lado da chamada de rede.
   */
  create(context: ProviderContext): ProviderAdapter;
}

/**
 * Nomes de faceta e as capacidades que exigem que ela exista.
 *
 * Usado na validacao de boot e pela suite de conformidade.
 */
export const FACET_FOR_CAPABILITY: Readonly<Record<CapabilityKey, keyof ProviderAdapter>> =
  Object.freeze({
    'accounts.create.pf': 'accounts',
    'accounts.create.pj': 'accounts',
    'accounts.get': 'accounts',
    'accounts.list': 'accounts',
    'accounts.updateStatus': 'accounts',
    'accounts.close': 'accounts',
    'onboarding.kyc.submit': 'onboarding',
    'onboarding.kyb.submit': 'onboarding',
    'onboarding.status.get': 'onboarding',
    'onboarding.document.upload': 'onboarding',
    'onboarding.requirements.list': 'onboarding',
    'onboarding.requirements.fulfill': 'onboarding',
    'onboarding.pld.screening': 'onboarding',
    'balance.get': 'balance',
    'balance.blocked': 'balance',
    'pix.keys.create': 'pixKeys',
    'pix.keys.list': 'pixKeys',
    'pix.keys.delete': 'pixKeys',
    'pix.keys.claim': 'pixKeys',
    'pix.keys.resolve': 'pixKeys',
    'pix.charge.static.create': 'pixCharges',
    'pix.charge.dynamic.create': 'pixCharges',
    'pix.charge.dynamic.update': 'pixCharges',
    'pix.charge.get': 'pixCharges',
    'pix.charge.list': 'pixCharges',
    'pix.charge.cancel': 'pixCharges',
    'pix.in.receive': 'webhooks',
    'pix.out.send': 'pixTransfers',
    'pix.out.scheduled': 'pixTransfers',
    'pix.transaction.get': 'pixTransfers',
    'pix.refund.create': 'pixTransfers',
    'pix.refund.get': 'pixTransfers',
    'statement.list': 'statement',
    'statement.export': 'statement',
    'webhooks.inbound': 'webhooks',
    'webhooks.signature.verify': 'webhooks',
    'reconciliation.statement.pull': 'statement',
  });

export interface ManifestValidationIssue {
  capability: CapabilityKey;
  facet: keyof ProviderAdapter;
  problem: 'facet_missing' | 'idempotency_missing';
  message: string;
}

/**
 * Valida que o manifesto concorda com as facetas presentes.
 *
 * Roda no boot e falha rapido. Um manifesto que promete `pix.out.send` sem a
 * faceta `pixTransfers` e um bug que so apareceria na primeira transferencia
 * de producao.
 */
export function validateManifest(
  factory: ProviderAdapterFactory,
  adapter: ProviderAdapter,
): ManifestValidationIssue[] {
  const issues: ManifestValidationIssue[] = [];

  for (const [capability, facet] of Object.entries(FACET_FOR_CAPABILITY) as Array<
    [CapabilityKey, keyof ProviderAdapter]
  >) {
    if (factory.manifest[capability].level === SupportLevel.UNSUPPORTED) continue;
    if (adapter[facet] === undefined) {
      issues.push({
        capability,
        facet,
        problem: 'facet_missing',
        message: `${factory.slug} declara '${capability}' mas nao expoe a faceta '${String(facet)}'`,
      });
    }
  }

  // Provedor sem mecanismo de idempotencia precisa oferecer busca pela nossa
  // chave, senao nao ha como resolver desfecho desconhecido sem reenviar.
  const pixOut = factory.idempotency['pix.out'];
  if (
    factory.manifest['pix.out.send'].level !== SupportLevel.UNSUPPORTED &&
    pixOut?.mode === 'none' &&
    adapter.pixTransfers?.findByIdempotencyKey === undefined
  ) {
    issues.push({
      capability: 'pix.out.send',
      facet: 'pixTransfers',
      problem: 'idempotency_missing',
      message:
        `${factory.slug} declara idempotencia 'none' para pix.out mas nao implementa ` +
        `findByIdempotencyKey; sem isso um timeout so pode ser resolvido reenviando o pagamento`,
    });
  }

  return issues;
}

export function assertManifestValid(
  factory: ProviderAdapterFactory,
  adapter: ProviderAdapter,
): void {
  const issues = validateManifest(factory, adapter);
  if (issues.length > 0) {
    throw new Error(
      `Manifesto invalido em '${factory.slug}':\n` +
        issues.map((i) => `  - ${i.message}`).join('\n'),
    );
  }
}
