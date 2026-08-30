import 'server-only';

import { type ConsoleRole } from '@baasconn/taxonomy';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { COOKIES, expiryOf } from './cookies';

export interface ConsoleSession {
  accessToken: string;
  expiresAt?: number;
}

/**
 * A sessao do request atual, ou `undefined`.
 *
 * Le PRIMEIRO o header `x-baas-access-token`, e so depois o cookie. Esse
 * header e escrito pelo `middleware.ts` quando ele renova o token na mesma
 * requisicao: um Server Component nao pode gravar cookie, entao sem essa
 * costura a pagina renderizaria com o token velho e o cookie novo — e a
 * renovacao custaria um redirect.
 */
export async function getSession(): Promise<ConsoleSession | undefined> {
  const doHeader = (await headers()).get('x-baas-access-token');
  const token = doHeader ?? (await cookies()).get(COOKIES.access)?.value;
  if (!token) return undefined;

  return { accessToken: token, expiresAt: expiryOf(token) };
}

/** Sessao obrigatoria. Sem ela, vai para o login preservando o destino. */
export async function requireSession(): Promise<ConsoleSession> {
  const session = await getSession();
  if (!session) redirect('/login');
  return session;
}

export interface ConsoleUser {
  id: string;
  email: string;
  name: string;
  role: ConsoleRole;
  mfaEnabled: boolean;
}

/**
 * Ordem de privilegio, ESPELHADA do servidor.
 *
 * `COMPLIANCE` fica ABAIXO de `OPERATOR`, e nao e engano: o papel existe para
 * auditar, nao para operar. Esconder item de menu por papel e COSMETICO — quem
 * autoriza e a API. Isto so evita mostrar um link que resultaria em 403.
 */
const ORDEM: Readonly<Record<ConsoleRole, number>> = {
  VIEWER: 0,
  COMPLIANCE: 1,
  OPERATOR: 2,
  ADMIN: 3,
  OWNER: 4,
};

export function atLeast(role: ConsoleRole, minimo: ConsoleRole): boolean {
  return (ORDEM[role] ?? -1) >= (ORDEM[minimo] ?? Number.POSITIVE_INFINITY);
}
