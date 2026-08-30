import type { MoneyJSON } from '@baasconn/taxonomy';

import { formatMoney } from '@/lib/money';
import { serverApi } from '@/server/api-client';

interface Overview {
  accounts: { total: number; active: number; pending_onboarding: number; blocked: number };
  pix: {
    in_count: number;
    out_count: number;
    in_amount: MoneyJSON;
    out_amount: MoneyJSON;
    settled: number;
    failed: number;
    unknown: number;
  };
  reconciliation: { open_breaks: number; critical_breaks: number; last_success_at: string | null };
  outbox: { pending: number; oldest_age_seconds: number | null };
}

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ environment: string }>;
}) {
  const { environment } = await params;
  // UMA chamada. Nove KPIs em nove rotas custariam nove idas ao BFF, cada uma
  // com o round-trip de sessao.
  const data = await serverApi.read<Overview>('/admin/v1/overview', { query: { environment } });

  return (
    <>
      <h1 className="mb-6 text-xl font-semibold">Painel</h1>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Contas ativas" value={String(data.accounts.active)} />
        <Kpi label="PIX recebido" value={formatMoney(data.pix.in_amount)} />
        <Kpi label="PIX enviado" value={formatMoney(data.pix.out_amount)} />
        <Kpi
          label="Quebras abertas"
          value={String(data.reconciliation.open_breaks)}
          tone={data.reconciliation.critical_breaks > 0 ? 'danger' : undefined}
        />
      </section>

      <section className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Liquidadas" value={String(data.pix.settled)} />
        <Kpi label="Falhas" value={String(data.pix.failed)} />
        {/* `UNKNOWN` tem cartao proprio, e amarelo: significa "o dinheiro pode
            ter saido e nao sabemos". Somado as falhas, sumiria. */}
        <Kpi
          label="Desfecho desconhecido"
          value={String(data.pix.unknown)}
          tone={data.pix.unknown > 0 ? 'warning' : undefined}
        />
        <Kpi label="Outbox pendente" value={String(data.outbox.pending)} />
      </section>

      <p className="mt-6 text-xs text-text-muted">
        Ultima conciliacao com sucesso:{' '}
        {data.reconciliation.last_success_at
          ? new Date(data.reconciliation.last_success_at).toLocaleString('pt-BR', {
              timeZone: 'America/Sao_Paulo',
            })
          : /* Nulo nao e zero: um deploy que nunca conciliou precisa dizer
               isso, e nao "ha 0 segundos". */
            'nunca'}
      </p>
    </>
  );
}

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'danger' | 'warning';
}) {
  const cor = tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : 'text-text';
  return (
    <div className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <p className="text-xs text-text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${cor}`}>{value}</p>
    </div>
  );
}
