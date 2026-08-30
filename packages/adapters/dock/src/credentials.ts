import { z } from 'zod';

/**
 * Credenciais da Dock.
 *
 * A referencia de API da Dock fica atras de portal de parceiro, entao o
 * modelo abaixo e o que a documentacao PUBLICA descreve: OAuth2
 * `client_credentials`. Confirmar no onboarding tecnico antes de usar em
 * producao — e este comentario e a diferenca entre uma suposicao declarada e
 * uma suposicao escondida no codigo.
 */
export const credentialsSchema = z.object({
  clientId: z.string().min(1, 'clientId e obrigatorio'),
  clientSecret: z.string().min(1, 'clientSecret e obrigatorio'),
  /** Escopo negociado no contrato; varia por produto contratado. */
  scope: z.string().min(1).optional(),
});

export type DockCredentials = z.infer<typeof credentialsSchema>;
