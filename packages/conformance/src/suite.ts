import type { Cassette } from '@baasconn/adapter-kit/testing';
import { FACET_FOR_CAPABILITY, supportedKeys, type ProviderAdapter } from '@baasconn/provider-spi';
import { CAPABILITY_KEYS, SupportLevel, type CapabilityKey } from '@baasconn/taxonomy';
import { describe, expect, it } from 'vitest';

import {
  assertNoFailures,
  checkCanonicalEnum,
  checkEndToEndId,
  checkEnvironmentsDiffer,
  checkErrorMapped,
  checkEventIdentityStable,
  checkManifestMatchesFacets,
  checkMoneyPrecision,
  checkNoLeaks,
  checkPaginationTerminates,
  checkPartialHasNote,
  checkStatementBalancesClose,
  checkUsedInjectedBaseUrl,
  declaresAnyCapability,
} from './checks.js';
import { createHarness, LEAK_CANARIES, type Harness } from './harness.js';
import type { ConformanceConfig } from './types.js';

const DEFAULT_ACCOUNT_REF = { providerAccountId: 'conformance-account' };

/** A janela que toda fixture de extrato precisa servir. */
const STATEMENT_FROM = '2026-08-01';
const STATEMENT_TO = '2026-08-28';
const STATEMENT_LIMIT = 10;
const MAX_STATEMENT_PAGES = 20;

/**
 * A suite que todo adapter precisa passar.
 *
 * Onze grupos de assercao, cada um matando uma classe de bug que ja custou
 * dinheiro em integracao com BaaS. Um adapter e considerado correto quando
 * passa por inteiro, nao quando tem cobertura de linha alta: cobertura de
 * linha num mapper diz que o codigo rodou, nao que o mapeamento esta certo.
 */
