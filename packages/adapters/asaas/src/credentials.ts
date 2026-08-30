import { z } from 'zod';

/**
 * Credenciais do Asaas.
 *
 * A chave vai no header `access_token`, NAO em `Authorization: Bearer`. Quem
 * vem de OAuth2 tenta Bearer por reflexo e recebe 401 sem explicacao.
 */
export const credentialsSchema = z.object({
  apiKey: z.string().min(1, 'apiKey e obrigatoria'),
  /**
   * Subconta (walletId) quando a conexao opera como marketplace.
   *
   * O Asaas modela multi-cliente por subconta, e o mesmo `apiKey` alcanca
   * todas. Sem isto, uma conexao mal configurada moveria dinheiro da conta
   * errada — por isso e explicito e nao inferido.
   */
  walletId: z.string().min(1).optional(),
  /** Segredo que o Asaas envia de volta no header `asaas-access-token`. */
  webhookSecret: z.string().min(1).optional(),
});

export type AsaasCredentials = z.infer<typeof credentialsSchema>;
