import type { HttpClient } from '@baasconn/adapter-kit';
import type {
  AccountRef,
  Page,
  Pagination,
  StatementEntry,
  StatementFacet,
  StatementQuery,
} from '@baasconn/provider-spi';

import type { MbList, MbPayment } from '../dto/index.js';
import { toStatementEntry } from '../mappers/pix.js';

/**
 * Extrato — PARTIAL no manifesto, e a nota diz por que.
 *
 * O Mock Bank devolve a janela inteira de uma vez, sem cursor. Sintetizar um
 * cursor sobre a lista completa mentiria sobre o custo da chamada: o cliente
 * pensaria estar paginando enquanto o provedor recarrega tudo a cada pagina.
 */
export function buildStatementFacet(client: HttpClient): StatementFacet {
  return {
    async list(ref: AccountRef, query: StatementQuery & Pagination): Promise<Page<StatementEntry>> {
      const response = await client.request<MbList<MbPayment>>({
        method: 'GET',
        path: `/api/v1/contas/${encodeURIComponent(ref.providerAccountId)}/extrato`,
        query: { data_inicio: query.from, data_fim: query.to },
        endpointClass: 'read',
      });
      return { data: response.body.dados.map(toStatementEntry), hasMore: false };
    },
  };
}
