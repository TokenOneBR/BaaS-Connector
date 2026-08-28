import { z } from 'zod';

/**
 * Credenciais do Mock Bank.
 *
 * Validado ANTES de a credencial ser cifrada e gravada: um `clientSecret`
 * vazio detectado no cadastro e um erro de configuracao; detectado na primeira
 * transferencia e um incidente.
 */
export const credentialsSchema = z.object({
  clientId: z.string().min(1, 'clientId e obrigatorio'),
  clientSecret: z.string().min(1, 'clientSecret e obrigatorio'),
  /**
   * Segredo com que o Mock Bank assina os webhooks. Fica separado das
   * credenciais de chamada porque rotaciona em cadencia diferente.
   */
  webhookSecret: z.string().min(1).optional(),
});

export type MockBankCredentials = z.infer<typeof credentialsSchema>;
