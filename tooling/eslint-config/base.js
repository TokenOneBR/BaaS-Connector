import js from '@eslint/js';
import tseslint from 'typescript-eslint';
// eslint-plugin-import 2.x usa APIs de SourceCode removidas no ESLint 9;
// import-x e o fork mantido que suporta flat config.
import importPlugin from 'eslint-plugin-import-x';
import globals from 'globals';

/**
 * Regras transversais do projeto.
 *
 * As duas regras `no-restricted-syntax` abaixo nao sao estilo: dinheiro em
 * ponto flutuante e relogio nao injetado sao as duas causas raiz mais comuns
 * de bug de correcao num conector financeiro.
 */
export const moneyAndClockRules = {
  'no-restricted-syntax': [
    'error',
    {
      selector:
        'TSPropertySignature > Identifier[name=/(Cents|Amount|Balance)$/] ~ TSTypeAnnotation TSNumberKeyword',
      message:
        'Valores monetarios usam bigint em unidades menores (centavos), nunca number. Ver packages/taxonomy/src/money.',
    },
    {
      selector: "MemberExpression[object.name='Date'][property.name='now']",
      message:
        'Use o Clock injetado em vez de Date.now(), para que os testes possam controlar o tempo.',
    },
  ],
};

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.node },
    },
    plugins: { 'import-x': importPlugin },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'import-x/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
  {
    files: ['**/*.{test,spec}.ts', '**/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-restricted-syntax': 'off',
      'no-console': 'off',
    },
  },
  { ignores: ['dist/**', '.next/**', 'coverage/**', 'node_modules/**', '**/*.d.ts'] },
);
