'use server';

import { defineAction, serverApi } from '@/server/actions';

export const criarChave = defineAction(
  async (form) => {
    const environment = String(form.get('environment'));
    const scopes = form.getAll('scopes').map(String);

    return serverApi.mutate<{ secret: string }>('/admin/v1/api-keys', {
      method: 'POST',
      body: {
        name: String(form.get('name')),
        environment,
        scopes,
        ip_allowlist: [],
        // Deixa a API decidir. Ela FORCA a assinatura em producao com
        // `pix:write`, e recusa um `false` explicito — a regra mora la, e
        // duplica-la aqui criaria duas verdades.
      },
    });
  },
  { revalidate: '/[environment]/api-keys' },
);

export const revogarChave = defineAction(
  async (form) =>
    serverApi.mutate(
      `/admin/v1/api-keys/${String(form.get('id'))}/revoke?environment=${String(form.get('environment'))}`,
      { method: 'POST' },
    ),
  { revalidate: '/[environment]/api-keys' },
);
