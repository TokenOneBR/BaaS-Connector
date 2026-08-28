import base from './tooling/eslint-config/base.js';

export default [
  ...base,
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/generated/**',
      'deploy/**',
    ],
  },
];
