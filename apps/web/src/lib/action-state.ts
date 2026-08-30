/**
 * O que uma Server Action devolve ao formulario.
 *
 * Mora em `lib/` e nao em `server/` porque o componente de formulario e de
 * CLIENTE e precisa do tipo. Importa-lo de `server/actions` faria um arquivo
 * `'use client'` referenciar um modulo `server-only` — a regra de lint recusa
 * mesmo sendo `import type`, e com razao: um `import type` que alguem
 * transforma em import de valor durante um refactor levaria o cliente da API,
 * com o cookie de sessao, para dentro do bundle do navegador.
 */
export interface ActionState {
  error?: string;
  ok?: boolean;
  /** Segredo exibido UMA vez. Nunca persiste, nunca volta numa leitura. */
  secret?: string;
}
