import { NovaChave } from './nova-chave';

import { DataTable } from '@/components/data-table';
import { serverApi } from '@/server/api-client';

interface Chave {
  id: string;
  name: string;
  prefix: string;
  last4: string;
  scopes: string[];
  signing_required: boolean;
  status: string;
  last_used_at: string | null;
  created_at: string;
}

/**
 * Chaves de API.
 *
 * O segredo aparece UMA vez, na resposta da criacao, e nunca mais — nao ha
 * rota que o devolva, e nao pode haver. Rotacionar e revogar e cunhar de novo:
 * uma rota de "rotacionar no lugar" seria uma rota com segredo no corpo, que
 * alguem eventualmente torna idempotente e passa a repetir.
 */
export default async function ApiKeysPage({
  params,
}: {
  params: Promise<{ environment: string }>;
}) {
  const { environment } = await params;
  const { data } = await serverApi.read<{ data: Chave[] }>('/admin/v1/api-keys', {
    query: { environment },
  });

  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Chaves de API</h1>
      <p className="mb-6 text-sm text-text-muted">
        O segredo aparece uma unica vez. Depois disso, so o prefixo.
      </p>

      <NovaChave environment={environment} />

      <div className="mt-8">
        <DataTable
          rows={data}
          empty="Nenhuma chave neste ambiente."
          columns={[
            { header: 'Nome', cell: (row) => row.name },
            {
              header: 'Chave',
              cell: (row) => (
                <span className="font-mono text-xs">
                  {row.prefix}_…{row.last4}
                </span>
              ),
            },
            { header: 'Escopos', cell: (row) => row.scopes.join(', ') },
            { header: 'Assinatura', cell: (row) => (row.signing_required ? 'exigida' : 'nao') },
            { header: 'Situacao', cell: (row) => row.status },
            { header: 'Ultimo uso', cell: (row) => row.last_used_at ?? 'nunca' },
          ]}
        />
      </div>
    </>
  );
}
