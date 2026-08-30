import { NextResponse, type NextRequest } from 'next/server';

const ACCESS = 'baas_at';
const REFRESH = 'baas_rt';
const CSRF = 'baas_csrf';

/** Renova com esta folga do vencimento. */
const MARGEM_SEGUNDOS = 60;

const API = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';
const REFRESH_TTL = Number(process.env.REFRESH_TOKEN_TTL ?? 2_592_000);

/**
 * O UNICO lugar que le E grava cookie numa navegacao GET.
 *
 * Este e o problema central do BFF no App Router: um Server Component NAO PODE
 * gravar cookie. O Next lanca `Cookies can only be modified in a Server Action
 * or Route Handler`. Ou seja, o token nao pode ser renovado durante a
 * renderizacao da pagina — que e exatamente quando ele vence.
 *
 * O middleware roda ANTES da renderizacao e pode gravar na resposta. Entao ele
 * ve o `exp`, e se falta menos que a margem, troca o refresh por um par novo.
 *
 * A parte que faz isso valer a pena e o REESCRITO DO HEADER: sem ele, a
 * pagina renderizaria com o cookie novo mas com o token velho ainda na
 * requisicao, e a renovacao custaria um redirect. Com ele, a renderizacao
 * seguinte, na MESMA requisicao, ja ve o token novo.
 *
 * A decodificacao do `exp` NAO verifica assinatura, de proposito: o edge
 * runtime nao tem `jsonwebtoken`, e a autoridade e a API de qualquer forma.
 * Isto e uma dica de agendamento, nao um controle de acesso.
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === '/login') return NextResponse.next();

  const access = request.cookies.get(ACCESS)?.value;
  const refresh = request.cookies.get(REFRESH)?.value;

  if (!access && !refresh) {
    return NextResponse.redirect(
      new URL(`/login?next=${encodeURIComponent(pathname)}`, request.url),
    );
  }

  const response = precisaRenovar(access) ? await renovar(request, refresh) : NextResponse.next();

  // O token de CSRF nasce aqui, na primeira navegacao autenticada. Legivel por
  // JS de proposito: o formulario o ecoa num campo oculto, e o cookie e
  // `strict`, entao um POST de outro site nao o carrega e o atacante nao
  // consegue ler o valor para forjar o eco.
  if (!request.cookies.get(CSRF)) {
    response.cookies.set(CSRF, novoToken(), {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
    });
  }

  return response;
}

function precisaRenovar(access: string | undefined): boolean {
  if (!access) return true;
  const exp = expiracao(access);
  if (exp === undefined) return true;
  return exp - Math.floor(Date.now() / 1000) < MARGEM_SEGUNDOS;
}

async function renovar(request: NextRequest, refresh: string | undefined) {
  if (!refresh) {
    return NextResponse.redirect(new URL('/login?reason=expired', request.url));
  }

  const resposta = await fetch(`${API}/admin/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refresh }),
    cache: 'no-store',
  });

  if (!resposta.ok) {
    // Pode ser REUSO de um refresh ja rotacionado — e nesse caso a API acabou
    // de revogar TODAS as sessoes do usuario. Nao ha o que tentar de novo:
    // uma segunda tentativa e um segundo reuso. Limpa e manda para o login com
    // motivo, para a tela poder explicar em vez de so pedir a senha.
    const saida = NextResponse.redirect(new URL('/login?reason=security', request.url));
    saida.cookies.delete(ACCESS);
    saida.cookies.delete(REFRESH);
    return saida;
  }

  const corpo = (await resposta.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  // Reescreve o header da requisicao EM CURSO. E o que evita o redirect.
  const headers = new Headers(request.headers);
  headers.set('x-baas-access-token', corpo.access_token);

  const saida = NextResponse.next({ request: { headers } });
  const opcoes = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
  };
  saida.cookies.set(ACCESS, corpo.access_token, { ...opcoes, maxAge: corpo.expires_in });
  saida.cookies.set(REFRESH, corpo.refresh_token, { ...opcoes, maxAge: REFRESH_TTL });
  return saida;
}

function expiracao(token: string): number | undefined {
  const payload = token.split('.')[1];
  if (!payload) return undefined;
  try {
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return (JSON.parse(json) as { exp?: number }).exp;
  } catch {
    return undefined;
  }
}

function novoToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export const config = {
  // Tudo menos assets e a API interna do proprio Next.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/health).*)'],
};