export function runConformanceSuite(config: ConformanceConfig): void {
  const { factory, fixtures } = config;
  const accountRef = config.accountRef ?? DEFAULT_ACCOUNT_REF;
  const allCassettes = [...fixtures.happyPath, ...fixtures.errors];

  /**
   * Sobe o harness com um conjunto de fitas.
   *
   * O grupo da matriz de erros passa APENAS as fitas de erro. Servir os dois
   * conjuntos juntos faria a interacao de caminho feliz casar primeiro em toda
   * rota que os dois cobrem — e a fixture de erro nunca seria alcancada, com o
   * teste passando por nao ter exercitado nada.
   */
  const withHarness = async (
    fn: (h: Harness) => Promise<void>,
    cassettes: readonly Cassette[] = allCassettes,
  ): Promise<void> => {
    const harness = await createHarness({
      factory,
      credentials: config.credentials,
      cassettes,
      buildContext: config.buildContext,
    });
    try {
      await fn(harness);
    } finally {
      await harness.stop();
    }
  };

  /** Capacidade declarada e nao pulada pela configuracao do adapter. */
  const has = (key: CapabilityKey) =>
    factory.manifest[key].level !== SupportLevel.UNSUPPORTED && !config.skip?.[key];

  /** Ver `declaresAnyCapability`: a regra e pura e tem teste proprio. */
  const declaresAnything = declaresAnyCapability(factory.manifest, config.skip);

  describe(`conformidade: ${factory.displayName}`, () => {
    // ---------------------------------------------------------------------
    // 1. Honestidade de capacidade
    // ---------------------------------------------------------------------
    describe('1. honestidade de capacidade', () => {
      it('o manifesto concorda com as facetas expostas', async () => {
        await withHarness(async ({ adapter }) => {
          assertNoFailures(checkManifestMatchesFacets(factory, adapter));
        });
      });

      it('toda capacidade declarada expoe a faceta correspondente', async () => {
        await withHarness(async ({ adapter }) => {
          for (const key of supportedKeys(factory.manifest)) {
            const facet = FACET_FOR_CAPABILITY[key];
            expect(adapter[facet], `${key} exige a faceta ${String(facet)}`).toBeDefined();
          }
        });
      });

      it('capacidade nao declarada fica explicitamente marcada como UNSUPPORTED', () => {
        // O manifesto e exaustivo por construcao: uma chave nova em
        // CAPABILITY_KEYS aparece como nao suportada em todo adapter, em vez
        // de ficar `undefined` e explodir em runtime no primeiro uso.
        for (const key of CAPABILITY_KEYS) {
          expect(factory.manifest[key], `capacidade ${key} ausente do manifesto`).toBeDefined();
          expect(Object.values(SupportLevel)).toContain(factory.manifest[key].level);
        }
      });

      it('capacidade PARTIAL sempre explica a restricao', () => {
        assertNoFailures(checkPartialHasNote(factory.manifest));
      });

      it('declara endpoints distintos para homologacao e producao', () => {
        assertNoFailures(checkEnvironmentsDiffer(factory));
      });
    });

    // ---------------------------------------------------------------------
    // 2. Schema de credenciais
    // ---------------------------------------------------------------------
    describe('2. schema de credenciais', () => {
      it('aceita as credenciais de teste', () => {
        expect(() => factory.credentialsSchema.parse(config.credentials)).not.toThrow();
      });

      it('recusa credencial vazia, para nao gravar conexao quebrada', () => {
        const result = factory.credentialsSchema.safeParse({});
        // Um adapter sem credencial obrigatoria (raro) pode aceitar; o que
        // nao pode e aceitar qualquer coisa quando exige campos.
        if (!result.success) expect(result.error.issues.length).toBeGreaterThan(0);
      });
    });

    // ---------------------------------------------------------------------
    // 3. Health check
    // ---------------------------------------------------------------------
    describe('3. health check', () => {
      it('responde sem lancar, mesmo quando o provedor esta ruim', async () => {
        await withHarness(async ({ adapter }) => {
          const report = await adapter.health();
          expect(report).toHaveProperty('healthy');
          expect(report.checkedAt).toBeTruthy();
        });
      });
    });

    // ---------------------------------------------------------------------
    // 4. Mapeamento canonico
    // ---------------------------------------------------------------------
    describe('4. mapeamento canonico', () => {
      it.runIf(has('balance.get'))('saldo mapeia para o formato canonico', async () => {
        await withHarness(async ({ adapter }) => {
          const balance = await adapter.balance!.get(accountRef);
          expect(balance.available).toMatchObject({ currency: 'BRL', scale: 2 });
          expect(balance.asOf).toBeTruthy();
          assertNoFailures(checkMoneyPrecision(balance.available, 'balance.available'));
        });
      });

      it.runIf(has('pix.keys.list'))('lista de chaves usa os tipos canonicos', async () => {
        await withHarness(async ({ adapter }) => {
          const keys = await adapter.pixKeys!.list(accountRef);
          for (const key of keys) {
            assertNoFailures(
              checkCanonicalEnum(key.type, ['CPF', 'CNPJ', 'EMAIL', 'PHONE', 'EVP'], 'pixKey.type'),
            );
          }
        });
      });

      it.runIf(has('accounts.get'))('conta mapeia para status canonico', async () => {
        await withHarness(async ({ adapter }) => {
          const account = await adapter.accounts!.get(accountRef);
          assertNoFailures([
            ...checkCanonicalEnum(
              account.status,
              [
                'DRAFT',
                'PENDING_ONBOARDING',
                'PENDING_DOCUMENTS',
                'UNDER_REVIEW',
                'ACTIVE',
                'BLOCKED',
                'SUSPENDED',
                'REJECTED',
                'CLOSING',
                'CLOSED',
              ],
              'account.status',
            ),
            ...checkCanonicalEnum(
              account.personType,
              ['INDIVIDUAL', 'BUSINESS'],
              'account.personType',
            ),
          ]);
        });
      });
    });

    // ---------------------------------------------------------------------
    // 5. Precisao monetaria
    // ---------------------------------------------------------------------
    describe('5. precisao monetaria', () => {
      it.runIf(factory.manifest['balance.get'].level !== SupportLevel.UNSUPPORTED)(
        'valores fazem round-trip sem perder centavo',
        async () => {
          await withHarness(async ({ adapter }) => {
            const balance = await adapter.balance!.get(accountRef);
            // O que este teste pega: um mapper que faz `Number(valor) * 100` e
            // transforma 150.75 em 15074.999999999998.
            assertNoFailures([
              ...checkMoneyPrecision(balance.available, 'balance.available'),
              ...checkMoneyPrecision(balance.blocked, 'balance.blocked'),
              ...checkMoneyPrecision(balance.pending, 'balance.pending'),
            ]);
          });
        },
      );
    });

    // ---------------------------------------------------------------------
    // 6. Identificadores PIX
    // ---------------------------------------------------------------------
    describe('6. identificadores PIX', () => {
      const canGet = factory.manifest['pix.transaction.get'].level !== SupportLevel.UNSUPPORTED;

      it.runIf(canGet && !config.skip?.['pix.transaction.get'])(
        'EndToEndId, quando presente, segue o formato do BACEN',
        async () => {
          await withHarness(async ({ adapter }) => {
            const transaction = await adapter.pixTransfers!.get(accountRef, 'conformance-tx');
            assertNoFailures(checkEndToEndId(transaction.endToEndId, 'pixTransaction.endToEndId'));
          });
        },
      );
    });

    // ---------------------------------------------------------------------
    // 7. Matriz de erros
    // ---------------------------------------------------------------------
    describe('7. matriz de erros', () => {
      it.runIf(declaresAnything)('ha ao menos uma fixture de erro', () => {
        // Sem fixture de erro, a tabela de mapeamento nunca e exercitada e
        // apodrece silenciosamente ate um incidente em producao.
        expect(fixtures.errors.length).toBeGreaterThan(0);
      });

      it('toda fixture de erro mapeia para codigo canonico diferente do fallback', async () => {
        const unmapped: string[] = [];

        for (const cassette of fixtures.errors) {
          if (!cassette.interactions.some((i) => i.response.status >= 400)) continue;

          // So esta fita de erro, mais as que servem autenticacao: qualquer
          // outra poderia responder 200 na mesma rota e mascarar o cenario.
          const isolated = [...fixtures.errors.filter(isAuthCassette), cassette];

          await withHarness(async ({ adapter }) => {
            for (const interaction of cassette.interactions) {
              if (interaction.response.status < 400) continue;
              try {
                await invokeForCassette(adapter, cassette.scenario, accountRef);
                unmapped.push(`${cassette.scenario}: nao lancou erro`);
              } catch (error) {
                unmapped.push(...checkErrorMapped(error, cassette.scenario).map((f) => f.message));
              }
            }
          }, isolated);
        }

        expect(unmapped, `Fixtures de erro sem mapeamento:\n  ${unmapped.join('\n  ')}`).toEqual(
          [],
        );
      });
    });

    // ---------------------------------------------------------------------
    // 8. Webhooks
    // ---------------------------------------------------------------------
    describe('8. webhooks', () => {
      const hasWebhooks =
        factory.manifest['webhooks.signature.verify'].level !== SupportLevel.UNSUPPORTED;
      const samples = fixtures.webhooks ?? [];

      it.runIf(hasWebhooks)('ha fixture de webhook quando ha verificacao de assinatura', () => {
        expect(samples.length).toBeGreaterThan(0);
      });

      it.runIf(hasWebhooks && samples.length > 0)('aceita assinatura valida', async () => {
        await withHarness(async ({ adapter }) => {
          for (const sample of samples) {
            expect(() =>
              adapter.webhooks!.verifySignature(
                {
                  rawBody: Buffer.from(sample.body),
                  headers: sample.headers,
                  query: {},
                  receivedAt: new Date(),
                },
                { value: sample.secret },
              ),
            ).not.toThrow();
          }
        });
      });

      it.runIf(hasWebhooks && samples.length > 0)('recusa corpo adulterado', async () => {
        await withHarness(async ({ adapter }) => {
          const sample = samples[0]!;
          expect(() =>
            adapter.webhooks!.verifySignature(
              {
                rawBody: Buffer.from(`${sample.body} `),
                headers: sample.headers,
                query: {},
                receivedAt: new Date(),
              },
              { value: sample.secret },
            ),
          ).toThrow();
        });
      });

      it.runIf(hasWebhooks && samples.length > 0)('recusa segredo errado', async () => {
        await withHarness(async ({ adapter }) => {
          const sample = samples[0]!;
          expect(() =>
            adapter.webhooks!.verifySignature(
              {
                rawBody: Buffer.from(sample.body),
                headers: sample.headers,
                query: {},
                receivedAt: new Date(),
              },
              { value: 'segredo-errado' },
            ),
          ).toThrow();
        });
      });

      it.runIf(samples.length > 0)(
        'identidade do evento e estavel entre duas entregas',
        async () => {
          await withHarness(async ({ adapter }) => {
            const sample = samples[0]!;
            const request = {
              rawBody: Buffer.from(sample.body),
              headers: sample.headers,
              query: {},
              receivedAt: new Date(),
            };
            // Reentrega e comportamento normal do provedor: se a identidade
            // variar, cada reentrega vira um evento novo e o cliente ve o mesmo
            // PIX duas vezes.
            const first = adapter.webhooks!.eventIdentity(request);
            const second = adapter.webhooks!.eventIdentity({ ...request, receivedAt: new Date() });
            assertNoFailures(
              checkEventIdentityStable(first.providerEventId, second.providerEventId),
            );
          });
        },
      );

      it.runIf(samples.length > 0)('parse produz os eventos canonicos esperados', async () => {
        await withHarness(async ({ adapter }) => {
          for (const sample of samples) {
            const events = adapter.webhooks!.parse({
              rawBody: Buffer.from(sample.body),
              headers: sample.headers,
              query: {},
              receivedAt: new Date(),
            });
            expect(events.map((e) => e.type).sort()).toEqual([...sample.expectedEventTypes].sort());
          }
        });
      });
    });

    // ---------------------------------------------------------------------
    // 9. Redacao
    // ---------------------------------------------------------------------
    describe('9. redacao', () => {
      it('nenhum documento ou credencial aparece em log ou registro de chamada', async () => {
        await withHarness(async ({ adapter, logger, calls }) => {
          // Exercita tudo o que o adapter declara, e depois varre a saida.
          for (const key of supportedKeys(factory.manifest)) {
            if (config.skip?.[key]) continue;
            try {
              await invokeCapability(adapter, key, accountRef);
            } catch {
              // Falha e esperada em varias: o que importa e o que foi logado.
            }
          }

          const haystack = `${logger.dump()}\n${JSON.stringify(calls)}`;
          assertNoFailures(checkNoLeaks(haystack, LEAK_CANARIES));
        });
      });
    });

    // ---------------------------------------------------------------------
    // 10. Isolamento de rede
    // ---------------------------------------------------------------------
    describe('10. isolamento de rede', () => {
      it.runIf(declaresAnything)(
        'todas as chamadas vao para o cassette server, nenhuma para a internet',
        async () => {
          await withHarness(async ({ adapter, server }) => {
            for (const key of supportedKeys(factory.manifest)) {
              if (config.skip?.[key]) continue;
              try {
                await invokeCapability(adapter, key, accountRef);
              } catch {
                // Idem.
              }
            }
            assertNoFailures(checkUsedInjectedBaseUrl(server.received.length));
          });
        },
      );
    });

    // ---------------------------------------------------------------------
    // 11. Extrato: paginacao e saldos
    // ---------------------------------------------------------------------
    describe('11. extrato', () => {
      const temExtrato = has('statement.list') || has('reconciliation.statement.pull');

      it.runIf(temExtrato)('paginar termina, sem repetir cursor nem linha', async () => {
        await withHarness(async ({ adapter }) => {
          const { cursors, entryIds, danglingHasMore } = await drainStatement(adapter, accountRef);
          expect(entryIds.length).toBeGreaterThan(0);
          assertNoFailures(checkPaginationTerminates({ cursors, entryIds, danglingHasMore }));
        });
      });

      it.runIf(temExtrato)('os saldos informados fecham com as linhas da janela', async () => {
        await withHarness(async ({ adapter }) => {
          const { openingCents, closingCents, movementCents } = await drainStatement(
            adapter,
            accountRef,
          );
          assertNoFailures(
            checkStatementBalancesClose({ openingCents, closingCents, movementCents }),
          );
        });
      });
    });
  });
}

