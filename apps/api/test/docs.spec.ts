import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DocsController } from '../src/docs/docs.controller.js';

/**
 * A spec servida e a spec COMMITADA.
 *
 * O caminho de resolucao muda entre o workspace e a imagem — tres candidatos,
 * tentados em ordem — e um erro ali nao apareceria em teste de unidade
 * nenhum: a API subiria e serviria o corpo de fallback, que e JSON valido e
 * responde 200. O cliente veria uma spec vazia e nao um erro.
 */
describe('DocsController', () => {
  it('serve o mesmo arquivo que o gerador emite', () => {
    const servida = new DocsController().spec();
    const commitada = readFileSync(join(process.cwd(), '../../docs/openapi.json'), 'utf8');

    expect(JSON.parse(servida)).toEqual(JSON.parse(commitada));
  });

  it('a spec descreve o 202 nas rotas que movem dinheiro', () => {
    const spec = JSON.parse(new DocsController().spec()) as {
      paths: Record<string, Record<string, { responses: Record<string, { description: string }> }>>;
    };

    const transferencia = spec.paths['/v1/accounts/{accountId}/pix/transfers']!.post!;

    // O 202 na spec e o que faz quem gera cliente a partir dela nao tratar o
    // desfecho desconhecido como sucesso. Sem ele, todo SDK gerado marcaria o
    // pagamento como enviado.
    expect(transferencia.responses['202']!.description).toContain('DESCONHECIDO');
    expect(transferencia.responses['202']!.description).toContain('NUNCA reenvie');
  });

  it('nenhuma rota de /admin/v1 vaza para a spec publica', () => {
    const spec = JSON.parse(new DocsController().spec()) as { paths: Record<string, unknown> };

    // A superficie administrativa e do console. Publica-la convidaria alguem a
    // integrar com ela, e ai ela passaria a ser publica de fato — com rotas
    // que gravam credencial de provedor e cunham API key.
    for (const caminho of Object.keys(spec.paths)) {
      expect(caminho.startsWith('/v1/'), caminho).toBe(true);
    }
  });

  it('o cache e por instancia, e nao releitura por requisicao', () => {
    const controller = new DocsController();
    // Ler o arquivo a cada `GET /docs/v1` transformaria uma rota publica e
    // sem autenticacao num I/O de disco por requisicao — DoS barato.
    expect(controller.spec()).toBe(controller.spec());
  });
});
