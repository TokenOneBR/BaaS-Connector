import { assertInvariants } from '@baasconn/ledger';
import { BreakStatus, BreakType, Environment, ResolutionAction } from '@baasconn/taxonomy';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DOCUMENTS, startHarness, uniqueExternalId, type Harness } from '../support/harness.js';

/**
 * Conciliacao de ponta a ponta.
 *
 * O que este arquivo prova, e que nenhum teste de unidade consegue provar: um
 * PIX de entrada REAL, entregue por webhook assinado sobre HTTP, sumindo do
 * lado do provedor, produz UMA quebra — e resolve-la lanca uma compensacao
 * balanceada que nao se repete no segundo clique.
 *
 * A discrepancia e semeada por `POST /_control/forget-transaction`, que apaga
 * o pagamento do Mock Bank e deixa o razao AUTORITATIVO dele intacto. E o
 * formato mais honesto do defeito que a conciliacao existe para achar: o
 * extrato do provedor deixou de mostrar um lancamento que nos registramos.
 */
describe('conciliacao', () => {
  let harness: Harness;
  let accountId: string;
  let providerAccountId: string;

  beforeAll(async () => {
    // Regra 3 de bypass desligada: ela e avaliada antes da 5 e venceria
    // sempre, porque todo cenario de conciliacao comeca com um movimento
    // recente. Desligada, o cabecalho passa a dizer a regra que este arquivo
    // existe para provar.
    harness = await startHarness({ postMutationBypassSeconds: 0 });
    accountId = await openActiveAccount();
    providerAccountId = (
      harness.store.accounts as unknown as {
        rows: Map<string, { providerAccountId: string }>;
      }
    ).rows.get(accountId)!.providerAccountId;
  }, 60_000);

  afterAll(async () => {
    await harness?.stop();
  });

  const api = (path: string, init: RequestInit = {}) =>
    fetch(`${harness.apiUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${harness.apiKey}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });

  const injectInbound = async (amount: string) => {
    const response = await fetch(`${harness.mockBankUrl}/_control/pix/inbound`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ account_id: providerAccountId, amount }),
    });
    const body = (await response.json()) as { transaction_id: string; end_to_end_id: string };
    await harness.settle();
    return body;
  };

  /**
   * Janela de hoje, conciliada como se fossem 03:00 do dia seguinte.
   *
   * O `asOf` adiantado e o que faz a graca de liquidacao expirar: sem ele todo
   * movimento tem minutos de idade e `MISSING_ON_PROVIDER` fica corretamente
   * suprimido — a supressao e por idade do ITEM, nao pela janela.
   */
  const janela = () => {
    const fim = new Date();
    return {
      windowStart: new Date(fim.getTime() - 24 * 3_600_000),
      windowEnd: fim,
      asOf: new Date(fim.getTime() + 4 * 3_600_000),
    };
  };

  const conciliar = () => harness.reconcile({ accountId, ...janela() });

  const quebrasAbertas = async () => {
    const page = await harness.store.reconciliationBreaks.list({
      environment: Environment.HOMOLOGACAO,
      accountId,
      limit: 50,
    });
    return page.data;
  };

  const ledgerSnapshot = () => harness.store.ledger.for(Environment.HOMOLOGACAO).snapshot();

  const saldo = async () =>
    (
      (await api(`/v1/accounts/${accountId}/balance?source=ledger`).then((r) => r.json())) as {
        available: { amount: string };
      }
    ).available.amount;

  // ------------------------------------------------------------------------

  it('sem discrepancia, a conciliacao nao inventa quebra', async () => {
    await injectInbound('1500.00');
    // Uma quebra inventada e pior que quebra nenhuma: o operador para de
    // acreditar no painel e passa a ignorar a de verdade quando ela vier.
    await conciliar();
    expect(await quebrasAbertas()).toHaveLength(0);
  });

  it('esquecer uma transacao produz exatamente UMA quebra', async () => {
    const pagamento = await injectInbound('250.00');

    const forgotten = (await fetch(`${harness.mockBankUrl}/_control/forget-transaction`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ transaction_id: pagamento.transaction_id }),
    }).then((r) => r.json())) as { forgotten: boolean };
    expect(forgotten.forgotten).toBe(true);

    await conciliar();

    const abertas = await quebrasAbertas();
    expect(abertas).toHaveLength(1);
    expect(abertas[0]).toMatchObject({
      type: BreakType.MISSING_ON_PROVIDER,
      status: BreakStatus.OPEN,
      amountCents: 25_000n,
    });
  });

  it('a mesma discrepancia na execucao seguinte NAO vira uma segunda quebra', async () => {
    // A intraday roda a cada 30 min. Sem a dedup por chave derivada seriam 48
    // quebras por dia, por conta, para um unico problema.
    await conciliar();
    expect(await quebrasAbertas()).toHaveLength(1);
  });

  it('debito ausente no provedor NUNCA resolve sozinho', async () => {
    // Pode significar que registramos um pagamento que nao aconteceu. A
    // correcao — reversao no razao ou escalacao — exige julgamento humano.
    const [quebra] = await quebrasAbertas();
    expect(quebra?.resolution).toBeUndefined();
    expect(quebra?.status).toBe(BreakStatus.OPEN);
  });

  it('o razao continua fechado com a quebra aberta', async () => {
    // Quebra aberta e uma divergencia com o PROVEDOR, nao um desbalanceamento
    // nosso: se o nosso razao nao fechasse, o bug seria outro e maior.
    const { accounts, entries } = ledgerSnapshot();
    assertInvariants(accounts, entries);

    const remoto = (await fetch(`${harness.mockBankUrl}/_control/ledger/verify`).then((r) =>
      r.json(),
    )) as { ok: boolean };
    expect(remoto).toEqual({ ok: true });
  });

  it('a quebra aberta desliga o cache de saldo (regra 5 de bypass)', async () => {
    // A regra esteve implementada e DESLIGADA ate o sinal ler a tabela de
    // quebras. Com a conta sob divergencia conhecida, servir saldo do cache e
    // repetir um numero de que temos motivo para duvidar.
    const response = await api(`/v1/accounts/${accountId}/balance`);
    expect(response.headers.get('x-baas-data-source')).toBe('provider');
    expect(response.headers.get('x-baas-cache-bypass')).toBe('open_reconciliation_break');
  });

  it('resolver por ajuste lanca compensacao balanceada e escreve auditoria', async () => {
    const [quebra] = await quebrasAbertas();
    const antesEntradas = ledgerSnapshot().entries.length;
    const antesSaldo = BigInt(await saldo());

    const resolvida = await harness.resolveBreak.resolve({
      environment: Environment.HOMOLOGACAO,
      breakId: quebra!.id,
      action: ResolutionAction.CREATE_LEDGER_ADJUSTMENT,
      note: 'Provedor confirmou que o credito nao existiu; estornando o espelho.',
      resolvedBy: 'usr_e2e_admin',
    });

    expect(resolvida.status).toBe(BreakStatus.RESOLVED);
    expect(resolvida.adjustmentTransactionId).toBeTruthy();

    // Duas pernas NOVAS. Nenhuma perna anterior alterada — o razao recusa.
    const depois = ledgerSnapshot();
    expect(depois.entries.length).toBe(antesEntradas + 2);
    assertInvariants(depois.accounts, depois.entries);

    // O provedor tem MENOS do que nos, entao o espelho encolhe ate concordar.
    expect(BigInt(await saldo())).toBe(antesSaldo - 25_000n);

    const trilha = harness.store.audit.forResource(quebra!.id) as Array<{
      action: string;
      actorId: string;
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    }>;
    expect(trilha).toHaveLength(1);
    expect(trilha[0]).toMatchObject({
      action: 'reconciliation.break.create_ledger_adjustment',
      actorId: 'usr_e2e_admin',
      before: { status: BreakStatus.OPEN },
      after: { status: BreakStatus.RESOLVED },
    });
  });

  /**
   * A propriedade que o marco inteiro existe para garantir: o conserto de um
   * erro de dinheiro nao pode virar um segundo erro de dinheiro.
   */
  it('resolver de novo NAO lanca um segundo ajuste', async () => {
    const page = await harness.store.reconciliationBreaks.list({
      environment: Environment.HOMOLOGACAO,
      accountId,
      status: BreakStatus.RESOLVED,
      limit: 10,
    });
    const quebra = page.data[0]!;
    const antesEntradas = ledgerSnapshot().entries.length;
    const antesSaldo = await saldo();

    await expect(
      harness.resolveBreak.resolve({
        environment: Environment.HOMOLOGACAO,
        breakId: quebra.id,
        action: ResolutionAction.CREATE_LEDGER_ADJUSTMENT,
        note: 'Duplo clique do operador, ou dois operadores na mesma quebra.',
        resolvedBy: 'usr_e2e_outro',
      }),
    ).rejects.toThrow();

    expect(ledgerSnapshot().entries.length).toBe(antesEntradas);
    expect(await saldo()).toBe(antesSaldo);
  });

  it('resolvida, a quebra sai do painel e o cache de saldo volta a valer', async () => {
    expect(await quebrasAbertas()).toHaveLength(0);

    // Primeira leitura repovoa (a resolucao invalidou a tag da conta);
    // a segunda ja pode vir do cache, porque nao ha mais divergencia conhecida.
    await api(`/v1/accounts/${accountId}/balance`);
    const segunda = await api(`/v1/accounts/${accountId}/balance`);
    expect(segunda.headers.get('x-baas-cache-bypass')).not.toBe('open_reconciliation_break');
  });

  it('invariante global: nenhum desbalanceamento detectado na suite inteira', async () => {
    const texto = await harness.metrics.render();
    const linha = texto
      .split('\n')
      .find(
        (row) => row.startsWith('baas_ledger_imbalance_detected_total') && !row.startsWith('# '),
      );

    // Sempre 0. Qualquer incremento aqui paga alguem.
    expect(linha === undefined || linha.trim().endsWith(' 0')).toBe(true);
  });

  async function openActiveAccount(): Promise<string> {
    const externalId = uniqueExternalId();
    const created = await fetch(`${harness.apiUrl}/v1/accounts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${harness.apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `idem-${externalId}`,
      },
      body: JSON.stringify({
        external_id: externalId,
        holder: {
          type: 'BUSINESS',
          tax_id: { type: 'CNPJ', value: DOCUMENTS.cnpjAprova },
          legal_name: 'Exemplo Comercio LTDA',
          email: 'financeiro@exemplo.com.br',
          phone: { country_code: '55', area_code: '11', number: '999998888' },
          incorporation_date: '2020-01-15',
          addresses: [
            {
              postal_code: '01310100',
              street: 'Avenida Paulista',
              number: '1000',
              district: 'Bela Vista',
              city: 'Sao Paulo',
              state: 'SP',
            },
          ],
          representatives: [
            {
              role: 'ADMINISTRATOR',
              tax_id: { type: 'CPF', value: DOCUMENTS.cpfAprova },
              full_name: 'Maria Souza',
              birth_date: '1985-03-20',
              is_ultimate_beneficial_owner: true,
              is_signer: true,
            },
          ],
        },
      }),
    });

    const account = (await created.json()) as { id: string };
    await harness.settle();
    return account.id;
  }
});
