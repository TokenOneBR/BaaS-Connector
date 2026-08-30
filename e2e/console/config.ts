/**
 * Portas e credenciais compartilhadas entre a config do Playwright, o
 * processo do harness e os specs.
 *
 * Portas fixas e altas, escolhidas para nao colidirem com o `pnpm dev` de
 * ninguem (3000/3001) nem com o compose.
 */
export const PORTS = {
  api: 4301,
  mockBank: 4302,
  web: 4300,
} as const;

export const CONSOLE_LOGIN = {
  email: 'operador@tokenone.com.br',
  password: 'senha-do-e2e-bem-longa',
} as const;

/** Escrito pelo harness, lido pelos specs. Fica fora do git. */
export const HARNESS_STATE_FILE = '.harness.json';

export interface HarnessState {
  apiUrl: string;
  mockBankUrl: string;
  connectionId: string;
}
