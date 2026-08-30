import { expect, test } from '@playwright/test';

import { CONSOLE_LOGIN } from './config.js';
import { cookiesVisiveisAoJs, login } from './support.js';

/**
 * As garantias do BFF, exercitadas pelo navegador de verdade.
 *
 * O que os testes de arquivo em `apps/web/src/server/bff.test.ts` provam e a
 * FORMA do codigo. Estes provam o COMPORTAMENTO: que o token realmente nao
 * chega ao `document.cookie`, e que uma URL de console aberta sem sessao
 * realmente para no login.
 */
test.describe('fronteira do BFF', () => {
  test('o token de sessao nao e alcancavel por JavaScript', async ({ page }) => {
    await login(page);

    const visiveis = await cookiesVisiveisAoJs(page);

    // A razao inteira de o Next ser BFF em vez de portador de token: um XSS
    // no console nao consegue exfiltrar a sessao.
    expect(visiveis).not.toContain('baas_session');
    expect(visiveis).not.toContain('baas_refresh');
    // O de CSRF E legivel, de proposito — o formulario o ecoa num campo
    // oculto. Se ele sumisse, toda Server Action passaria a falhar.
    expect(visiveis).toContain('baas_csrf');
  });

  test('rota de console sem sessao para no login', async ({ page }) => {
    await page.goto('/HOMOLOGACAO/accounts');
    await expect(page).toHaveURL(/\/login/);
  });

  test('credencial errada nao distingue e-mail inexistente de senha errada', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('E-mail').fill('ninguem@tokenone.com.br');
    await page.getByLabel('Senha').fill('senha-qualquer-longa');
    await page.getByRole('button', { name: /entrar/i }).click();

    // `getByRole('alert')` sozinho e AMBIGUO: o Next injeta um
    // `__next-route-announcer__` com `role="alert"` em toda pagina. Ancorar no
    // formulario e o que faz o seletor apontar para a mensagem do produto.
    const alerta = page.locator('form').getByRole('alert');
    const inexistente = await alerta.textContent();

    await page.getByLabel('E-mail').fill(CONSOLE_LOGIN.email);
    await page.getByLabel('Senha').fill('senha-errada-mas-longa');
    await page.getByRole('button', { name: /entrar/i }).click();

    // O servidor vai a trabalho real para tornar os dois indistinguiveis:
    // verifica um hash falso quando o usuario nao existe, para o TEMPO nao
    // denunciar. Renderizar textos diferentes desfaria isso na interface.
    expect(await alerta.textContent()).toBe(inexistente);
  });
});

test.describe('telas de operacao', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('o ambiente vive no caminho e o seletor navega', async ({ page }) => {
    await page.getByRole('link', { name: 'PRODUCAO' }).click();
    await expect(page).toHaveURL(/\/PRODUCAO\/dashboard/);

    // A faixa de producao nao e decoracao: e o unico aviso antes de uma acao
    // que move dinheiro de verdade.
    await expect(page.getByText(/AMBIENTE DE PRODUCAO/)).toBeVisible();
  });

  test('um ambiente inventado da 404', async ({ page }) => {
    const resposta = await page.goto('/SANDBOX/dashboard');
    expect(resposta?.status()).toBe(404);
  });

  test('a credencial do provedor aparece mascarada, sem afordancia de revelar', async ({
    page,
  }) => {
    await page.goto('/HOMOLOGACAO/providers');

    await expect(page.getByRole('heading', { name: /provedores/i })).toBeVisible();
    // Nao existe rota que sirva o valor, entao nao pode existir botao que o
    // prometa. Um botao inerte ensina o operador a duvidar dos outros.
    await expect(page.getByRole('button', { name: /revelar/i })).toHaveCount(0);
    expect(await page.content()).toContain('••••');
  });

  test('a tela do Mock Bank existe em homologacao e nao em producao', async ({ page }) => {
    await page.goto('/HOMOLOGACAO/mock-bank');
    await expect(page.getByRole('heading', { name: 'Mock Bank' })).toBeVisible();

    // Injetar PIX e avancar relogio sao acoes de banco falso. A existencia do
    // caminho em producao ja e o risco — nao a probabilidade de alguem clicar.
    const producao = await page.goto('/PRODUCAO/mock-bank');
    expect(producao?.status()).toBe(404);
  });

  test('as telas de operacao carregam sem erro de servidor', async ({ page }) => {
    for (const rota of [
      'dashboard',
      'accounts',
      'transactions',
      'reconciliation',
      'providers',
      'webhooks',
      'audit',
      'settings',
    ]) {
      const resposta = await page.goto(`/HOMOLOGACAO/${rota}`);
      expect(resposta?.status(), rota).toBe(200);
      // Um Server Component que lanca vira uma pagina de erro com 200 no
      // `dev`; no `start` vira 500. Conferir os dois e o que torna este laco
      // uma verificacao e nao um passeio.
      await expect(page.locator('h1'), rota).toBeVisible();
    }
  });

  test('API keys exige ADMIN, e o operador nao ve o item no menu', async ({ page }) => {
    // O papel semeado e OPERATOR. `api-keys` e ADMIN — cunhar uma chave e a
    // mesma classe de acao que gravar credencial de provedor.
    await expect(page.getByRole('link', { name: 'API keys' })).toHaveCount(0);
  });
});