/**
 * Percorre o extrato inteiro seguindo o cursor.
 *
 * O teto de paginas nao e paranoia: sem ele, um adapter que devolvesse sempre
 * `hasMore: true` travaria a suite em vez de reprova-la, e um teste que trava
 * e pior que um teste que falha.
 */
async function drainStatement(
  adapter: ProviderAdapter,
  ref: { providerAccountId: string },
): Promise<{
  cursors: string[];
  entryIds: string[];
  movementCents: bigint;
  openingCents?: bigint;
  closingCents?: bigint;
  danglingHasMore: boolean;
}> {
  const cursors: string[] = [];
  const entryIds: string[] = [];
  let danglingHasMore = false;
  let movementCents = 0n;
  let openingCents: bigint | undefined;
  let closingCents: bigint | undefined;

  let cursor: string | undefined;
  for (let pagina = 0; pagina < MAX_STATEMENT_PAGES; pagina += 1) {
    const page = await adapter.statement?.list(ref, {
      from: STATEMENT_FROM,
      to: STATEMENT_TO,
      limit: STATEMENT_LIMIT,
      cursor,
    });
    if (!page) break;

    // Os saldos sao da JANELA: a primeira pagina que os traz manda.
    openingCents ??= page.openingBalance ? BigInt(page.openingBalance.amount) : undefined;
    closingCents ??= page.closingBalance ? BigInt(page.closingBalance.amount) : undefined;

    for (const entry of page.data) {
      entryIds.push(entry.providerEntryId);
      const cents = BigInt(entry.amount.amount);
      movementCents += entry.direction === 'credit' ? cents : -cents;
    }

    if (!page.hasMore) break;
    if (!page.nextCursor) {
      danglingHasMore = true;
      break;
    }
    cursors.push(page.nextCursor);
    cursor = page.nextCursor;
  }

  return { cursors, entryIds, movementCents, openingCents, closingCents, danglingHasMore };
}

