import base, { moneyAndClockRules } from './base.js';

export default [
  ...base,
  {
    files: ['src/**/*.ts'],
    rules: {
      ...moneyAndClockRules,

      /**
       * DESLIGADO de proposito nos apps NestJS.
       *
       * `consistent-type-imports` reescreve um import usado apenas como
       * anotacao de tipo para `import type`, o que apaga o valor em runtime.
       * Num construtor decorado, esse valor e exatamente o que o
       * `emitDecoratorMetadata` grava para o container de DI resolver a
       * dependencia. Com a regra ligada, o autofix quebra a injecao e o erro
       * so aparece no boot, como "Nest can't resolve dependencies (?, Object)".
       */
      '@typescript-eslint/consistent-type-imports': 'off',

      // Decorators do Nest exigem classes vazias em varios pontos.
      '@typescript-eslint/no-extraneous-class': 'off',
    },
  },
];
