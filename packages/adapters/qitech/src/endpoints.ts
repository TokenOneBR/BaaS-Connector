/**
 * Bases da QI Tech.
 *
 * A referencia de API fica atras de portal de parceiro; os hosts abaixo sao o
 * padrao da plataforma e devem ser confirmados no onboarding tecnico. A
 * conexao pode sobrescrever com `baseUrl`.
 */
export const endpoints = {
  HOMOLOGACAO: 'https://api-sandbox.qitech.app',
  PRODUCAO: 'https://api.qitech.app',
} as const;
