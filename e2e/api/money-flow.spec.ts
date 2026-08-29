import { assertInvariants } from '@baasconn/ledger';
import { Environment } from '@baasconn/taxonomy';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DOCUMENTS, startHarness, uniqueExternalId, type Harness } from '../support/harness.js';

/**
 * Fluxo dourado do dinheiro.
 *
 * Continua onde o de cadastro parou: conta ATIVA -> chave Pix -> Pix de
 * entrada -> saldo -> Pix de saida -> liquidacao por webhook -> extrato. Os
 * caminhos NEGATIVOS sao a parte que importa: saldo insuficiente sem
 * lancamento no razao, erro do provedor sem debito duplo, e desfecho
 * desconhecido com o hold mantido.
 */
describe('fluxo dourado de dinheiro', () => {
  let harness: Harness;
  let accountId: string;
  /** Conta de destino, com chave registrada: o DICT do Mock Bank recusa chave
   * inexistente com 404, que e o erro mais comum de Pix out na vida real. */
  let destinationKey: string;

  beforeAll(async () => {
    harness = await startHarness();
    accountId = await openActiveAccount();

    const payee = await openActiveAccount();
    destinationKey = 'recebedor@exemplo.test';
    await fetch(`${harness.apiUrl}/v1/accounts/${payee}/pix/keys`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${harness.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ type: 'EMAIL', value: destinationKey }),
    });
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

  /** Requisicao de movimentacao: assinada, como as rotas de dinheiro exigem. */
  const signed = (path: string, body: unknown, idempotencyKey: string, method = 'POST') =>
    api(path, {
      method,
      headers: {
        'Idempotency-Key': idempotencyKey,
        ...harness.sign(method, path, body),
      },
      body: JSON.stringify(body),
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

  const balance = async (query = '') =>
    (await api(`/v1/accounts/${accountId}/balance${query}`).then((r) => r.json())) as {
      available: { amount: string };
      _meta?: { freshness?: { source: string } };
    };

  const ledgerSnapshot = () => harness.store.ledger.for(Environment.HOMOLOGACAO).snapshot();

  /**
   * Valor atualmente reservado no razao sombra.
   *
   * `scheduled_outflow` e `posted - available`: exatamente o que esta em hold.
   * Zero significa que nenhuma reserva esta de pe.
   */
  const heldCents = async () =>
    BigInt(
      (
        (await api(`/v1/accounts/${accountId}/balance?source=ledger`).then((r) => r.json())) as {
          scheduled_outflow: { amount: string } | null;
        }
      ).scheduled_outflow?.amount ?? '0',
    );

  it('registra uma chave Pix EVP', async () => {
    const response = await api(`/v1/accounts/${accountId}/pix/keys`, {
      method: 'POST',
      body: JSON.stringify({ type: 'EVP' }),
    });

    expect(response.status).toBe(201);
    const key = (await response.json()) as { type: string; value: string; status: string };
    expect(key.type).toBe('EVP');
    expect(key.status).toBe('ACTIVE');
    // O valor gravado e a forma normalizada, nao o que o provedor mandou.
    expect(key.value).toBe(key.value.toLowerCase());
  });

  it('Pix de entrada de R$ 1.500 credita saldo e razao', async () => {
    await fetch(`${harness.mockBankUrl}/_control/pix/inbound`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        account_id: providerAccountId(),
        amount: '1500.00',
        payer_name: 'Pagador Simulado',
      }),
    });
    await harness.settle();

    const saldo = await balance('?consistency=strong');
    expect(saldo.available.amount).toBe('150000');

    // O credito existe no razao sombra, nao so no espelho da transacao. E a
    // diferenca que a conciliacao em tres vias existe para pegar.
    const ledger = await balance('?source=ledger');
    expect(ledger.available.amount).toBe('150000');
  });

  it('logo apos um movimento o cache e ignorado, e a resposta diz por que', async () => {
    // Regra de bypass 3: dentro da janela pos-mutacao, o cache e ignorado
    // mesmo repovoado. Sem ela, o cliente que acabou de receber um Pix veria o
    // saldo antigo — que e exatamente quando ele olha.
    await fetch(`${harness.mockBankUrl}/_control/pix/inbound`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ account_id: providerAccountId(), amount: '1.00' }),
    });
    await harness.settle();

    const primeira = await api(`/v1/accounts/${accountId}/balance`);
    expect(primeira.headers.get('x-baas-data-source')).toBe('provider');

    const segunda = await api(`/v1/accounts/${accountId}/balance`);
    // Segunda leitura seguida: ainda dentro da janela, ainda do provedor, e a
    // razao vem declarada no cabecalho em vez de ficar implicita.
    expect(segunda.headers.get('x-baas-cache-bypass')).toBeTruthy();

    const body = (await segunda.json()) as { available: { amount: string } };
    expect(body.available.amount).toBe('150100');
  });

  it('Pix de saida liquida por webhook e debita o saldo', async () => {
    const response = await signed(
      `/v1/accounts/${accountId}/pix/transfers`,
      transfer('500.00'),
      `pixout-${uniqueExternalId()}`,
    );

    expect(response.status).toBe(201);
    const transaction = (await response.json()) as { id: string; status: string };

    // A liquidacao chega por webhook, assincrona. Esperamos a CONDICAO, nao um
    // tempo arbitrario.
    await harness.waitFor(
      () =>
        (harness.store.transactions.rows.get(transaction.id) as { status: string }).status ===
        'SETTLED',
    );

    const saldo = await balance('?consistency=strong');
    expect(saldo.available.amount).toBe('100100');
  });

  it('transferencia sem assinatura e recusada', async () => {
    // A chave semeada NAO exige assinatura no registro; quem exige e o
    // decorator da rota. Este teste prova que e ele que garante a regra.
    const response = await api(`/v1/accounts/${accountId}/pix/transfers`, {
      method: 'POST',
      headers: { 'Idempotency-Key': `sem-assinatura-${uniqueExternalId()}` },
      body: JSON.stringify(transfer('1.00')),
    });

    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toMatch(/SIGNATURE/);
  });

  it('transferencia sem Idempotency-Key e recusada', async () => {
    const path = `/v1/accounts/${accountId}/pix/transfers`;
    const body = transfer('1.00');
    const response = await api(path, {
      method: 'POST',
      headers: harness.sign('POST', path, body),
      body: JSON.stringify(body),
    });

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      'MISSING_IDEMPOTENCY_KEY',
    );
  });

  it('saldo insuficiente falha SEM lancamento no razao', async () => {
    const antes = ledgerSnapshot().entries.length;

    const response = await signed(
      `/v1/accounts/${accountId}/pix/transfers`,
      transfer('99999.00'),
      `semsaldo-${uniqueExternalId()}`,
    );

    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      'INSUFFICIENT_FUNDS',
    );
    // Nem uma perna: uma tentativa recusada por saldo nao e um fato contabil.
    expect(ledgerSnapshot().entries.length).toBe(antes);
  });

  it('erro do provedor e retry com a mesma chave nao produzem debito duplo', async () => {
    // Centavos ,51 forcam 500 do provedor.
    const key = `erro-${uniqueExternalId()}`;
    const antes = (await balance('?consistency=strong')).available.amount;

    const primeira = await signed(
      `/v1/accounts/${accountId}/pix/transfers`,
      transfer('10.51'),
      key,
    );
    expect(primeira.status).toBeGreaterThanOrEqual(400);

    const segunda = await signed(`/v1/accounts/${accountId}/pix/transfers`, transfer('10.51'), key);
    expect(segunda.status).toBeGreaterThanOrEqual(400);

    // O saldo voltou ao ponto de partida: os dois holds foram desfeitos, e
    // nenhum debito ficou de pe.
    expect((await balance('?consistency=strong')).available.amount).toBe(antes);
  });

  it('desfecho desconhecido devolve 202, mantem o hold e nao reenvia', async () => {
    // Centavos ,29 fazem o Mock Bank nao responder nunca.
    //
    // O saldo verificado aqui e o do RAZAO SOMBRA (`?source=ledger`), nao o do
    // provedor: o provedor ja reservou por conta propria, entao o saldo dele
    // cairia mesmo se o NOSSO hold fosse liberado. Medir pelo provedor
    // afirmaria sobre o hold errado.
    const antes = BigInt((await balance('?source=ledger')).available.amount);
    const antesHold = await heldCents();

    const response = await signed(
      `/v1/accounts/${accountId}/pix/transfers`,
      transfer('20.29'),
      `desconhecido-${uniqueExternalId()}`,
    );

    expect(response.status).toBe(202);
    const body = (await response.json()) as {
      operation_id: string;
      transaction: { id: string; status: string };
    };
    expect(body.transaction.status).toBe('UNKNOWN');

    const operation = harness.store.operations.rows.get(body.operation_id) as { status: string };
    expect(operation.status).toBe('UNKNOWN');

    // O hold segue de pe NO NOSSO RAZAO: liberar devolveria ao cliente um
    // saldo que talvez ja tenha saido, e ele gastaria duas vezes o mesmo
    // dinheiro.
    const depois = BigInt((await balance('?source=ledger')).available.amount);
    expect(antes - depois).toBe(2029n);

    // E a reserva continua PENDENTE, nao resolvida: um `voidPending` aqui
    // apagaria o hold sem que o provedor tenha dito nada.
    expect((await heldCents()) - antesHold).toBe(2029n);

    const stored = harness.store.transactions.rows.get(body.transaction.id) as {
      ledgerPendingTransactionId: string;
      ledgerPostedTransactionId?: string | null;
    };
    expect(stored.ledgerPendingTransactionId).toBeTruthy();
    expect(stored.ledgerPostedTransactionId ?? null).toBeNull();

    // E consultar a operacao nao dispara reenvio nenhum.
    const status = await api(`/v1/operations/${body.operation_id}`).then((r) => r.json());
    expect(status).toMatchObject({ status: 'UNKNOWN', object: 'operation' });
  });

  it('a conciliacao troca "nao sei" por informacao concreta, sem reenviar', async () => {
    const antesSaldo = BigInt((await balance('?source=ledger')).available.amount);
    const antesHold = await heldCents();

    const response = await signed(
      `/v1/accounts/${accountId}/pix/transfers`,
      transfer('30.29'),
      `reconciliar-${uniqueExternalId()}`,
    );
    const body = (await response.json()) as { operation_id: string; transaction: { id: string } };

    const path = `/v1/operations/${body.operation_id}/reconcile`;
    const resolved = (await api(path, {
      method: 'POST',
      headers: harness.sign('POST', path, {}),
      body: JSON.stringify({}),
    }).then((r) => r.json())) as { resolved: boolean };

    // O Mock Bank registrou o pagamento antes de suspender a resposta, entao a
    // consulta pela NOSSA chave o encontra — sem reenviar nada.
    expect(resolved.resolved).toBe(true);

    // O provedor diz PROCESSING, nao SETTLED. Isso ja e um ganho: qualquer
    // informacao concreta supera "nao sei se o dinheiro se moveu". Mas nao
    // autoriza resolver o hold — so a liquidacao autoriza.
    const stored = harness.store.transactions.rows.get(body.transaction.id) as {
      status: string;
      ledgerPostedTransactionId?: string | null;
    };
    expect(stored.status).toBe('PROCESSING');
    expect(stored.ledgerPostedTransactionId ?? null).toBeNull();

    // Exatamente UM hold a mais, de exatamente um valor: a conciliacao nao
    // disparou uma segunda autorizacao.
    expect((await heldCents()) - antesHold).toBe(3029n);
    // E o disponivel caiu uma unica vez.
    expect(antesSaldo - BigInt((await balance('?source=ledger')).available.amount)).toBe(3029n);

    const operation = harness.store.operations.rows.get(body.operation_id) as {
      status: string;
      attempts: number;
    };
    expect(operation.status).toBe('SUBMITTED');
    expect(operation.attempts).toBe(2);
  });

  it('o extrato lista o que ja aconteceu, paginado por cursor', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const first = (await api(
      `/v1/accounts/${accountId}/statement?from=${today}&to=${today}&limit=2`,
    ).then((r) => r.json())) as {
      data: Array<{ id: string; type: string }>;
      page: { has_more: boolean; next_cursor: string | null };
    };

    expect(first.data.length).toBeLessThanOrEqual(2);
    if (first.page.has_more) {
      const second = (await api(
        `/v1/accounts/${accountId}/statement?from=${today}&to=${today}&limit=2&cursor=${encodeURIComponent(
          first.page.next_cursor!,
        )}`,
      ).then((r) => r.json())) as { data: Array<{ id: string }> };

      const ids = [...first.data, ...second.data].map((row) => row.id);
      expect(new Set(ids).size).toBe(ids.length);
    }

    // Nenhuma transacao em voo no extrato: um extrato que muda retroativamente
    // nao e extrato.
    for (const entry of first.data) {
      const stored = harness.store.transactions.rows.get(entry.id) as { status: string };
      expect(['SETTLED', 'REVERSED', 'PARTIALLY_REVERSED']).toContain(stored.status);
    }
  });

  it('cursor de extrato adulterado e 400, nao pagina errada', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const response = await api(
      `/v1/accounts/${accountId}/statement?from=${today}&to=${today}&limit=2&cursor=forjado.assinatura`,
    );
    expect(response.status).toBe(400);
  });

  it('invariante final: o razao sombra fecha e concorda com o do Mock Bank', async () => {
    const { accounts, entries } = ledgerSnapshot();
    // Debitos = creditos no nosso razao, e nenhuma conta negativa fora da
    // conta de mundo externo. Qualquer incremento aqui paga alguem.
    assertInvariants(accounts, entries);

    const remote = (await fetch(`${harness.mockBankUrl}/_control/ledger/verify`).then((r) =>
      r.json(),
    )) as { ok: boolean; violations?: string[] };
    expect(remote).toEqual({ ok: true });
  });

  function providerAccountId(): string {
    const stored = harness.store.accounts as unknown as {
      rows: Map<string, { providerAccountId: string }>;
    };
    return stored.rows.get(accountId)!.providerAccountId;
  }

  function transfer(amount: string) {
    const cents = String(Math.round(Number(amount) * 100));
    return {
      amount: { amount: cents, currency: 'BRL', scale: 2 },
      destination: { kind: 'pix_key', key: destinationKey, key_type: 'EMAIL' },
      purpose: 'TRANSFER',
      metadata: {},
    };
  }
});
