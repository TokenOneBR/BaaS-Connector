import base, { moneyAndClockRules } from './base.js';

export default [
  ...base,
  {
    files: ['src/**/*.ts'],
    rules: {
      ...moneyAndClockRules,
      // Decorators do Nest exigem classes vazias em varios pontos.
      '@typescript-eslint/no-extraneous-class': 'off',
    },
  },
];
