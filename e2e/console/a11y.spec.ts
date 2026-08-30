import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { login } from './support.js';

/**
 * Acessibilidade em cinco paginas-chave.
 *
 * Falha em violacao `serious` ou `critical`, e so nelas: `minor` e `moderate`
 * viram ruido que se aprende a ignorar, e um gate que se ignora nao e gate.
 *
 * Regressao visual NAO e gate neste repositorio — intermitencia de captura de
 * tela e hostil a contribuidor externo, que abriria PR de adapter e receberia
 * vermelho por uma diferenca de fonte no runner.
 */
const PAGINAS = [
  { nome: 'login', caminho: '/login', autenticada: false },
  { nome: 'dashboard', caminho: '/HOMOLOGACAO/dashboard', autenticada: true },
  { nome: 'contas', caminho: '/HOMOLOGACAO/accounts', autenticada: true },
  { nome: 'conciliacao', caminho: '/HOMOLOGACAO/reconciliation', autenticada: true },
  { nome: 'provedores', caminho: '/HOMOLOGACAO/providers', autenticada: true },
] as const;

for (const pagina of PAGINAS) {
  test(`${pagina.nome} nao tem violacao seria de acessibilidade`, async ({ page }) => {
    if (pagina.autenticada) await login(page);
    await page.goto(pagina.caminho);

    const resultado = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const graves = resultado.violations.filter(
      (violacao) => violacao.impact === 'serious' || violacao.impact === 'critical',
    );

    expect(
      graves.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    ).toEqual([]);
  });
}
