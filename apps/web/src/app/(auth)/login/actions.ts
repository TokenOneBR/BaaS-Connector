'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { COOKIES, csrfCookieOptions, tokenCookieOptions } from '@/server/cookies';
import { newCsrfToken } from '@/server/csrf';

const API = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';
const REFRESH_TTL = Number(process.env.REFRESH_TOKEN_TTL ?? 2_592_000);

export interface LoginState {
  error?: string;
  needsTotp?: boolean;
}

/**
 * Troca senha por cookies.
 *
 * Server Action, e nao Route Handler, porque e aqui que a acao pode gravar
 * cookie — e porque o formulario ja e um `<form action={...}>` sem JavaScript,
 * o que faz o login funcionar mesmo com o bundle ainda carregando.
 *
 * NAO ha `assertCsrf` aqui: o token de CSRF nasce na primeira navegacao
 * autenticada, e exigi-lo no login criaria um problema de ovo e galinha. A
 * protecao do login e outra — credencial mais `allowedOrigins`.
 */
export async function login(_previous: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get('email') ?? '');
  const password = String(form.get('password') ?? '');
  const totp = String(form.get('totp_code') ?? '');

  const response = await fetch(`${API}/admin/v1/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Repassa o IP de quem esta entrando. Sem isto, `ConsoleSession.ipAddress`
      // e todo `actorIp` de auditoria gravariam o IP do POD do console, e a
      // pergunta "quem fez isso, de onde" ficaria sem resposta.
      ...forwardedFor(await headers()),
    },
    body: JSON.stringify({ email, password, ...(totp ? { totp_code: totp } : {}) }),
    cache: 'no-store',
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string };
    };

    // A API LANCA `MFA_REQUIRED` em vez de devolver uma flag, e o console le o
    // codigo. Duas fontes para a mesma verdade seriam uma a mais.
    if (body.error?.code === 'MFA_REQUIRED') return { needsTotp: true };

    // Mensagem UNICA para credencial errada e e-mail inexistente. O servidor
    // vai a trabalho real para tornar os dois indistinguiveis (verifica um
    // hash falso quando o usuario nao existe); renderizar textos diferentes
    // desfaria isso na interface.
    return { error: 'E-mail ou senha invalidos.' };
  }

  const body = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  const jar = await cookies();
  jar.set(COOKIES.access, body.access_token, tokenCookieOptions(body.expires_in));
  jar.set(COOKIES.refresh, body.refresh_token, tokenCookieOptions(REFRESH_TTL));

  // O token de CSRF nasce AQUI, junto com a sessao.
  //
  // O middleware tambem o emite, e por muito tempo isso pareceu suficiente.
  // Nao e: o `redirect` de uma Server Action vira navegacao RSC no cliente, e
  // o cookie que o middleware grava naquela resposta nao chega ao navegador.
  // O resultado e uma sessao inteira sem `baas_csrf` — e como `assertCsrf`
  // LANCA quando o cookie falta, TODA Server Action falharia, incluindo as
  // que resolvem divergencia de dinheiro. Um Playwright pegou isto lendo
  // `document.cookie`; nenhum teste de unidade pegaria.
  //
  // A emissao no middleware fica como rede: cobre a sessao que perdeu o
  // cookie e a que e anterior a esta linha.
  jar.set(COOKIES.csrf, newCsrfToken(), csrfCookieOptions());

  redirect('/HOMOLOGACAO/dashboard');
}

function forwardedFor(incoming: Headers): Record<string, string> {
  const encaminhado = incoming.get('x-forwarded-for') ?? incoming.get('x-real-ip');
  return encaminhado ? { 'x-forwarded-for': encaminhado } : {};
}
