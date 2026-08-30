import 'server-only';

import { randomBytes, timingSafeEqual } from 'node:crypto';

import { cookies } from 'next/headers';

import { COOKIES } from './cookies';

export const CSRF_FIELD = 'csrf_token';

export function newCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Double-submit: cookie `strict` legivel mais campo oculto.
 *
 * Tres camadas se compoem aqui. O Next confere `Origin` contra `Host`; o
 * `allowedOrigins` em `next.config.ts` declara a origem explicitamente; e este
 * token fecha o caso. Como o cookie e `sameSite: strict`, um POST de outro
 * site nao o carrega — entao o atacante nao consegue nem LER o valor para
 * eco-lo no corpo.
 *
 * LANCA quando nao confere. Devolver `false` seria um booleano que alguem
 * eventualmente ignora, e uma Server Action que ignora a checagem de CSRF e
 * indistinguivel de uma que nao a tem.
 */
export async function assertCsrf(form: FormData): Promise<void> {
  const enviado = form.get(CSRF_FIELD);
  const cookie = (await cookies()).get(COOKIES.csrf)?.value;

  if (typeof enviado !== 'string' || !cookie) {
    throw new Error('Requisicao sem token de CSRF.');
  }

  const a = Buffer.from(enviado);
  const b = Buffer.from(cookie);
  // Comprimentos diferentes fazem `timingSafeEqual` LANCAR, e a comparacao
  // precisa ser de tempo constante mesmo assim.
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error('Token de CSRF nao confere.');
  }
}
