import base, { moneyAndClockRules } from './base.js';

/**
 * Preset dos adapters de provedor.
 *
 * A fronteira de dependencia e o que torna um adapter contribuivel por
 * terceiro sem risco: quem escreve o adapter da QI Tech nao pode alcancar o
 * banco, o container de DI nem o modelo canonico de outro provedor, entao a
 * revisao daquele PR nunca precisa perguntar "isso mexe em mais alguma coisa?".
 *
 * Sem a regra, a fronteira e so uma frase no CONTRIBUTING, e a primeira vez
 * que alguem precisar de um dado que o SPI nao entrega o import aparece e
 * ninguem repara.
 */
const FORBIDDEN = [
  {
    name: '@baasconn/db',
    message:
      'Adapter nao acessa o banco. O que ele precisa saber chega pelo ProviderContext; ' +
      'o que ele produz sai pelas facetas do SPI.',
  },
  {
    name: '@prisma/client',
    message: 'Adapter nao acessa o banco. Ver packages/provider-spi/src/context.ts.',
  },
  {
    name: '@baasconn/crypto',
    message:
      'Credenciais chegam ja decifradas no ProviderContext. Um adapter que cifra ou ' +
      'decifra por conta propria contorna a rotacao de chave do KMS.',
  },
  {
    name: '@baasconn/ledger',
    message: 'O ledger e do conector. O adapter reporta o que o provedor diz, nao lanca partidas.',
  },
  {
    name: '@baasconn/observability',
    message: 'Use o ScopedLogger do ProviderContext, que ja aplica redacao e correlacao.',
  },
];

const FORBIDDEN_PATTERNS = [
  {
    group: ['@nestjs/*', '@nestjs/**'],
    message:
      'Adapter nao depende de framework. Ele e uma classe simples criada por create(ctx); ' +
      'amarra-lo ao Nest impediria reusa-lo no worker e nos testes de conformidade.',
  },
  {
    group: ['**/apps/**'],
    message: 'Adapter nao importa codigo de aplicacao.',
  },
  {
    group: ['@baasconn/adapter-*', '!@baasconn/adapter-kit'],
    message:
      'Um adapter nunca importa outro. Compartilhamento entre provedores pertence ao ' +
      'adapter-kit, onde e revisado por @tokenone/baas-core.',
  },
];

export default [
  ...base,
  {
    files: ['src/**/*.ts'],
    rules: {
      ...moneyAndClockRules,
      'no-restricted-imports': ['error', { paths: FORBIDDEN, patterns: FORBIDDEN_PATTERNS }],
    },
  },
];
