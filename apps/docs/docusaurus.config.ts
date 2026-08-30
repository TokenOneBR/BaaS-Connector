import type * as Preset from '@docusaurus/preset-classic';
import type { Config } from '@docusaurus/types';
import { themes } from 'prism-react-renderer';

/**
 * Site de documentacao.
 *
 * pt-BR e o idioma PADRAO, e nao o ingles. O publico primario sao integradores
 * brasileiros, o suporte e brasileiro, e o catalogo de mensagens de erro do
 * produto ja e em portugues. O ingles existe como segundo idioma para o OSPO
 * de banco e provedor conseguir avaliar o projeto.
 *
 * Nao ha `versioning`. Versionar documentacao antes da primeira release
 * produz uma pasta `versioned_docs/` que ninguem le e um `versions.json` que
 * todo PR precisa lembrar de atualizar.
 */
const config: Config = {
  title: 'BaaS Connector',
  tagline: 'Uma API canonica para os BaaS brasileiros',
  favicon: 'img/favicon.svg',

  url: 'https://tokenonebr.github.io',
  baseUrl: '/BaaS-Connector/',
  organizationName: 'TokenOneBR',
  projectName: 'BaaS-Connector',

  // `throw` e nao `warn`: um link quebrado numa documentacao de integracao
  // financeira manda alguem implementar pela memoria em vez de pela spec.
  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'throw',

  i18n: {
    defaultLocale: 'pt-BR',
    locales: ['pt-BR', 'en'],
    localeConfigs: {
      'pt-BR': { label: 'Portugues', htmlLang: 'pt-BR' },
      en: { label: 'English', htmlLang: 'en' },
    },
  },

  /**
   * `detect` faz `.md` ser lido como CommonMark, e nao como MDX.
   *
   * Os guias vivem em `docs/` na raiz e sao lidos como Markdown normal no
   * GitHub. Sob MDX, um `<corpo>` em prosa vira tag JSX nao fechada e quebra
   * o build — e "escapar angulo para o gerador de site" e exatamente o tipo
   * de imposto que faz um contribuidor parar de editar documentacao.
   *
   * Um arquivo que QUISER JSX se chama `.mdx` e diz isso no nome.
   */
  markdown: { format: 'detect' },

  presets: [
    [
      'classic',
      {
        docs: {
          path: 'docs',
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/TokenOneBR/BaaS-Connector/tree/main/apps/docs/',
        },
        // Sem blog: um blog vazio num site de documentacao e uma promessa de
        // conteudo que ninguem vai manter.
        blog: false,
        theme: { customCss: './src/css/custom.css' },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: { defaultMode: 'dark', respectPrefersColorScheme: true },
    navbar: {
      title: 'BaaS Connector',
      items: [
        { type: 'docSidebar', sidebarId: 'principal', position: 'left', label: 'Documentacao' },
        { to: '/providers/capability-matrix', label: 'Provedores', position: 'left' },
        { type: 'localeDropdown', position: 'right' },
        {
          href: 'https://github.com/TokenOneBR/BaaS-Connector',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Documentacao',
          items: [
            { label: 'Comecando', to: '/' },
            { label: 'Escrevendo um adapter', to: '/guides/writing-a-provider-adapter' },
            { label: 'Matriz de capacidades', to: '/providers/capability-matrix' },
          ],
        },
        {
          title: 'Projeto',
          items: [
            { label: 'GitHub', href: 'https://github.com/TokenOneBR/BaaS-Connector' },
            {
              label: 'Decisoes de arquitetura',
              to: '/adr/',
            },
          ],
        },
      ],
      copyright: `Apache-2.0 · TokenOne · ${new Date().getFullYear()}`,
    },
    prism: {
      theme: themes.github,
      darkTheme: themes.dracula,
      additionalLanguages: ['bash', 'json', 'sql', 'yaml'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
