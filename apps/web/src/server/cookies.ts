import 'server-only';

/*
 * Sem extensao `.js` nos imports relativos.
 *
 * O resto do monorepo usa `NodeNext`, que a EXIGE. O Next usa
 * `moduleResolution: 'Bundler'`, que a REJEITA — o webpack procura um arquivo
 * `.js` que nao existe. A diferenca e do preset `@baasconn/tsconfig/next.json`
 * e vale so para este app.
 */

/**
 * Os tres cookies do console.
 *
 * O Next e um BFF, nao portador de token: o access token e o refresh token
 * nunca chegam ao JavaScript do navegador. XSS no console nao exfiltra sessao,
 * e nao existe historia de `localStorage` para revisar.
 */
export const COOKIES = {
  /** Access token RS256. `httpOnly`. */
  access: 'baas_at',
  /** Refresh opaco `${sessionId}.${secret}`. `httpOnly`. */
  refresh: 'baas_rt',
  /** Token de CSRF. LEGIVEL por JS de proposito — ver `csrf.ts`. */
  csrf: 'baas_csrf',
} as const;

/**
 * `lax`, e nao `strict`, nos dois cookies de token.
 *
 * `strict` quebraria todo deep link para o console — um alerta por e-mail
 * apontando para uma quebra apresentaria a tela de login a quem ja esta
 * logado. A defesa contra CSRF e o double-submit de `csrf.ts`, e nao o
 * atributo do cookie de sessao.
 *
 * O de CSRF e `strict`, e PRECISA ser: e isso que faz o double-submit
 * funcionar. Um POST vindo de outro site nao carrega o cookie, entao o
 * atacante nao consegue nem LER o valor para eco-lo.
 */
export function tokenCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

export function csrfCookieOptions() {
  return {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/',
  };
}

/** Instante de expiracao do JWT, em segundos unix. Sem verificar assinatura. */
export function expiryOf(accessToken: string): number | undefined {
  const payload = accessToken.split('.')[1];
  if (!payload) return undefined;

  try {
    const decoded = JSON.parse(
      Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
    ) as { exp?: number };
    return decoded.exp;
  } catch {
    return undefined;
  }
}
