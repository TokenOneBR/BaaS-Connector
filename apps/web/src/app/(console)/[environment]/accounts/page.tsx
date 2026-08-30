import { DataTable } from '@/components/data-table';
import { StatusBadge } from '@/components/status-badge';
import { serverApi } from '@/server/api-client';

interface Conta {
  id: string;
  holder_name: string;
  /** SEMPRE mascarado nesta rota. Revelar e outra rota, com auditoria. */
  holder_tax_id: string;
  holder_type: string;
  status: string;
  provider: string;
  external_id: string | null;
  created_at: string;
}

export default async function AccountsPage({
  params,
  searchParams,
}: {
  params: Promise<{ environment: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { environment } = await params;
  // Filtros vivem em SEARCH PARAMS: a URL fica compartilhavel, sobrevive a
  // recarga e nao precisa de biblioteca de estado de cliente.
  const filtros = await searchParams;

  const { data } = await serverApi.read<{ data: Conta[] }>('/admin/v1/accounts', {
    query: { environment, status: filtros.status, holder_type: filtros.holder_type, limit: 50 },
  });

  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Contas</h1>
      <p className="mb-6 text-sm text-text-muted">
        CPF e CNPJ aparecem mascarados. Revelar exige papel de compliance e gera linha de auditoria.
      </p>

      <DataTable
        rows={data}
        empty="Nenhuma conta neste ambiente."
        columns={[
          { header: 'Titular', cell: (row) => row.holder_name },
          {
            header: 'Documento',
            cell: (row) => <span className="font-mono text-xs">{row.holder_tax_id}</span>,
          },
          { header: 'Tipo', cell: (row) => row.holder_type },
          { header: 'Situacao', cell: (row) => <StatusBadge kind="account" status={row.status} /> },
          { header: 'Provedor', cell: (row) => row.provider },
          {
            header: 'Criada em',
            cell: (row) =>
              new Date(row.created_at).toLocaleDateString('pt-BR', {
                timeZone: 'America/Sao_Paulo',
              }),
          },
        ]}
      />
    </>
  );
}
