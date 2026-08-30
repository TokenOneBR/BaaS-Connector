import { DataTable } from '@/components/data-table';
import { serverApi } from '@/server/api-client';

interface Conexao {
  id: string;
  provider: string;
  label: string;
  status: string;
  base_url: string | null;
  webhook_url: string;
  credentials: {
    set: boolean;
    fingerprint: string | null;
    last4: string | null;
    updated_at: string | null;
    updated_by: string | null;
  };
  last_health_status: string | null;
}

/**
 * Provedores e conexoes.
 *
 * NAO EXISTE afordancia de "revelar credencial" nesta tela, e nao pode passar
 * a existir: nao ha endpoint que sirva o valor. O que se mostra e a PROVA de
 * que ha segredo gravado — fingerprint e, quando o adapter declara um campo
 * exibivel, os quatro ultimos caracteres de um IDENTIFICADOR (nunca de um
 * segredo).
 *
 * O campo de credencial na tela de rotacao e write-only pelo mesmo motivo: ele
 * nunca e pre-preenchido, porque nao ha de onde preencher.
 */
export default async function ProvidersPage({
  params,
}: {
  params: Promise<{ environment: string }>;
}) {
  const { environment } = await params;
  const { data } = await serverApi.read<{ data: Conexao[] }>('/admin/v1/connections', {
    query: { environment },
  });

  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Provedores</h1>
      <p className="mb-6 text-sm text-text-muted">
        A credencial nunca e exibida. O que aparece prova que ela existe.
      </p>

      <DataTable
        rows={data}
        empty="Nenhuma conexao cadastrada neste ambiente."
        columns={[
          { header: 'Provedor', cell: (row) => row.provider },
          { header: 'Rotulo', cell: (row) => row.label },
          { header: 'Situacao', cell: (row) => row.status },
          {
            header: 'Credencial',
            cell: (row) => (
              <span className="font-mono text-xs text-text-muted">
                {/* Pontinhos mais os quatro ultimos do IDENTIFICADOR. Nao ha
                    botao de revelar porque nao ha rota que revele. */}
                {row.credentials.last4 ? `••••••••${row.credentials.last4}` : '••••••••'}
              </span>
            ),
          },
          {
            header: 'Impressao digital',
            cell: (row) => (
              <span className="font-mono text-xs text-text-muted">
                {row.credentials.fingerprint ?? '—'}
              </span>
            ),
          },
          { header: 'Saude', cell: (row) => row.last_health_status ?? 'nao verificada' },
          {
            header: 'URL de webhook',
            cell: (row) => <span className="font-mono text-xs break-all">{row.webhook_url}</span>,
          },
        ]}
      />
    </>
  );
}
