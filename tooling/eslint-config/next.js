import base from './base.js';
import globals from 'globals';

export default [
  ...base,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      // O console e um BFF: nada de token no bundle do cliente.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/server/api-client', '**/server/session'],
              importNames: ['serverApi', 'getSession'],
              message: 'Modulos server-only nao podem ser importados por client components.',
            },
          ],
        },
      ],
    },
  },
];
