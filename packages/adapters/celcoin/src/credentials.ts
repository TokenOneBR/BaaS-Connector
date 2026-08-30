import { z } from 'zod';

/**
 * Credenciais da Celcoin.
 *
 * Validado ANTES de a credencial ser cifrada e gravada: um `clientSecret`
 * vazio detectado no cadastro e um erro de configuracao; detectado na primeira
 * transferencia e um incidente.
 */
export const credentialsSchema = z.object({
  clientId: z.string().min(1, 'clientId e obrigatorio'),
  clientSecret: z.string().min(1, 'clientSecret e obrigatorio'),
  /**
   * Conta Celcoin que origina as movimentacoes.
   *
   * A Celcoin escopa saldo, extrato e PIX por conta, e o conector guarda o
   * identificador em `Account.providerAccountId`. Este campo e o padrao da
   * conexao, para operacoes que nao carregam conta explicita.
   */
  defaultAccount: z.string().min(1).optional(),
  /** Segredo de assinatura de webhook. Rotaciona em cadencia propria. */
  webhookSecret: z.string().min(1).optional(),
});

export type CelcoinCredentials = z.infer<typeof credentialsSchema>;
