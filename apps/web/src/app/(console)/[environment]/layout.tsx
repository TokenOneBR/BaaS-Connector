import { ConsoleRole } from '@baasconn/taxonomy';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { serverApi } from '@/server/api-client';
import { mockBankEnabled } from '@/server/mock-bank';
import { atLeast, requireSession, type ConsoleUser } from '@/server/session';

const AMBIENTES = ['HOMOLOGACAO', 'PRODUCAO'] as const;
type Ambiente = (typeof AMBIENTES)[number];

const NAV: ReadonlyArray<{
  href: string;
  label: string;
  minimo: ConsoleRole;
  quando?: (ambiente: string) => boolean;
}> = [
  { href: 'dashboard', label: 'Painel', minimo: ConsoleRole.VIEWER },
  { href: 'accounts', label: 'Contas', minimo: ConsoleRole.VIEWER },
  { href: 'transactions', label: 'Transacoes', minimo: ConsoleRole.VIEWER },
  { href: 'reconciliation', label: 'Conciliacao', minimo: ConsoleRole.COMPLIANCE },
  { href: 'providers', label: 'Provedores', minimo: ConsoleRole.VIEWER },
  { href: 'api-keys', label: 'API keys', minimo: ConsoleRole.ADMIN },
  { href: 'webhooks', label: 'Webhooks', minimo: ConsoleRole.COMPLIANCE },
  { href: 'audit', label: 'Auditoria', minimo: ConsoleRole.COMPLIANCE },
  {
    href: 'mock-bank',
    label: 'Mock Bank',
    minimo: ConsoleRole.OPERATOR,
    // A tela injeta PIX e avanca o relogio: so existe onde ha um banco falso
    // configurado, e nunca em PRODUCAO. A pagina tambem devolve 404 nos dois
    // casos — o link some para nao oferecer o que nao ha, e o 404 e a regra.
    quando: (ambiente: string) => mockBankEnabled && ambiente !== 'PRODUCAO',
  },
  { href: 'settings', label: 'Ajustes', minimo: ConsoleRole.VIEWER },
];

/**
 * O ambiente vive no CAMINHO, e nao num cookie nem em estado de cliente.
 *
 * Toda rota administrativa exige `?environment=`, e a sessao de console nao o
 * carrega. Uma URL e compartilhavel, sobrevive a recarga, e o proprio
 * framework a valida. Um ambiente guardado em cookie e o desenho em que
 * alguem resolve uma quebra de PRODUCAO numa aba que achava ser homologacao —
 * exatamente o caso que a API se recusa a adivinhar.
 */
export default async function ConsoleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ environment: string }>;
}) {
  const { environment } = await params;
  if (!(AMBIENTES as readonly string[]).includes(environment)) notFound();

  await requireSession();
  const { user } = await serverApi.read<{ user: ConsoleUser }>('/admin/v1/me');
  const producao = environment === 'PRODUCAO';

  return (
    <div className="min-h-screen">
      {producao && (
        <div className="bg-danger px-4 py-1 text-center text-xs font-semibold text-canvas">
          AMBIENTE DE PRODUCAO — as acoes aqui movem dinheiro de verdade
        </div>
      )}

      <div className="flex">
        <nav aria-label="Principal" className="w-56 border-r border-border bg-surface p-4">
          <p className="mb-4 text-sm font-semibold">BaaS Connector</p>

          <ul className="space-y-1 text-sm">
            {NAV.filter(
              (item) => atLeast(user.role, item.minimo) && (item.quando?.(environment) ?? true),
            ).map((item) => (
              <li key={item.href}>
                <Link
                  href={`/${environment}/${item.href}`}
                  className="block rounded px-2 py-1.5 text-text-muted hover:bg-surface-raised hover:text-text"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>

          <div className="mt-6 border-t border-border pt-4 text-xs">
            <p className="mb-2 text-text-muted">Ambiente</p>
            <ul className="space-y-1">
              {AMBIENTES.map((valor: Ambiente) => (
                <li key={valor}>
                  <Link
                    href={`/${valor}/dashboard`}
                    aria-current={valor === environment ? 'true' : undefined}
                    className={
                      valor === environment
                        ? 'block rounded bg-primary px-2 py-1 font-medium text-on-primary'
                        : 'block rounded px-2 py-1 text-text-muted hover:text-text'
                    }
                  >
                    {valor}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Sem `opacity-70`: opacidade sobre o secundario derruba o
              contraste abaixo de 4,5:1, e o axe reprova como `serious`. A
              hierarquia sai da COR, que e verificavel, e nao da transparencia,
              que depende do que estiver atras. */}
          <p className="mt-6 text-xs">
            <span className="text-text">{user.name}</span>
            <br />
            <span className="text-text-muted">{user.role}</span>
          </p>
        </nav>

        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
