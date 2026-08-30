import { DataTable } from '@/components/data-table';
import { serverApi } from '@/server/api-client';

interface Linha {
  id: string;
  sequence: string;
  occurred_at: string;
  actor_type: string;
  actor_id: string | null;
  actor_ip: string | null;
  action: string;
  outcome: string;
  resource_type: string;
  resource_id: string | null;
}

interface Verificacao {
  verified: boolean;
  checked_count: number;
  first_divergence: { audit_id: string; sequence: string } | null;
}

/**
 * Trilha de auditoria.
 *
 * A verificacao da cadeia roda no SERVIDOR, numa funcao SQL ao lado do trigger
 * que a calcula — o console so mostra o veredito. Recalcular aqui criaria uma
 * terceira definicao da mesma formula.
 */
export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ environment: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { environment } = await params;
  const filtros = await searchParams;

  const [pagina, verificacao] = await Promise.all([
    serverApi.read<{ data: Linha[] }>('/admin/v1/audit', {
      query: {
        environment,
        actor_id: filtros.actor_id,
        action: filtros.action,
        resource_id: filtros.resource_id,
        limit: 50,
      },
    }),
    serverApi.read<Verificacao>('/admin/v1/audit/verify', { query: { environment } }),
  ]);

  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Auditoria</h1>

      <p
        className={`mb-6 text-sm ${verificacao.verified ? 'text-success' : 'text-danger'}`}
        role="status"
      >
        {verificacao.verified
          ? `Cadeia integra — ${verificacao.checked_count} linha(s) verificada(s).`
          : `CADEIA QUEBRADA na sequencia ${verificacao.first_divergence?.sequence}.`}
      </p>

      <DataTable
        rows={pagina.data}
        empty="Nenhuma linha de auditoria neste ambiente."
        columns={[
          { header: 'Seq.', cell: (row) => row.sequence, numeric: true },
          {
            header: 'Quando',
            cell: (row) =>
              new Date(row.occurred_at).toLocaleString('pt-BR', {
                timeZone: 'America/Sao_Paulo',
              }),
          },
          { header: 'Ator', cell: (row) => `${row.actor_type} ${row.actor_id ?? ''}`.trim() },
          {
            header: 'Acao',
            cell: (row) => <span className="font-mono text-xs">{row.action}</span>,
          },
          { header: 'Desfecho', cell: (row) => row.outcome },
          {
            header: 'Recurso',
            cell: (row) => (
              <span className="font-mono text-xs">
                {row.resource_type}
                {row.resource_id ? ` ${row.resource_id}` : ''}
              </span>
            ),
          },
        ]}
      />
    </>
  );
}
