import type { MoneyJSON } from '@baasconn/taxonomy';

import { DataTable } from '@/components/data-table';
import { StatusBadge } from '@/components/status-badge';
import { formatMoney } from '@/lib/money';
import { serverApi } from '@/server/api-client';

interface Quebra {
  id: string;
  type: string;
  severity: string;
  status: string;
  amount: MoneyJSON | null;
  delta: MoneyJSON | null;
  effective_date: string;
  description: string;
  age_days: number;
  account_id: string | null;
}

interface Execucao {
  id: string;
  scope: string;
  status: string;
  window_start: string;
  window_end: string;
  provider_item_count: number;
  local_item_count: number;
  ledger_item_count: number;
  matched_count: number;
  break_count: number;
  balance_delta: MoneyJSON | null;
  finished_at: string | null;
}

export default async function ReconciliationPage({
  params,
}: {
  params: Promise<{ environment: string }>;
}) {
  const { environment } = await params;

  const [quebras, execucoes] = await Promise.all([
    serverApi.read<{ data: Quebra[] }>('/admin/v1/reconciliation/breaks', {
      query: { environment, limit: 50 },
    }),
    serverApi.read<{ data: Execucao[] }>('/admin/v1/reconciliation/runs', {
      query: { environment, limit: 10 },
    }),
  ]);

  return (
    <>
      <h1 className="mb-6 text-xl font-semibold">Conciliacao</h1>

      <h2 className="mb-3 text-sm font-medium text-text-muted">Quebras abertas</h2>
      <DataTable
        rows={quebras.data}
        empty="Nenhuma quebra aberta. Os tres lados fecham."
        columns={[
          { header: 'Tipo', cell: (row) => row.type },
          {
            header: 'Severidade',
            cell: (row) => <StatusBadge kind="severity" status={row.severity} />,
          },
          { header: 'Situacao', cell: (row) => <StatusBadge kind="break" status={row.status} /> },
          {
            header: 'Valor',
            cell: (row) => (row.amount ? formatMoney(row.amount) : '—'),
            numeric: true,
          },
          {
            header: 'Delta',
            cell: (row) => (row.delta ? formatMoney(row.delta) : '—'),
            numeric: true,
          },
          { header: 'Data contabil', cell: (row) => row.effective_date },
          {
            header: 'Idade',
            // Derivada do `created_at` da linha EXISTENTE, e nunca zerada pela
            // reincidencia: uma quebra de 30 dias precisa se apresentar como
            // de 30 dias, senao o SLA de envelhecimento nunca dispara.
            cell: (row) => `${row.age_days} d`,
            numeric: true,
          },
        ]}
      />

      <h2 className="mb-3 mt-8 text-sm font-medium text-text-muted">Ultimas execucoes</h2>
      <DataTable
        rows={execucoes.data}
        empty="Nenhuma execucao registrada."
        columns={[
          { header: 'Escopo', cell: (row) => row.scope },
          { header: 'Situacao', cell: (row) => row.status },
          { header: 'Provedor', cell: (row) => String(row.provider_item_count), numeric: true },
          { header: 'Local', cell: (row) => String(row.local_item_count), numeric: true },
          { header: 'Razao', cell: (row) => String(row.ledger_item_count), numeric: true },
          { header: 'Casados', cell: (row) => String(row.matched_count), numeric: true },
          { header: 'Quebras', cell: (row) => String(row.break_count), numeric: true },
          {
            // O numero de manchete do painel, e ate ha pouco ilegivel: era
            // gravado por `complete()` e nao saia do banco.
            header: 'Delta de saldo',
            cell: (row) => (row.balance_delta ? formatMoney(row.balance_delta) : '—'),
            numeric: true,
          },
        ]}
      />
    </>
  );
}
