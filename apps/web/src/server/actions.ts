import 'server-only';

import { revalidatePath } from 'next/cache';

import { serverApi } from './api-client';
import { assertCsrf } from './csrf';

import type { ActionState } from '@/lib/action-state';

export type { ActionState } from '@/lib/action-state';

/**
 * Toda Server Action passa por aqui.
 *
 * Assinatura unica, para a checagem de CSRF nao depender de alguem lembrar de
 * chama-la. Uma acao nova escrita a mao sem `assertCsrf` e indistinguivel de
 * uma acao sem protecao nenhuma — e as acoes deste console gravam credencial
 * de provedor e resolvem divergencia de dinheiro.
 */
export function defineAction<T>(
  handler: (form: FormData) => Promise<T>,
  options: { revalidate?: string } = {},
) {
  return async (_previous: ActionState, form: FormData): Promise<ActionState> => {
    try {
      await assertCsrf(form);
      const resultado = await handler(form);
      if (options.revalidate) revalidatePath(options.revalidate, 'page');

      const secret =
        resultado && typeof resultado === 'object' && 'secret' in resultado
          ? String((resultado as { secret: unknown }).secret)
          : undefined;

      return { ok: true, secret };
    } catch (error) {
      // A mensagem da API ja e canonica e em portugues, com `message_ptbr`
      // vindo de catalogo. Reescreve-la aqui perderia o codigo que o suporte
      // usa para escalar.
      return { error: error instanceof Error ? error.message : 'Falha inesperada.' };
    }
  };
}

export { serverApi };
