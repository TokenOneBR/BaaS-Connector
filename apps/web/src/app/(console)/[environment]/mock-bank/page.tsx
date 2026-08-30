import { notFound } from 'next/navigation';

import {
  avancarRelogio,
  configurarFalhas,
  decidirOnboarding,
  injetarPixIn,
  limparFalhas,
  resetarRelogio,
  resetarTudo,
} from './actions';

import { ActionForm, Campo, Marcador } from '@/components/action-form';
import { mockBankEnabled, tryGet } from '@/server/mock-bank';

interface Falhas {
  latencyMs: number;
  errorRate: number;
  forceStatus?: number;
  duplicateWebhooks: boolean;
  reorderWebhooks: boolean;
  invalidSignature: boolean;
}

/** O que `GET /_control/ledger/verify` devolve: um veredito e, se ruim, o porque. */
interface Invariantes {
  ok: boolean;
  violations?: string[];
}

function Painel({
  titulo,
  descricao,
  children,
}: {
  titulo: string;
  descricao: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <h2 className="text-sm font-semibold">{titulo}</h2>
      <p className="mb-3 mt-1 text-xs text-text-muted">{descricao}</p>
      {children}
    </section>
  );
}

/**
 * Mock Bank.
 *
 * A tela que torna a premissa "Mock Bank para testes" usavel por QA e em
 * demo, e nao so pela suite automatizada. Tudo aqui e o plano `_control` do
 * banco falso — nada disso existe num provedor de verdade.
 *
 * Ela some quando `MOCK_BANK_URL` nao esta definida. Nao e ocultacao
 * cosmetica: sem a variavel nao ha o que chamar, e uma tela de botoes inertes
 * ensinaria o operador a duvidar dos botoes das outras telas.
 */
