import 'server-only';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { COOKIES, tokenCookieOptions } from './cookies';
import { getSession } from './session';

/**
 * Endereco INTERNO da API.
 *
 * Lido em runtime, nunca embutido no bundle: e o que permite a mesma imagem
 * servir homologacao e producao. E como so o servidor o le, o `/admin/v1` nao
 * precisa ser exposto no ingress.
 */
const API = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

interface Options {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | undefined>;
}

/**
 * Cliente da API para uso no SERVIDOR.
 *
 * Anexa `Authorization: Bearer` a partir do cookie — nao repassa o cookie
 * adiante, para a superficie que a API ve continuar explicita. O guard do
 * servidor tambem so aceita Bearer, entao as duas pontas concordam.
 *
 * Duas entradas de proposito:
 *
 *   `read`   — seguro em renderizacao. NAO grava cookie, porque um Server
 *              Component nao pode; num 401 redireciona para o login, e o
 *              middleware da proxima navegacao renova.
 *   `mutate` — so em Server Action ou Route Handler, onde gravar cookie e
 *              permitido; renova no lugar e tenta de novo uma vez.
 *
 * As duas moram no mesmo modulo para a regra de lint que proibe client
 * component de importar `serverApi` continuar cobrindo as duas.
 */
export const serverApi = {
  async read<T>(path: string, options: Options = {}): Promise<T> {
    const session = await getSession();
    if (!session) redirect('/login');

    const response = await call(path, session.accessToken, options);
    if (response.status === 401) {
      // Nao da para renovar aqui. O middleware renova ANTES da renderizacao;
      // chegar aqui significa que ele nao conseguiu, e o desfecho honesto e
      // mandar para o login em vez de renderizar meia pagina.
      redirect(`/login?next=${encodeURIComponent(path)}`);
    }

    return unwrap<T>(response);
  },

  async mutate<T>(path: string, options: Options = {}): Promise<T> {
    const session = await getSession();
    if (!session) redirect('/login');

    let response = await call(path, session.accessToken, options);

    if (response.status === 401) {
      const renovado = await refreshTokens();
      if (!renovado) redirect('/login?reason=expired');
      response = await call(path, renovado, options);
    }

    return unwrap<T>(response);
  },
};

async function call(path: string, token: string, options: Options): Promise<Response> {
  const url = new URL(`${API}${path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  return fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    // O console mostra estado operacional: uma pagina de conciliacao servida
    // do cache do Next mostraria quebras ja resolvidas.
    cache: 'no-store',
  });
}

async function unwrap<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;

  const body = (await response.json().catch(() => ({}))) as {
    error?: { code?: string; message?: string };
  };

  if (!response.ok) {
    throw new ApiError(
      response.status,
      body.error?.code ?? 'UNKNOWN',
      body.error?.message ?? 'Falha ao falar com a API.',
    );
  }

  return body as T;
}

/**
 * Troca o refresh por um par novo e grava os cookies.
 *
 * So chamavel de Server Action ou Route Handler. Ver `middleware.ts` para a
 * renovacao proativa, que e onde ela normalmente acontece.
 */
export async function refreshTokens(): Promise<string | undefined> {
  const jar = await cookies();
  const refresh = jar.get(COOKIES.refresh)?.value;
  if (!refresh) return undefined;

  const response = await fetch(`${API}/admin/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refresh }),
    cache: 'no-store',
  });

  if (!response.ok) {
    // Pode ser REUSO de um refresh ja rotacionado, e nesse caso a API acabou
    // de revogar TODAS as sessoes do usuario. Nao ha o que tentar de novo:
    // uma segunda tentativa e um segundo reuso, e o unico efeito seria
    // incrementar de novo a metrica que alguem esta lendo durante o incidente.
    jar.delete(COOKIES.access);
    jar.delete(COOKIES.refresh);
    return undefined;
  }

  const body = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  jar.set(COOKIES.access, body.access_token, tokenCookieOptions(body.expires_in));
  jar.set(COOKIES.refresh, body.refresh_token, tokenCookieOptions(REFRESH_TTL));
  return body.access_token;
}

const REFRESH_TTL = Number(process.env.REFRESH_TOKEN_TTL ?? 2_592_000);
