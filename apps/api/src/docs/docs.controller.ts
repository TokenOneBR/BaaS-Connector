import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Controller, Get, Header, Logger } from '@nestjs/common';

import { Public } from '../auth/api-key.guard.js';

/**
 * A spec OpenAPI, servida a partir do arquivo COMMITADO.
 *
 * Nao e gerada em runtime, e a diferenca importa: `scripts/gen-openapi.ts`
 * emite `docs/openapi.json`, o CI verifica que o commitado bate com o gerado, e
 * a API serve exatamente esse arquivo. Assim o que o cliente baixa e o que
 * passou por revisao no diff — gerar em runtime deixaria a spec mudar sem
 * ninguem ter olhado.
 *
 * `@Public()` porque uma spec atras de autenticacao e uma spec que ninguem le
 * antes de integrar, e ela nao revela nada que as rotas ja nao revelem.
 */
@Controller('docs')
export class DocsController {
  private readonly logger = new Logger(DocsController.name);
  private cache?: string;

  @Get('v1')
  @Public()
  @Header('Content-Type', 'application/json; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=300')
  spec(): string {
    this.cache ??= this.carregar();
    return this.cache;
  }

  private carregar(): string {
    // `__dirname` e nao `import.meta.url`: a API compila para CommonJS
    // (`nest build`), e `import.meta` nao existe la.
    //
    // Tres candidatos porque a raiz varia: no workspace o processo roda de
    // `apps/api`, na imagem roda de `/app`, e o `dist` fica um nivel mais
    // fundo nos dois. Tentar em ordem custa dois `readFileSync` que falham,
    // uma vez na vida do processo.
    const candidatos = [
      join(__dirname, '../../../../docs/openapi.json'),
      join(__dirname, '../../../../../docs/openapi.json'),
      join(process.cwd(), 'docs/openapi.json'),
    ];

    for (const caminho of candidatos) {
      try {
        return readFileSync(caminho, 'utf8');
      } catch {
        continue;
      }
    }

    // Uma spec ausente NAO derruba a API: e documentacao, nao caminho de
    // dinheiro. Devolve um corpo que diz o que aconteceu, em vez de 500.
    this.logger.warn('docs/openapi.json nao encontrado. Rode `pnpm gen:openapi`.');
    return JSON.stringify({
      error: {
        code: 'SPEC_UNAVAILABLE',
        message: 'A spec nao foi empacotada nesta imagem. Rode `pnpm gen:openapi`.',
      },
    });
  }
}
