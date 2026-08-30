'use client';

import { useActionState } from 'react';

import { login, type LoginState } from './actions';

export default function LoginPage() {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <form
        action={action}
        className="w-full max-w-sm rounded-[var(--radius-card)] border border-border bg-surface p-8"
      >
        <h1 className="mb-1 text-lg font-semibold">BaaS Connector</h1>
        <p className="mb-6 text-sm text-text-muted">Console de operacao</p>

        <label className="mb-4 block text-sm">
          <span className="mb-1 block text-text-muted">E-mail</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="username"
            className="w-full rounded border border-border bg-canvas px-3 py-2"
          />
        </label>

        <label className="mb-4 block text-sm">
          <span className="mb-1 block text-text-muted">Senha</span>
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="w-full rounded border border-border bg-canvas px-3 py-2"
          />
        </label>

        {state.needsTotp && (
          <label className="mb-4 block text-sm">
            <span className="mb-1 block text-text-muted">Codigo de verificacao</span>
            <input
              name="totp_code"
              inputMode="numeric"
              pattern="\d{6}"
              required
              autoFocus
              autoComplete="one-time-code"
              className="w-full rounded border border-border bg-canvas px-3 py-2 tracking-widest"
            />
          </label>
        )}

        {state.error && (
          <p role="alert" className="mb-4 text-sm text-danger">
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          /* Texto ESCURO sobre a primaria: branco sobre #FFC012 da ~1,7:1 e
             reprova como `serious` no axe. Ver tokens.css. */
          className="w-full rounded bg-primary px-3 py-2 font-medium text-on-primary disabled:opacity-60"
        >
          {pending ? 'Entrando...' : 'Entrar'}
        </button>
      </form>
    </main>
  );
}
