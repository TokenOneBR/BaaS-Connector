'use client';

import { useActionState, useState } from 'react';

import { criarChave } from './actions';

import { CsrfField } from '@/components/csrf-field';

const ESCOPOS = [
  'accounts:read',
  'accounts:write',
  'balance:read',
  'pix:read',
  'pix:write',
  'pix:keys:read',
  'pix:keys:write',
  'statement:read',
  'webhooks:read',
  'reconciliation:read',
] as const;

export function NovaChave({ environment }: { environment: string }) {
  const [state, action, pending] = useActionState(criarChave, {});
  const [guardei, setGuardei] = useState(false);

  // O segredo vive SO no estado desta acao, nunca em armazenamento do
  // navegador. Recarregar a pagina o perde — que e exatamente a garantia.
  if (state.secret) {
    return (
      <div className="rounded-[var(--radius-card)] border border-warning bg-surface p-4">
        <p className="mb-2 text-sm font-medium text-warning">
          Guarde esta chave agora: ela nao pode ser recuperada depois.
        </p>
        <code className="block break-all rounded bg-canvas p-3 font-mono text-xs">
          {state.secret}
        </code>

        <label className="mt-4 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={guardei}
            onChange={(event) => setGuardei(event.target.checked)}
          />
          Guardei a chave em local seguro
        </label>

        <button
          type="button"
          disabled={!guardei}
          onClick={() => window.location.reload()}
          className="mt-3 rounded bg-primary px-3 py-1.5 text-sm font-medium text-on-primary disabled:opacity-50"
        >
          Fechar
        </button>
      </div>
    );
  }

  return (
    <form
      action={action}
      className="rounded-[var(--radius-card)] border border-border bg-surface p-4"
    >
      <CsrfField />
      <input type="hidden" name="environment" value={environment} />

      <label className="mb-3 block text-sm">
        <span className="mb-1 block text-text-muted">Nome</span>
        <input
          name="name"
          required
          maxLength={128}
          className="w-full max-w-sm rounded border border-border bg-canvas px-3 py-2"
        />
      </label>

      <fieldset className="mb-3">
        <legend className="mb-1 text-sm text-text-muted">Escopos</legend>
        <div className="flex flex-wrap gap-3 text-sm">
          {ESCOPOS.map((escopo) => (
            <label key={escopo} className="flex items-center gap-1.5">
              <input type="checkbox" name="scopes" value={escopo} />
              <span className="font-mono text-xs">{escopo}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {state.error && (
        <p role="alert" className="mb-3 text-sm text-danger">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-on-primary disabled:opacity-60"
      >
        {pending ? 'Criando...' : 'Criar chave'}
      </button>
    </form>
  );
}
