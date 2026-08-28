import {
  CAPABILITY_KEYS,
  SupportLevel,
  type CapabilityKey,
  type MoneyJSON,
} from '@baasconn/taxonomy';

/**
 * Restricoes que o core valida ANTES de chamar o adapter.
 *
 * Existem para transformar "o provedor vai recusar" numa mensagem util nossa,
 * em vez de um erro opaco depois de um round-trip de rede.
 */
export interface CapabilityConstraints {
  minAmount?: MoneyJSON;
  maxAmount?: MoneyJSON;
  allowedPersonTypes?: readonly string[];
  allowedPixKeyTypes?: readonly string[];
  maxExpirySeconds?: number;
  /** Campos que o provedor exige mas sao opcionais no modelo canonico. */
  requiredFields?: readonly string[];
  /** Campos do modelo canonico que este provedor ignora em silencio. */
  ignoredFields?: readonly string[];
  rateLimit?: { requests: number; perSeconds: number };
  /**
   * Quanto esperar antes de tratar uma movimentacao ausente no extrato como
   * quebra de conciliacao. PIX liquida na hora, mas extrato posta em dia util.
   */
  settlementGraceMinutes?: number;
}

export interface CapabilityEntry {
  level: SupportLevel;
  /** Aparece no corpo do erro 501 e na matriz publicada. */
  note?: string;
  constraints?: CapabilityConstraints;
  /** Link para a secao da documentacao do provedor de onde foi implementado. */
  docRef?: string;
}

export type CapabilityDescriptor = Readonly<Record<CapabilityKey, CapabilityEntry>>;

/**
 * Constroi um manifesto preenchendo como UNSUPPORTED tudo que nao foi
 * declarado.
 *
 * A exaustividade e o ponto: uma chave nova em CAPABILITY_KEYS aparece
 * automaticamente como nao suportada em todo adapter, em vez de ficar
 * `undefined` e explodir em runtime.
 */
export function defineManifest(
  overrides: Partial<Record<CapabilityKey, CapabilityEntry | SupportLevel>>,
): CapabilityDescriptor {
  const manifest = {} as Record<CapabilityKey, CapabilityEntry>;
  for (const key of CAPABILITY_KEYS) {
    const declared = overrides[key];
    manifest[key] =
      declared === undefined
        ? { level: SupportLevel.UNSUPPORTED }
        : typeof declared === 'string'
          ? { level: declared }
          : declared;
  }
  return Object.freeze(manifest);
}

export function isSupported(manifest: CapabilityDescriptor, key: CapabilityKey): boolean {
  return manifest[key].level !== SupportLevel.UNSUPPORTED;
}

/** Capacidades declaradas como suportadas, emuladas ou parciais. */
export function supportedKeys(manifest: CapabilityDescriptor): CapabilityKey[] {
  return CAPABILITY_KEYS.filter((key) => isSupported(manifest, key));
}
