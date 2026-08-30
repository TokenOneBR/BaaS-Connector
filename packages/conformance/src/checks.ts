import {
  FACET_FOR_CAPABILITY,
  supportedKeys,
  validateManifest,
  type CapabilityDescriptor,
  type ProviderAdapter,
  type ProviderAdapterFactory,
} from '@baasconn/provider-spi';
import {
  BaasError,
  BaasErrorCode,
  CAPABILITY_KEYS,
  isValidEndToEndId,
  Money,
  SupportLevel,
  type CapabilityKey,
  type MoneyJSON,
} from '@baasconn/taxonomy';

/**
 * As assercoes da suite como funcoes puras.
 *
 * Extraidas de proposito: assim a propria suite pode ser testada, provando que
 * ela pega cada modo de falha que diz pegar. Uma suite de conformidade que
 * nunca foi vista falhando nao e garantia de nada.
 */

export interface CheckFailure {
  check: string;
  message: string;
}

const ok: CheckFailure[] = [];

/** 1a. Manifesto concorda com as facetas expostas. */
export function checkManifestMatchesFacets(
  factory: ProviderAdapterFactory,
  adapter: ProviderAdapter,
): CheckFailure[] {
  return validateManifest(factory, adapter).map((issue) => ({
    check: 'manifest_matches_facets',
    message: issue.message,
  }));
}

/** 1b. Toda capacidade PARTIAL ou EMULATED explica a restricao. */
export function checkPartialHasNote(manifest: CapabilityDescriptor): CheckFailure[] {
  const failures: CheckFailure[] = [];
  for (const key of CAPABILITY_KEYS) {
    const entry = manifest[key];
    const needsNote = entry.level === SupportLevel.PARTIAL || entry.level === SupportLevel.EMULATED;
    if (needsNote && !entry.note) {
      failures.push({
        check: 'partial_has_note',
        message: `'${key}' e ${entry.level} mas nao explica a restricao em 'note'; o cliente recebe a nota no corpo do erro`,
      });
    }
  }
  return failures;
}

/** 1c. Homologacao e producao apontam para lugares diferentes. */
export function checkEnvironmentsDiffer(factory: ProviderAdapterFactory): CheckFailure[] {
  const { HOMOLOGACAO, PRODUCAO } = factory.endpoints;
  const failures: CheckFailure[] = [];

  for (const [name, url] of Object.entries(factory.endpoints)) {
    if (!/^https?:\/\//.test(url)) {
      failures.push({
        check: 'environments_valid',
        message: `endpoint de ${name} nao e uma URL: ${JSON.stringify(url)}`,
      });
    }
  }

  // Apontar homologacao para producao e como se faz uma transferencia real
  // achando que era teste. Localhost e permitido (Mock Bank).
  if (
    HOMOLOGACAO === PRODUCAO &&
    !HOMOLOGACAO.includes('localhost') &&
    !HOMOLOGACAO.includes('127.0.0.1')
  ) {
    failures.push({
      check: 'environments_differ',
      message: `homologacao e producao apontam para a mesma URL (${HOMOLOGACAO})`,
    });
  }

  return failures;
}

/** 4. Status devolvido pertence ao enum canonico. */
export function checkCanonicalEnum(
  value: string | undefined,
  allowed: readonly string[],
  context: string,
): CheckFailure[] {
  if (value === undefined) return ok;
  if (allowed.includes(value)) return ok;
  return [
    {
      check: 'canonical_enum',
      message: `${context}: '${value}' nao e um valor canonico; esperado um de ${allowed.join(', ')}`,
    },
  ];
}

/**
 * 5. Precisao monetaria.
 *
 * Pega o mapper que faz `Number(valor) * 100` e transforma 150.75 em
 * 15074.999999999998, ou que devolve notacao cientifica.
 */
export function checkMoneyPrecision(money: MoneyJSON | undefined, context: string): CheckFailure[] {
  if (!money) return ok;
  const failures: CheckFailure[] = [];

  if (!/^-?\d+$/.test(money.amount)) {
    failures.push({
      check: 'money_precision',
      message: `${context}: amount '${money.amount}' nao e inteiro em unidades menores`,
    });
    return failures;
  }

  try {
    const parsed = Money.fromJSON(money);
    if (Money.fromDecimalString(parsed.toDecimalString()).cents !== parsed.cents) {
      failures.push({
        check: 'money_precision',
        message: `${context}: valor nao sobrevive ao round-trip decimal`,
      });
    }
  } catch (error) {
    failures.push({
      check: 'money_precision',
      message: `${context}: ${(error as Error).message}`,
    });
  }

  return failures;
}

/** 6. EndToEndId, quando presente, segue o formato do BACEN. */
export function checkEndToEndId(value: string | undefined, context: string): CheckFailure[] {
  if (!value) return ok;
  if (isValidEndToEndId(value)) return ok;
  return [
    {
      check: 'end_to_end_id_format',
      message: `${context}: '${value}' nao segue E + ISPB(8) + yyyyMMddHHmm + 11 alfanumericos`,
    },
  ];
}

/**
 * 7. Erro do provedor mapeia para codigo canonico especifico.
 *
 * Cair no fallback nao e falha do adapter em runtime, mas e falha de
 * conformidade: e o sinal de que a tabela de mapeamento nao cobre um codigo
 * que a fixture prova existir.
 */
