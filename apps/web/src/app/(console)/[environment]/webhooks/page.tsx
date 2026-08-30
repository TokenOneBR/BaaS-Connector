import { DataTable } from '@/components/data-table';
import { StatusBadge } from '@/components/status-badge';
import { serverApi } from '@/server/api-client';

interface Entrada {
  id: string;
  provider: string;
  event_type_raw: string | null;
  dedupe_key: string;
  status: string;
  signature_valid: boolean;
  attempts: number;
  last_error: unknown;
  received_at: string;
}

interface Endpoint {
  id: string;
  url: string;
  status: string;
  event_types: string[];
  secret_rotating: boolean;
  previous_secret_expires_at: string | null;
  consecutive_failures: number;
}

interface Entrega {
  id: string;
  event_type: string | null;
  subject_id: string | null;
  endpoint_id: string;
  attempt: number;
  status: string;
  response_status: number | null;
  duration_ms: number | null;
  error: string | null;
  scheduled_for: string;
  attempted_at: string | null;
}

const emPtBr = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

/**
 * Webhooks: o que o provedor manda e o que mandamos ao cliente.
 *
 * As duas direcoes na mesma tela porque a pergunta do suporte atravessa as
 * duas: "o cliente diz que nao recebeu o PIX in" se responde olhando se o
 * evento CHEGOU e se a entrega SAIU, e alternar entre duas paginas para isso
 * e como se perde o fio.
 *
 * Nao ha botao de reprocessar, e a ausencia e deliberada — ver o comentario
 * do controller. O caminho de recuperacao de evento perdido e a conciliacao,
 * que decide pelo estado dos tres lados em vez de pela vontade de quem clica.
 */
export default async function WebhooksPage({
  params,
  searchParams,
}: {
  params: Promise<{ environment: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { environment } = await params;
  const filtros = await searchParams;

  const [entrada, endpoints, entregas] = await Promise.all([
    serverApi.read<{ data: Entrada[] }>('/admin/v1/webhooks/inbound', {
      query: { environment, status: filtros.status, provider: filtros.provider, limit: 25 },
    }),
    serverApi.read<{ data: Endpoint[] }>('/admin/v1/webhooks/endpoints', {
      query: { environment },
    }),
    serverApi.read<{ data: Entrega[] }>('/admin/v1/webhooks/deliveries', {
      query: { environment, endpoint_id: filtros.endpoint_id, limit: 25 },
    }),
  ]);

  return (
    <>
      <h1 className="mb-6 text-xl font-semibold">Webhooks</h1>

      <section className="mb-8">
        <h2 className="mb-1 text-sm font-semibold uppercase text-text-muted">Entrada</h2>
        <p className="mb-3 text-xs text-text-muted">
          Corpo com assinatura invalida e recusado com 401 e nao gera linha — por isso toda linha
          aqui esta verificada. Um pico de recusas e evento de seguranca, e aparece na metrica{' '}
          <code className="font-mono">baas_webhook_signature_failures_total</code>, nao nesta lista.
        </p>

        <DataTable
          rows={entrada.data}
          empty="Nenhum evento recebido neste ambiente."
          columns={[
            { header: 'Quando', cell: (row) => emPtBr(row.received_at) },
            { header: 'Provedor', cell: (row) => row.provider },
            {
              header: 'Tipo (cru)',
              cell: (row) => <span className="font-mono text-xs">{row.event_type_raw ?? '—'}</span>,
            },
            {
              header: 'Dedupe',
              cell: (row) => <span className="font-mono text-xs">{row.dedupe_key}</span>,
            },
            {
              header: 'Situacao',
              cell: (row) => <StatusBadge kind="inboundEvent" status={row.status} />,
            },
            { header: 'Tentativas', cell: (row) => row.attempts, numeric: true },
            {
              header: 'Motivo',
              // `DISCARDED` guarda o motivo em `last_error`: `stale_rank`,
              // `stale_timestamp` ou `same_state`. Nao e erro — e o guard
              // monotonico absorvendo evento fora de ordem, que e o desenho.
              cell: (row) => (
                <span className="font-mono text-xs text-text-muted">
                  {typeof row.last_error === 'string' ? row.last_error : '—'}
                </span>
              ),
            },
          ]}
        />
      </section>

      <section className="mb-8">
        <h2 className="mb-1 text-sm font-semibold uppercase text-text-muted">
          Endpoints do cliente
        </h2>
        <p className="mb-3 text-xs text-text-muted">
          O segredo de assinatura nao e exibido em lugar nenhum, nem parcialmente. Durante a
          rotacao, as duas assinaturas sao enviadas no mesmo header — um verificador padrao Stripe
          aceita qualquer uma das duas.
        </p>

        <DataTable
          rows={endpoints.data}
          empty="Nenhum endpoint cadastrado neste ambiente."
          columns={[
            { header: 'URL', cell: (row) => <span className="font-mono text-xs">{row.url}</span> },
            {
              header: 'Situacao',
              cell: (row) => <StatusBadge kind="subscription" status={row.status} />,
            },
            {
              header: 'Eventos',
              // Vazio significa TODOS, por contrato de `zCreateWebhookEndpoint`.
              cell: (row) => (row.event_types.length === 0 ? 'todos' : row.event_types.join(', ')),
            },
            {
              header: 'Segredo',
              cell: (row) =>
                row.secret_rotating ? (
                  <span className="text-warning">
                    em rotacao
                    {row.previous_secret_expires_at
                      ? ` ate ${emPtBr(row.previous_secret_expires_at)}`
                      : ''}
                  </span>
                ) : (
                  'ativo'
                ),
            },
            { header: 'Falhas seguidas', cell: (row) => row.consecutive_failures, numeric: true },
          ]}
        />
      </section>

      <section>
        <h2 className="mb-1 text-sm font-semibold uppercase text-text-muted">Entregas</h2>
        <p className="mb-3 text-xs text-text-muted">
          `EXHAUSTED` significa que a escada de ~72h terminou sem sucesso. Um `4xx` do cliente e
          retentado de proposito: um 401 quase sempre e segredo rotacionado do lado dele, e quem
          conserta dentro da janela recebe o evento.
        </p>

        <DataTable
          rows={entregas.data}
          empty="Nenhuma entrega registrada neste ambiente."
          columns={[
            { header: 'Agendada', cell: (row) => emPtBr(row.scheduled_for) },
            {
              header: 'Evento',
              cell: (row) => (
                <span className="font-mono text-xs">
                  {row.event_type ?? '—'}
                  {row.subject_id ? ` · ${row.subject_id}` : ''}
                </span>
              ),
            },
            { header: 'Tentativa', cell: (row) => row.attempt, numeric: true },
            {
              header: 'Situacao',
              cell: (row) => <StatusBadge kind="delivery" status={row.status} />,
            },
            { header: 'HTTP', cell: (row) => row.response_status ?? '—', numeric: true },
            {
              header: 'Duracao',
              cell: (row) => (row.duration_ms === null ? '—' : `${row.duration_ms} ms`),
              numeric: true,
            },
            {
              header: 'Erro',
              cell: (row) => <span className="text-xs text-text-muted">{row.error ?? '—'}</span>,
            },
          ]}
        />
      </section>
    </>
  );
}
