'use client';

/**
 * O eco do token de CSRF.
 *
 * Le do cookie `baas_csrf`, que e legivel por JS de proposito — e o unico que
 * e. Como o cookie e `sameSite: strict`, um POST vindo de outro site nao o
 * carrega, entao o atacante nao consegue nem LER o valor para forja-lo aqui.
 */
export function CsrfField() {
  const token =
    typeof document === 'undefined'
      ? ''
      : (document.cookie
          .split('; ')
          .find((part) => part.startsWith('baas_csrf='))
          ?.slice(11) ?? '');

  return <input type="hidden" name="csrf_token" value={decodeURIComponent(token)} readOnly />;
}
