/**
 * Bases da Woovi.
 *
 * As duas sao hosts reais operados pela Woovi: `api.woovi.com` e a marca
 * atual, `api.openpix.com.br` e o alias herdado da OpenPix. NAO existe um host
 * de sandbox separado e publicamente documentado — o ambiente de teste da
 * Woovi e selecionado pelo **AppID** usado, nao pela URL.
 *
 * Isso significa que o mapa abaixo e so um PADRAO. Quem cadastra a conexao
 * deve conferir o `baseUrl` e, principalmente, usar o AppID de teste em
 * homologacao. Apontar um AppID de producao para "homologacao" cobra de
 * verdade — e essa e a armadilha deste provedor.
 */
export const endpoints = {
  HOMOLOGACAO: 'https://api.openpix.com.br',
  PRODUCAO: 'https://api.woovi.com',
} as const;

export const paths = {
  charge: '/api/openpix/v1/charge',
  company: '/api/v1/company',
} as const;
