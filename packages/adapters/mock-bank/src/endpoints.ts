/**
 * Endpoints do Mock Bank.
 *
 * Os dois apontam para localhost porque o Mock Bank e auto-hospedado: quem o
 * roda define a URL na conexao, e o `baseUrl` da conexao sobrepoe estes
 * valores. A suite de conformidade exige que homologacao e producao difiram —
 * apontar homologacao para producao e como se faz uma transferencia real
 * achando que era teste — e abre excecao explicita para localhost, que e
 * exatamente este caso.
 */
export const endpoints = {
  HOMOLOGACAO: 'http://localhost:3002',
  PRODUCAO: 'http://localhost:3002',
} as const;
