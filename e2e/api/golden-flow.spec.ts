import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  DOCUMENTS,
  signWebhook,
  startHarness,
  uniqueExternalId,
  type Harness,
} from '../support/harness.js';

/**
 * Fluxo dourado: conta PJ ate ACTIVE.
 *
 * Exercita o caminho completo em UM processo, sobre sockets reais: cliente ->
 * API -> adapter -> Mock Bank -> webhook assinado -> API -> dominio. Cada
 * peca do marco aparece aqui, e uma quebra em qualquer uma delas derruba este
 * arquivo antes de derrubar um cliente.
 */
describe('fluxo dourado de conta PJ', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await startHarness();
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

  const createAccount = (document: string, idempotencyKey: string, externalId: string) =>
    api('/v1/accounts', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({
        external_id: externalId,
        holder: {
          type: 'BUSINESS',
          tax_id: { type: 'CNPJ', value: document },
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

  it('cria a conta PJ e espelha o caso de onboarding', async () => {
    const externalId = uniqueExternalId();
    const response = await createAccount(DOCUMENTS.cnpjAprova, `idem-${externalId}`, externalId);

    expect(response.status).toBe(201);
    const account = (await response.json()) as Record<string, unknown>;

    expect(account.provider).toBe('MOCK_BANK');
    expect(account.provider_account_id).toBeTruthy();
    // O documento sai mascarado sem `?unmask=true`, mesmo com escopo pii:read.
    expect(account.holder_tax_id).toBe('**.***.***/**01-81');

    const onboarding = await api(`/v1/accounts/${account.id}/onboarding`);
    expect(onboarding.status).toBe(200);
  });

  it('repetir a Idempotency-Key devolve a mesma conta e nao cria outra no provedor', async () => {
    const externalId = uniqueExternalId();
    const key = `idem-${externalId}`;

    const first = await createAccount(DOCUMENTS.cnpjAprova, key, externalId);
    const second = await createAccount(DOCUMENTS.cnpjAprova, key, externalId);

    const a = (await first.json()) as { id: string };
    const b = (await second.json()) as { id: string };

    expect(b.id).toBe(a.id);
    // Uma conta para o mesmo CNPJ nao e conveniencia: duas seriam incidente
    // de compliance.
    expect(second.headers.get('idempotency-replayed')).toBe('true');
  });

  it('a mesma chave com corpo diferente e recusada', async () => {
    const externalId = uniqueExternalId();
    const key = `idem-${externalId}`;

    await createAccount(DOCUMENTS.cnpjAprova, key, externalId);
    const conflito = await createAccount(DOCUMENTS.cpfAprova, key, uniqueExternalId());

    expect(conflito.status).toBe(422);
    expect(((await conflito.json()) as { error: { code: string } }).error.code).toBe(
      'IDEMPOTENCY_KEY_REUSED',
    );
  });

  it('o webhook de aprovacao leva a conta ate ACTIVE', async () => {
    const externalId = uniqueExternalId();
    const created = await createAccount(DOCUMENTS.cnpjAprova, `idem-${externalId}`, externalId);
    const account = (await created.json()) as { id: string; provider_account_id: string };

    // O Mock Bank ja aprovou o caminho feliz e entregou os webhooks; drenamos
    // a fila em vez de dormir esperando.
    await harness.settle();

    const refreshed = await api(`/v1/accounts/${account.id}`);
    const body = (await refreshed.json()) as { status: string };
    expect(body.status).toBe('ACTIVE');

    // Toda mudanca de status deixa rastro nos DOIS lugares: evento para o
    // cliente e linha de auditoria para o operador.
    const eventos = harness.store.outbox.forSubject(account.id);
    expect(eventos.length).toBeGreaterThan(0);
    expect(harness.store.audit.forResource(account.id).length).toBeGreaterThan(0);
  });

  it('entrega duplicada do mesmo evento e no-op', async () => {
    const externalId = uniqueExternalId();
    const created = await createAccount(DOCUMENTS.cnpjAprova, `idem-${externalId}`, externalId);
    const account = (await created.json()) as { id: string };
    await harness.settle();

    const antes = harness.store.accounts.statusHistory.filter(
      (change) => change.accountId === account.id,
    ).length;

    // Reentrega e comportamento NORMAL do provedor. O evento ja esta gravado,
    // entao a segunda entrega para na dedupe antes de qualquer trabalho.
    const evento = [...harness.store.inbound.rows.values()].at(-1) as {
      payload: Buffer;
      headers: Record<string, string>;
      connectionId: string;
    };

    const reentrega = await fetch(`${harness.apiUrl}/webhooks/mock_bank/${harness.connectionId}`, {
      method: 'POST',
      headers: { ...evento.headers, 'content-type': 'application/json' },
      body: evento.payload,
    });
    await harness.settle();

    expect(reentrega.status).toBe(200);
    expect(reentrega.headers.get('x-baas-duplicate')).toBe('true');
    expect(
      harness.store.accounts.statusHistory.filter((change) => change.accountId === account.id)
        .length,
    ).toBe(antes);
  });

  it('evento fora de ordem nao regride o status', async () => {
    const externalId = uniqueExternalId();
    const created = await createAccount(DOCUMENTS.cnpjAprova, `idem-${externalId}`, externalId);
    const account = (await created.json()) as { id: string; provider_account_id: string };
    await harness.settle();

    expect(
      ((await (await api(`/v1/accounts/${account.id}`)).json()) as { status: string }).status,
    ).toBe('ACTIVE');

    // Evento LEGITIMO — assinatura valida, id novo, entao passa pela dedupe —
    // mas com carimbo anterior e status de rank menor. Provedores reordenam
    // entregas; sem o guard monotonico, esta linha derrubaria uma conta ativa
    // de volta para analise, e o cliente veria a conta "desativar sozinha".
    const eventId = `mbevt_fora_de_ordem_${Date.now()}`;
    const body = JSON.stringify({
      id: eventId,
      type: 'account.status_changed',
      occurredAt: new Date(Date.now() - 3_600_000).toISOString(),
      data: { account_id: account.provider_account_id, status: 'PENDING_ONBOARDING' },
    });

    const response = await fetch(`${harness.apiUrl}/webhooks/mock_bank/${harness.connectionId}`, {
      method: 'POST',
      headers: signWebhook(body, eventId),
      body,
    });
    await harness.settle();

    expect(response.status).toBe(200);

    const depois = (await (await api(`/v1/accounts/${account.id}`)).json()) as { status: string };
    expect(depois.status).toBe('ACTIVE');

    // E nao e descarte silencioso: fica registrado com o motivo, porque "por
    // que este status nao atualizou" precisa ter resposta.
    const registrado = [...harness.store.inbound.rows.values()].find(
      (row) => (row as { providerEventId?: string }).providerEventId === eventId,
    ) as { status: string; lastError: string } | undefined;

    expect(registrado?.status).toBe('DISCARDED');
    expect(registrado?.lastError).toMatch(/stale_/);
  });

  it('assinatura invalida e rejeitada e nao deixa evento gravado', async () => {
    const antes = harness.store.inbound.rows.size;

    const response = await fetch(`${harness.apiUrl}/webhooks/mock_bank/${harness.connectionId}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mockbank-signature': `t=${Math.floor(Date.now() / 1000)},v1=${'f'.repeat(64)}`,
        'x-mockbank-event-id': 'mbevt_forjado',
      },
      body: JSON.stringify({
        id: 'mbevt_forjado',
        type: 'account.status_changed',
        occurredAt: new Date().toISOString(),
        data: { account_id: 'qualquer', status: 'ACTIVE' },
      }),
    });

    expect(response.status).toBe(401);
    // Nada gravado: um evento nao autenticado nao pode nem ocupar espaco na
    // tabela, senao ela vira vetor de inundacao.
    expect(harness.store.inbound.rows.size).toBe(antes);
  });

  it('CNPJ de sancoes termina em REJECTED com o motivo preservado', async () => {
    const externalId = uniqueExternalId();
    const created = await createAccount(DOCUMENTS.cnpjSancoes, `idem-${externalId}`, externalId);
    expect(created.status).toBe(201);

    await harness.settle();
    const account = (await created.json()) as { id: string };

    const onboarding = (await (await api(`/v1/accounts/${account.id}/onboarding`)).json()) as {
      status: string;
      rejection_code: string | null;
    };

    expect(onboarding.status).toBe('REJECTED');
    // O codigo do provedor sobrevive ao mapeamento: e o que o compliance usa
    // para escalar com o BaaS.
    expect(onboarding.rejection_code).toBe('SANCTIONS_MATCH');
  });

  it('desmascarar o documento exige pii:read e gera auditoria', async () => {
    const externalId = uniqueExternalId();
    const created = await createAccount(DOCUMENTS.cnpjAprova, `idem-${externalId}`, externalId);
    const account = (await created.json()) as { id: string; holder_id: string };

    const antes = harness.store.audit.rows.length;
    const revealed = (await (await api(`/v1/accounts/${account.id}?unmask=true`)).json()) as {
      holder_tax_id: string;
    };

    expect(revealed.holder_tax_id).toBe(DOCUMENTS.cnpjAprova);
    // Cada desmascaramento e auditado: sem isso, o escopo seria so uma trava,
    // e a LGPD cobra "quem viu o documento deste cliente, e quando".
    expect(harness.store.audit.rows.length).toBe(antes + 1);
    expect(harness.store.audit.rows.at(-1)).toMatchObject({
      action: 'holder.tax_id.unmask',
    });
  });
});
