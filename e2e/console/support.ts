import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Page } from '@playwright/test';

import { CONSOLE_LOGIN, HARNESS_STATE_FILE, type HarnessState } from './config.js';

/**
 * Le `document.cookie` DENTRO do navegador.
 *
 * O tipo vem daqui, e nao da lib `dom` do TypeScript: incluir `dom` neste
 * pacote traria o `fetch` do navegador por cima do do Node, e os specs de API
 * — que passam `Buffer` como corpo — deixariam de compilar. Um `globalThis`
 * estreitado num lugar so custa esta funcao e nao custa nada aos outros.
 *
 * `context.cookies()` NAO serviria: ele devolve tambem os `httpOnly`, que sao
 * exatamente os que queremos provar invisiveis.
 */
export function cookiesVisiveisAoJs(page: Page): Promise<string> {
  return page.evaluate(
    () => (globalThis as unknown as { document: { cookie: string } }).document.cookie,
  );
}

export function harnessState(): HarnessState {
  return JSON.parse(
    readFileSync(join(import.meta.dirname, HARNESS_STATE_FILE), 'utf8'),
  ) as HarnessState;
}

/**
 * Entra pelo formulario de verdade.
 *
 * Nao ha atalho que injete cookie: o login E o caminho que estamos provando —
 * a senha vai ao servidor, os tokens voltam como cookie `httpOnly`, e o
 * navegador nunca ve nenhum dos dois. Um atalho que gravasse o cookie a mao
 * deixaria de exercitar exatamente isso.
 */
export async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(CONSOLE_LOGIN.email);
  await page.getByLabel('Senha').fill(CONSOLE_LOGIN.password);
  await page.getByRole('button', { name: /entrar/i }).click();
  await page.waitForURL(/\/HOMOLOGACAO\/dashboard/);
}
