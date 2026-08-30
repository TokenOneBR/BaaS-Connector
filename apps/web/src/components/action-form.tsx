'use client';

import { useActionState } from 'react';

import { CsrfField } from './csrf-field';

import type { ActionState } from '@/lib/action-state';

type Action = (previous: ActionState, form: FormData) => Promise<ActionState>;

/**
 * Formulario de uma Server Action, com CSRF e estado embutidos.
 *
 * Existe porque a tela do Mock Bank tem sete formularios que so diferem nos
 * campos: repetir `useActionState`, `CsrfField`, o `role="alert"` e o botao
 * desabilitado em cada um deles seria sete oportunidades de esquecer o
 * primeiro. O `CsrfField` aqui dentro faz par com o `assertCsrf` que
 * `defineAction` impoe do outro lado — as duas metades da regra ficam
 * impossiveis de separar.
 */
export function ActionForm({
  action,
  submitLabel,
  children,
  destructive,
}: {
  action: Action;
  submitLabel: string;
  children?: React.ReactNode;
  destructive?: boolean;
}) {
  const [state, dispatch, pending] = useActionState(action, {});

  return (
    <form action={dispatch} className="space-y-3">
      <CsrfField />
      {children}

      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p role="status" className="text-sm text-success">
          Feito.
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className={`rounded px-3 py-1.5 text-sm font-medium disabled:opacity-60 ${
          destructive ? 'bg-danger text-canvas' : 'bg-primary text-on-primary'
        }`}
      >
        {pending ? 'Enviando...' : submitLabel}
      </button>
    </form>
  );
}

export function Campo({
  label,
  name,
  type = 'text',
  required,
  placeholder,
  defaultValue,
  hint,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  defaultValue?: string | number;
  hint?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-text-muted">{label}</span>
      <input
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        defaultValue={defaultValue}
        className="w-full max-w-sm rounded border border-border bg-canvas px-3 py-2"
      />
      {hint && <span className="mt-1 block text-xs text-text-muted">{hint}</span>}
    </label>
  );
}

export function Marcador({
  label,
  name,
  defaultChecked,
}: {
  label: string;
  name: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} />
      {label}
    </label>
  );
}
