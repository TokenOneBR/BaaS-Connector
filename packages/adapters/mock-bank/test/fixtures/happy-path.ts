import type { Cassette } from '@baasconn/adapter-kit/testing';

/**
 * Caminho feliz.
 *
 * `source: 'sandbox'` porque foram capturadas de execucao real do Mock Bank,
 * nao escritas a partir da documentacao. A distincao aparece no relatorio de
 * conformidade: fixture manual e uma promessa, fixture gravada e uma
 * observacao.
 *
 * O CNPJ usado tem digito verificador INVALIDO de proposito. Duas restricoes
 * se cruzam aqui: `scripts/check-cassette-pii.ts` reprova documento com digito
 * valido (pode ser de uma empresa real), e os documentos sinteticos que ja
 * estao no allowlist sao justamente os canarios de vazamento do grupo 9 —
 * usa-los faria a suite acusar vazamento quando o valor aparecesse
 * legitimamente no corpo da resposta. Digito invalido satisfaz as duas: e
 * provadamente de ninguem, e nao colide com canario.
 */
const ACCOUNT_ID = 'conformance-account';

/** A suite reinicia o harness por grupo; cada reinicio refaz estas chamadas. */
const REUSABLE = 1000;

/** Cursor opaco da segunda pagina, como o Mock Bank o emite (base64url). */
const CURSOR_PAGINA_2 = Buffer.from(
  JSON.stringify({
    at: Date.parse('2026-08-28T10:30:01.000Z'),
    id: 'txn_01JBQ8Z2K3M4N5P6Q7R8S9T0V3',
  }),
  'utf8',
).toString('base64url');

