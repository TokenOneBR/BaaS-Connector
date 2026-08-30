import { z } from 'zod';

/**
 * Credenciais da Woovi.
 *
 * Um unico segredo: o AppID, que vai cru no header `Authorization` — sem o
 * prefixo `Bearer`, que e o detalhe em que quase toda integracao tropeca na
 * primeira tentativa.
 */
export const credentialsSchema = z.object({
  appId: z.string().min(1, 'appId e obrigatorio'),
  /** Segredo HMAC do webhook, quando configurado no painel. */
  webhookSecret: z.string().min(1).optional(),
});

export type WooviCredentials = z.infer<typeof credentialsSchema>;