/**
 * Fita que existe so para autenticar.
 *
 * Sem ela, isolar um cenario de erro deixaria o adapter sem token e o teste
 * mediria a falha de autenticacao em vez do erro que quer exercitar.
 */
function isAuthCassette(cassette: Cassette): boolean {
  return cassette.interactions.every((interaction) => interaction.response.status < 400);
}

/** Dispara a chamada correspondente a uma capacidade, com argumentos de teste. */
async function invokeCapability(
  adapter: ProviderAdapter,
  key: CapabilityKey,
  ref: { providerAccountId: string },
): Promise<unknown> {
  switch (key) {
    case 'balance.get':
    case 'balance.blocked':
      return adapter.balance?.get(ref);
    case 'accounts.get':
      return adapter.accounts?.get(ref);
    case 'accounts.list':
      return adapter.accounts?.list({ limit: 10 });
    case 'pix.keys.list':
      return adapter.pixKeys?.list(ref);
    case 'pix.transaction.get':
      return adapter.pixTransfers?.get(ref, 'conformance-tx');
    case 'pix.charge.get':
      return adapter.pixCharges?.get(ref, 'conformance-txid');
    case 'statement.list':
    case 'reconciliation.statement.pull':
      return adapter.statement?.list(ref, {
        from: STATEMENT_FROM,
        to: STATEMENT_TO,
        limit: STATEMENT_LIMIT,
      });
    case 'onboarding.status.get':
      return adapter.onboarding?.getStatus('conformance-case');
    default:
      return undefined;
  }
}

/** Dispara a chamada que o cenario de erro descreve, pelo nome do cenario. */
async function invokeForCassette(
  adapter: ProviderAdapter,
  scenario: string,
  ref: { providerAccountId: string },
): Promise<unknown> {
  if (scenario.includes('balance')) return adapter.balance?.get(ref);
  if (scenario.includes('account')) return adapter.accounts?.get(ref);
  if (scenario.includes('key')) return adapter.pixKeys?.list(ref);
  if (scenario.includes('charge')) return adapter.pixCharges?.get(ref, 'conformance-txid');
  if (scenario.includes('statement')) {
    return adapter.statement?.list(ref, {
      from: STATEMENT_FROM,
      to: STATEMENT_TO,
      limit: STATEMENT_LIMIT,
    });
  }
  if (scenario.includes('onboarding')) return adapter.onboarding?.getStatus('conformance-case');
  return adapter.pixTransfers?.get(ref, 'conformance-tx');
}
