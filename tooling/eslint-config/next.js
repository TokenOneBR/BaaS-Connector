import base from './base.js';
import globals from 'globals';

export default [
  ...base,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    /**
     * Componentes de cliente.
     *
     * A garantia de verdade e o pacote `server-only`, importado no topo de
     * cada modulo de `src/server/`: ele QUEBRA O BUILD se o modulo entrar num
     * bundle de cliente. Isso e mais forte que lint e nao tem falso positivo.
     *
     * Esta regra e a segunda linha, e vale por DIRETORIO: o ESLint nao le o
     * conteudo do arquivo e nao distingue `'use client'` de Server Component.
     * A versao anterior mirava `src/**` inteiro e acusava TODO Server
     * Component que chamasse a API — o que empurra qualquer um a desligar a
     * regra por completo, e ai nao sobra nem a segunda linha.
     *
     * Convencao: `src/components/` e cliente, `src/app/` e servidor por
     * padrao.
     */
    files: ['src/components/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/server/*', '@/server/*'],
              message:
                'Componente de cliente nao importa modulo server-only: o token nunca chega ao navegador.',
            },
          ],
        },
      ],
    },
  },
];
