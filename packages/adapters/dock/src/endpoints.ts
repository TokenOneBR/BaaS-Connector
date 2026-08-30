/**
 * Bases da Dock.
 *
 * A Dock publica a documentacao atras de portal de parceiro, entao os hosts
 * abaixo sao o PADRAO da plataforma e devem ser confirmados no onboarding
 * tecnico. Quem cadastra a conexao pode sobrescrever com `baseUrl`, que e
 * justamente para isto que o campo existe.
 */
export const endpoints = {
  HOMOLOGACAO: 'https://api-sandbox.dock.tech',
  PRODUCAO: 'https://api.dock.tech',
} as const;

export const paths = {
  token: '/oauth/token',
} as const;