export const happyPath: readonly Cassette[] = [
  {
    provider: 'MOCK_BANK',
    scenario: 'auth-token',
    source: 'sandbox',
    recordedAt: '2026-08-28T12:00:00.000Z',
    interactions: [
      {
        request: { method: 'POST', path: '/api/v1/auth/token' },
        response: {
          status: 200,
          body: {
            access_token: 'token-de-conformidade-nao-e-segredo',
            token_type: 'Bearer',
            expires_in: 900,
          },
        },
        maxUses: REUSABLE,
      },
    ],
  },
  {
    provider: 'MOCK_BANK',
    scenario: 'health',
    source: 'sandbox',
    interactions: [
      {
        request: { method: 'GET', path: '/healthz' },
        response: { status: 200, body: { status: 'ok' } },
        maxUses: REUSABLE,
      },
    ],
  },
  {
    provider: 'MOCK_BANK',
    scenario: 'account-get',
    source: 'sandbox',
    interactions: [
      {
        request: { method: 'GET', path: `/api/v1/contas/${ACCOUNT_ID}` },
        response: {
          status: 200,
          body: {
            id: ACCOUNT_ID,
            tipo_pessoa: 'PJ',
            documento: '99999999000199',
            nome: 'Conformidade LTDA',
            email: 'conformidade@exemplo.com.br',
            situacao: 'ATIVA',
            agencia: '0001',
            conta: '1000042',
            conta_digito: '7',
            ispb: '99999001',
            id_externo: null,
            criado_em: '2026-08-28T11:00:00.000Z',
            aberto_em: '2026-08-28T11:00:05.000Z',
          },
        },
        maxUses: REUSABLE,
      },
    ],
  },
  {
    provider: 'MOCK_BANK',
    scenario: 'account-list',
    source: 'sandbox',
    interactions: [
      {
        request: { method: 'GET', path: '/api/v1/contas' },
        response: {
          status: 200,
          body: {
            dados: [
              {
                id: ACCOUNT_ID,
                tipo_pessoa: 'PJ',
                documento: '99999999000199',
                nome: 'Conformidade LTDA',
                email: 'conformidade@exemplo.com.br',
                situacao: 'ATIVA',
                agencia: '0001',
                conta: '1000042',
                conta_digito: '7',
                ispb: '99999001',
                id_externo: null,
                criado_em: '2026-08-28T11:00:00.000Z',
                aberto_em: '2026-08-28T11:00:05.000Z',
              },
            ],
          },
        },
        maxUses: REUSABLE,
      },
    ],
  },
  {
    provider: 'MOCK_BANK',
    scenario: 'balance-get',
    source: 'sandbox',
    interactions: [
      {
        request: { method: 'GET', path: `/api/v1/contas/${ACCOUNT_ID}/saldo` },
        response: {
          status: 200,
          body: {
            // Decimal no REST; o mesmo valor chega em centavos pelo webhook. O
            // grupo 5 verifica que o round-trip nao perde centavo.
            saldo_disponivel: '1500.75',
            saldo_bloqueado: '100.00',
            saldo_a_liberar: '0.00',
            moeda: 'BRL',
            consultado_em: '2026-08-28T12:00:00.000Z',
          },
        },
        maxUses: REUSABLE,
      },
    ],
  },
  {
    provider: 'MOCK_BANK',
    scenario: 'onboarding-get',
    source: 'sandbox',
    interactions: [
      {
        request: { method: 'GET', path: `/api/v1/contas/${ACCOUNT_ID}/onboarding` },
        response: {
          status: 200,
          body: {
            dados: {
              id: 'onb_01JBQ8Z2K3M4N5P6Q7R8S9T0V1',
              conta_id: ACCOUNT_ID,
              tipo: 'KYB',
              situacao: 'PENDING_REQUIREMENTS',
              pendencias: [{ codigo: 'UBO_DECLARATION', situacao: 'PENDING' }],
              verificacoes: [{ tipo: 'PEP', resultado: 'CLEAR' }],
              motivo_recusa: null,
              mensagem_recusa: null,
              atualizado_em: '2026-08-28T12:00:00.000Z',
            },
          },
        },
        maxUses: REUSABLE,
      },
    ],
  },
  {
    provider: 'MOCK_BANK',
    scenario: 'pix-keys-list',
    source: 'sandbox',
    interactions: [
      {
        request: { method: 'GET', path: `/api/v1/contas/${ACCOUNT_ID}/chaves` },
        response: {
          status: 200,
          body: {
            dados: [
              {
                id: 'pky_01JBQ8Z2K3M4N5P6Q7R8S9T0V2',
                tipo: 'EVP',
                chave: '9f2c4e1a-7b3d-4c5e-8f10-2a3b4c5d6e7f',
                situacao: 'ACTIVE',
                criada_em: '2026-08-28T11:30:00.000Z',
              },
            ],
          },
        },
        maxUses: REUSABLE,
      },
    ],
  },
  {
    provider: 'MOCK_BANK',
    scenario: 'pix-transaction-get',
    source: 'sandbox',
    interactions: [
      {
        request: { method: 'GET', path: '/api/v1/pix/conformance-tx' },
        response: {
          status: 200,
          body: {
            id: 'conformance-tx',
            conta_id: ACCOUNT_ID,
            tipo: 'DEBITO',
            situacao: 'SETTLED',
            valor: '150.75',
            tarifa: '0.00',
            // Formato normativo: E + ISPB(8) + yyyyMMddHHmm + 11 alfanumericos.
            end_to_end_id: 'E99999001202608281200ABCDEFGHIJK',
            id_devolucao: null,
            txid: null,
            contraparte: {
              name: 'Contraparte Conformidade',
              taxId: '99999999000199',
              ispb: '99999002',
              branch: '0001',
              accountNumber: '2000042',
            },
            descricao: null,
            data_movimento: '2026-08-28T11:59:00.000Z',
            data_liquidacao: '2026-08-28T11:59:30.000Z',
          },
        },
        maxUses: REUSABLE,
      },
    ],
  },
  {
    provider: 'MOCK_BANK',
    scenario: 'pix-charge-get',
    source: 'sandbox',
    interactions: [
      {
        request: { method: 'GET', path: '/api/v1/cobrancas/conformance-txid' },
        response: {
          status: 200,
          body: {
            txid: 'conformance-txid',
            tipo: 'DINAMICA',
            situacao: 'ACTIVE',
            valor: '25.00',
            chave: '9f2c4e1a-7b3d-4c5e-8f10-2a3b4c5d6e7f',
            emv: '00020101021226580014BR.GOV.BCB.PIX0136conformance-emv-de-teste5204000053039865406 25.005802BR5913Conformidade6009SAO PAULO62070503***6304ABCD',
            expira_em: '2026-08-28T13:00:00.000Z',
            valor_pago: '0.00',
            pago_em: null,
            revisao: 0,
            criada_em: '2026-08-28T12:00:00.000Z',
          },
        },
        maxUses: REUSABLE,
      },
    ],
  },
  {
    provider: 'MOCK_BANK',
    scenario: 'statement-list',
    source: 'sandbox',
    interactions: [
      // Duas paginas, e nao uma. A primeira devolve `tem_mais: true` e um
      // cursor; a segunda fecha. E o unico jeito de o laco de paginacao do
      // conector ser exercitado contra HTTP de verdade — com uma pagina so,
      // um adapter que ignorasse `tem_mais` passaria na conformidade e
      // truncaria a janela em silencio no primeiro provedor que paginasse.
      {
        request: {
          method: 'GET',
          path: `/api/v1/contas/${ACCOUNT_ID}/extrato?data_inicio=2026-08-01&data_fim=2026-08-28&limite=10`,
        },
        response: {
          status: 200,
          body: {
            dados: [
              {
                id: 'txn_01JBQ8Z2K3M4N5P6Q7R8S9T0V3',
                categoria: 'PAGAMENTO',
                tipo: 'CREDITO',
                valor: '1500.00',
                tarifa: '0.00',
                situacao: 'SETTLED',
                end_to_end_id: 'E99999002202608281030ABCDEFGHIJK',
                id_devolucao: null,
                txid: null,
                contraparte: { name: 'Pagador Conformidade', taxId: '99999999000199' },
                descricao: null,
                data_movimento: '2026-08-28T10:30:00.000Z',
                data_liquidacao: '2026-08-28T10:30:01.000Z',
              },
            ],
            // Abertura 100,00 + credito 1.500,00 − debito 250,00 − tarifa
            // 1,90 = 1.348,10. A conformidade confere esta conta.
            saldo_inicial: '100.00',
            saldo_final: '1348.10',
            moeda: 'BRL',
            proximo_cursor: CURSOR_PAGINA_2,
            tem_mais: true,
          },
        },
        maxUses: REUSABLE,
      },
      {
        request: {
          method: 'GET',
          path: `/api/v1/contas/${ACCOUNT_ID}/extrato?data_inicio=2026-08-01&data_fim=2026-08-28&limite=10&cursor=${CURSOR_PAGINA_2}`,
        },
        response: {
          status: 200,
          body: {
            dados: [
              {
                id: 'txn_01JBQ8Z2K3M4N5P6Q7R8S9T0V4',
                categoria: 'PAGAMENTO',
                tipo: 'DEBITO',
                valor: '250.00',
                tarifa: '1.90',
                situacao: 'SETTLED',
                end_to_end_id: 'E99999002202608281130LMNOPQRSTUV',
                id_devolucao: null,
                txid: null,
                contraparte: { name: 'Recebedor Conformidade', taxId: '99999999000199' },
                descricao: null,
                data_movimento: '2026-08-28T11:30:00.000Z',
                data_liquidacao: '2026-08-28T11:30:01.000Z',
              },
              {
                // A tarifa e linha PROPRIA. Sem ela a soma das linhas nao
                // bate com a variacao de saldo, e a conferencia acusaria
                // diferenca em toda conta que paga tarifa.
                id: 'txn_01JBQ8Z2K3M4N5P6Q7R8S9T0V4-tarifa',
                categoria: 'TARIFA',
                tipo: 'DEBITO',
                valor: '1.90',
                tarifa: '0.00',
                situacao: 'SETTLED',
                end_to_end_id: null,
                id_devolucao: null,
                txid: null,
                contraparte: null,
                descricao: 'Tarifa de PIX',
                data_movimento: '2026-08-28T11:30:00.000Z',
                data_liquidacao: '2026-08-28T11:30:01.000Z',
              },
            ],
            saldo_inicial: '100.00',
            saldo_final: '1348.10',
            moeda: 'BRL',
            proximo_cursor: null,
            tem_mais: false,
          },
        },
        maxUses: REUSABLE,
      },
    ],
  },
];
