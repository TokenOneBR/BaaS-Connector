import type { HttpClient } from '@baasconn/adapter-kit';
import type {
  AccountRef,
  Pagination,
  StatementFacet,
  StatementPage,
  StatementQuery,
} from '@baasconn/provider-spi';

import type { MbStatementPage } from '../dto/index.js';
import { fromDecimal } from '../mappers/money.js';
import { toStatementEntry } from '../mappers/pix.js';

/**
 * Extrato — paginado de verdade, com os saldos da janela.
 *
 * O Mock Bank pagina por cursor de keyset e informa abertura e fechamento
 * porque tem o razao autoritativo e pode responder a verdade. Provedor que nao
 * informa saldo simplesmente omite os campos, e a conciliacao declara o passe
 * de saldo como pulado — o que ela NAO faz e acreditar num numero inventado.
 */
export function buildStatementFacet(client: HttpClient): StatementFacet {
  return {
    async list(ref: AccountRef, query: StatementQuery & Pagination): Promise<StatementPage> {
      const response = await client.request<MbStatementPage>({
        method: 'GET',
        path: `/api/v1/contas/${encodeURIComponent(ref.providerAccountId)}/extrato`,
        query: {
          data_inicio: query.from,
          data_fim: query.to,
          limite: query.limit,
          cursor: query.cursor,
        },
        endpointClass: 'read',
      });

      const body = response.body;
      return {
        data: body.dados.map(toStatementEntry),
        nextCursor: body.proximo_cursor ?? undefined,
        hasMore: body.tem_mais,
        openingBalance: fromDecimal(body.saldo_inicial),
        closingBalance: fromDecimal(body.saldo_final),
      };
    },
  };
}