export function checkErrorMapped(error: unknown, scenario: string): CheckFailure[] {
  if (!(error instanceof BaasError)) {
    return [
      {
        check: 'error_mapped',
        message: `${scenario}: lancou ${error instanceof Error ? error.constructor.name : typeof error} em vez de BaasError`,
      },
    ];
  }

  if (error.code === BaasErrorCode.PROVIDER_REJECTED) {
    return [
      {
        check: 'error_mapped',
        message:
          `${scenario}: caiu no fallback PROVIDER_REJECTED. ` +
          `Adicione o codigo '${error.provider?.code ?? 'desconhecido'}' na tabela de mapeamento do adapter`,
      },
    ];
  }

  return ok;
}

/** 8. Identidade de evento estavel entre reentregas. */
export function checkEventIdentityStable(first: string, second: string): CheckFailure[] {
  if (first === second) return ok;
  return [
    {
      check: 'event_identity_stable',
      message:
        `identidade do evento mudou entre duas entregas do mesmo payload ('${first}' e '${second}'); ` +
        `reentrega e comportamento normal do provedor e viraria evento duplicado para o cliente`,
    },
  ];
}

/** 9. Nenhum documento ou credencial vazou para log ou registro de chamada. */
export function checkNoLeaks(haystack: string, canaries: readonly string[]): CheckFailure[] {
  const leaked = canaries.filter((canary) => haystack.includes(canary));
  if (leaked.length === 0) return ok;
  return [
    {
      check: 'no_leaks',
      message: `dado sensivel apareceu em log ou registro de chamada: ${leaked.join(', ')}`,
    },
  ];
}

/** 10. O adapter usou a baseUrl do contexto, nao uma URL fixa no codigo. */
export function checkUsedInjectedBaseUrl(receivedCalls: number): CheckFailure[] {
  if (receivedCalls > 0) return ok;
  return [
    {
      check: 'used_injected_base_url',
      message:
        'nenhuma chamada chegou ao cassette server; o adapter provavelmente ignora ' +
        'ctx.baseUrl e usa URL fixa, o que impede testar e apontar para homologacao',
    },
  ];
}

/**
 * 11. Os saldos do extrato fecham com as linhas dele.
 *
 * So roda quando o adapter informa os dois saldos — sao opcionais no SPI de
 * proposito. O que esta assercao mata e o modo de falha real: um adapter que
 * devolve dois numeros plausiveis e INCOERENTES entre si. A conciliacao
 * acredita nesses numeros; um saldo ausente ela declara pulado, um saldo
 * errado ela transforma em quebra de saldo sobre ficcao, e alguem passa a
 * tarde investigando um numero que nunca existiu.
 */
export function checkStatementBalancesClose(input: {
  openingCents?: bigint;
  closingCents?: bigint;
  movementCents: bigint;
}): CheckFailure[] {
  if (input.openingCents === undefined || input.closingCents === undefined) return ok;

  const esperado = input.openingCents + input.movementCents;
  if (esperado === input.closingCents) return ok;
  return [
    {
      check: 'statement_balances_close',
      message:
        `abertura ${input.openingCents} + movimento ${input.movementCents} = ${esperado}, ` +
        `mas o fechamento informado e ${input.closingCents}; os dois saldos nao podem ` +
        'ser calculados de fontes que discordam',
    },
  ];
}

/**
 * 11. A paginacao termina, nao repete pagina e nao repete linha.
 *
 * Cursor que se repete e laco infinito; linha que se repete e movimento
 * contado duas vezes na conciliacao.
 */
export function checkPaginationTerminates(input: {
  cursors: readonly string[];
  entryIds: readonly string[];
  danglingHasMore?: boolean;
}): CheckFailure[] {
  const falhas: CheckFailure[] = [];

  if (input.danglingHasMore) {
    // `hasMore` sem cursor e beco sem saida: quem consome sabe que falta
    // pagina e nao tem como pedi-la, entao trunca a janela sabendo que esta
    // truncando — pior do que truncar por engano.
    falhas.push({
      check: 'pagination_has_more_without_cursor',
      message: 'a pagina diz `hasMore: true` e nao devolve `nextCursor`; nao ha como continuar',
    });
  }

  const cursoresUnicos = new Set(input.cursors);
  if (cursoresUnicos.size !== input.cursors.length) {
    falhas.push({
      check: 'pagination_terminates',
      message: 'o mesmo cursor foi devolvido duas vezes; paginar entraria em laco infinito',
    });
  }

  const idsUnicos = new Set(input.entryIds);
  if (idsUnicos.size !== input.entryIds.length) {
    falhas.push({
      check: 'pagination_no_duplicates',
      message: 'a mesma linha apareceu em mais de uma pagina; o movimento seria contado duas vezes',
    });
  }

  return falhas;
}

/** Facetas que precisam existir para as capacidades declaradas. */
export function requiredFacets(manifest: CapabilityDescriptor): Array<{
  capability: CapabilityKey;
  facet: keyof ProviderAdapter;
}> {
  return supportedKeys(manifest).map((capability) => ({
    capability,
    facet: FACET_FOR_CAPABILITY[capability],
  }));
}

export function assertNoFailures(failures: readonly CheckFailure[]): void {
  if (failures.length === 0) return;
  throw new Error(
    `Conformidade falhou:\n${failures.map((f) => `  [${f.check}] ${f.message}`).join('\n')}`,
  );
}
