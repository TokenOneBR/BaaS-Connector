import type { MoneyJSON } from '@baasconn/taxonomy';

import { DataTable } from '@/components/data-table';
import { StatusBadge } from '@/components/status-badge';
import { formatMoney } from '@/lib/money';
import { serverApi } from '@/server/api-client';

interface Transacao {
  id: string;
  status: string;
  direction: string;
  amount: MoneyJSON;
  end_to_end_id: string | null;
  requested_at: string;
  provider: string;
}

export default async function TransactionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ environment: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { environment } = await params;
  const filtros = await searchParams;

  const { data } = await serverApi.read<{ data: Transacao[] }>('/admin/v1/transactions', {
    query: {
      environment,
      status: filtros.status,
      direction: filtros.direction,
      account_id: filtros.account_id,
      limit: 50,
    },
  });

  return (
    <>
      <h1 className="mb-6 text-xl font-semibold">Transacoes</h1>

      <DataTable
        rows={data}
        empty="Nenhuma transacao neste ambiente."
        columns={[
          { header: 'Id', cell: (row) => <span className="font-mono text-xs">{row.id}</span> },
          { header: 'Sentido', cell: (row) => row.direction },
          { header: 'Valor', cell: (row) => formatMoney(row.amount), numeric: true },
          {
            header: 'Situacao',
            cell: (row) => <StatusBadge kind="transaction" status={row.status} />,
          },
          {
            header: 'E2EID',
            cell: (row) => (
              <span className="font-mono text-xs">
                {/* Nulo ate PROCESSING, muitas vezes ate SETTLED: quem o gera e
                    o PSP do pagador. A coluna vazia e o estado normal. */}
                {row.end_to_end_id ?? '—'}
              </span>
            ),
          },
          {
            header: 'Solicitada em',
            cell: (row) =>
              new Date(row.requested_at).toLocaleString('pt-BR', {
                timeZone: 'America/Sao_Paulo',
              }),
          },
        ]}
      />
    </>
  );
}