export default async function MockBankPage({
  params,
}: {
  params: Promise<{ environment: string }>;
}) {
  const { environment } = await params;

  // PRODUCAO nunca. Injetar PIX de entrada e avancar relogio sao acoes de
  // banco falso, e a existencia do caminho ja e o risco — nao a probabilidade
  // de alguem clicar.
  if (!mockBankEnabled || environment === 'PRODUCAO') notFound();

  const [falhas, relogio, razao] = await Promise.all([
    tryGet<Falhas>('/faults'),
    tryGet<{ now: string }>('/clock'),
    tryGet<Invariantes>('/ledger/verify'),
  ]);

  const indisponivel = falhas.error ?? relogio.error ?? razao.error;

  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Mock Bank</h1>
      <p className="mb-6 text-sm text-text-muted">
        Banco falso com razao de partidas dobradas real. O comportamento do onboarding e funcao pura
        do CPF/CNPJ, e o do PIX out e funcao dos centavos — entao um teste nunca precisa mexer em
        estado para reproduzir um cenario.
      </p>

      {indisponivel && (
        <p
          role="alert"
          className="mb-6 rounded border border-danger bg-surface p-3 text-sm text-danger"
        >
          Mock Bank nao respondeu: {indisponivel}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Painel
          titulo="Estado do razao"
          descricao="Debitos e creditos do banco falso inteiro. Um razao desbalanceado e sempre defeito, nunca cenario."
        >
          {razao.data ? (
            <div className="font-mono text-sm">
              <p className={razao.data.ok ? 'text-success' : 'text-danger'}>
                {razao.data.ok ? 'BALANCEADO' : 'DESBALANCEADO'}
              </p>
              {razao.data.violations?.map((violacao) => (
                <p key={violacao} className="mt-1 text-xs text-danger">
                  {violacao}
                </p>
              ))}
            </div>
          ) : (
            <p className="text-sm text-text-muted">—</p>
          )}
        </Painel>

        <Painel
          titulo="Relogio logico"
          descricao="Avancar o relogio exercita a janela de 90 dias da devolucao e a expiracao de cobranca sem `sleep`. Um teste que espera 90 dias nao e um teste."
        >
          <p className="mb-3 font-mono text-sm">{relogio.data?.now ?? '—'}</p>
          <ActionForm action={avancarRelogio} submitLabel="Avancar">
            <div className="flex gap-3">
              <Campo label="Segundos" name="seconds" type="number" defaultValue={0} />
              <Campo label="Dias" name="days" type="number" defaultValue={0} />
            </div>
          </ActionForm>
          <div className="mt-3 border-t border-border pt-3">
            <ActionForm action={resetarRelogio} submitLabel="Voltar ao tempo real" />
          </div>
        </Painel>

        <Painel
          titulo="Injetar PIX de entrada"
          descricao="Como se um terceiro tivesse pagado. Informe a conta OU a chave PIX — a chave e o caminho que mais se parece com a realidade."
        >
          <ActionForm action={injetarPixIn} submitLabel="Injetar">
            <Campo label="ID da conta" name="account_id" placeholder="acc_..." />
            <Campo label="ou chave PIX" name="pix_key" placeholder="EVP, CPF, e-mail..." />
            <Campo
              label="Valor"
              name="amount"
              required
              placeholder="1500.00"
              hint="Decimal, como a REST do Mock Bank devolve."
            />
            <Campo label="Nome do pagador" name="payer_name" placeholder="Pagador Simulado" />
          </ActionForm>
        </Painel>

        <Painel
          titulo="Forcar decisao de onboarding"
          descricao="Atalho para o caso que o valor magico do documento nao cobre. O caminho normal e o sufixo do CPF/CNPJ."
        >
          <ActionForm action={decidirOnboarding} submitLabel="Decidir">
            <Campo label="ID do onboarding" name="onboarding_id" required placeholder="onb_..." />
            <label className="block text-sm">
              <span className="mb-1 block text-text-muted">Decisao</span>
              <select
                name="decision"
                className="w-full max-w-sm rounded border border-border bg-canvas px-3 py-2"
              >
                <option value="APPROVE">APPROVE</option>
                <option value="REJECT">REJECT</option>
                <option value="PENDING">PENDING</option>
              </select>
            </label>
            <Campo label="Motivo" name="reason" placeholder="DATA_MISMATCH" />
          </ActionForm>
        </Painel>

        <Painel
          titulo="Injecao de falha"
          descricao="Latencia, taxa de erro, status forcado, webhook duplicado, webhook fora de ordem e assinatura invalida. Sao os caminhos que o conector promete absorver — e aqui e onde se confere que absorve."
        >
          <ActionForm action={configurarFalhas} submitLabel="Aplicar">
            <div className="flex gap-3">
              <Campo
                label="Latencia (ms)"
                name="latency_ms"
                type="number"
                defaultValue={falhas.data?.latencyMs ?? 0}
              />
              <Campo
                label="Taxa de erro"
                name="error_rate"
                type="number"
                defaultValue={falhas.data?.errorRate ?? 0}
                hint="0 a 1."
              />
            </div>
            <Campo
              label="Status forcado"
              name="force_status"
              type="number"
              defaultValue={falhas.data?.forceStatus}
              hint="Vazio desliga."
            />
            <Marcador
              label="Entregar webhook duas vezes"
              name="duplicate_webhooks"
              defaultChecked={falhas.data?.duplicateWebhooks}
            />
            <Marcador
              label="Entregar webhook fora de ordem"
              name="reorder_webhooks"
              defaultChecked={falhas.data?.reorderWebhooks}
            />
            <Marcador
              label="Assinar com segredo errado"
              name="invalid_signature"
              defaultChecked={falhas.data?.invalidSignature}
            />
          </ActionForm>
          <div className="mt-3 border-t border-border pt-3">
            <ActionForm action={limparFalhas} submitLabel="Limpar todas" />
          </div>
        </Painel>

        <Painel
          titulo="Resetar estado"
          descricao="Apaga contas, pagamentos, razao e tokens do Mock Bank. Nao ha volta."
        >
          <ActionForm action={resetarTudo} submitLabel="Resetar" destructive>
            <Campo
              label="Confirmacao"
              name="confirmacao"
              required
              placeholder="RESETAR"
              hint="Digite RESETAR para liberar."
            />
          </ActionForm>
        </Painel>
      </div>
    </>
  );
}
