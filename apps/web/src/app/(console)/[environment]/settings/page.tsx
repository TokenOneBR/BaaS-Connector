import { serverApi } from '@/server/api-client';

interface Sessao {
  user: { id: string; email: string; name: string; role: string; mfa_enabled: boolean };
  session_id: string;
  expires_at: string;
}

interface Config {
  environments: string[];
  kms_driver: string;
  cache_version: number;
  balance_cache_ttl_seconds: number;
  signature_tolerance_seconds: number;
  providers_compiled: number;
}

function Linha({ rotulo, valor, nota }: { rotulo: string; valor: string; nota?: string }) {
  return (
    <div className="border-t border-border py-3 first:border-t-0">
      <dt className="text-xs uppercase text-text-muted">{rotulo}</dt>
      <dd className="font-mono text-sm">{valor}</dd>
      {nota && <p className="mt-1 text-xs text-text-muted">{nota}</p>}
    </div>
  );
}

/**
 * Ajustes.
 *
 * Somente leitura, e a leitura ja e a entrega: cada linha aqui e uma
 * pergunta que alguem faz durante um incidente e hoje responde lendo
 * variavel de ambiente por `kubectl exec`.
 *
 * Nao ha edicao porque nao ha o que editar com seguranca daqui. Ambientes
 * atendidos, driver de KMS e versao de cache sao configuracao de DEPLOY: um
 * campo de formulario que os mudasse em runtime deixaria dois pods
 * discordando sobre qual KMS envelopa a proxima credencial. A gestao de
 * membros tampouco entra: nao existe rota administrativa para ela, e um
 * formulario que finge existir e pior que a ausencia.
 */
export default async function SettingsPage() {
  const [sessao, config] = await Promise.all([
    serverApi.read<Sessao>('/admin/v1/me'),
    // `/config` exige ADMIN. Quem chega aqui com papel menor ve so o perfil,
    // e o `catch` e o que torna a tela util para os dois — em vez de 403 na
    // pagina inteira por causa de metade dela.
    serverApi.read<Config>('/admin/v1/config').catch(() => undefined),
  ]);

  return (
    <>
      <h1 className="mb-6 text-xl font-semibold">Ajustes</h1>

      <section className="mb-8 max-w-xl">
        <h2 className="mb-2 text-sm font-semibold uppercase text-text-muted">Perfil</h2>
        <dl className="rounded-[var(--radius-card)] border border-border bg-surface px-4">
          <Linha rotulo="Nome" valor={sessao.user.name} />
          <Linha rotulo="E-mail" valor={sessao.user.email} />
          <Linha rotulo="Papel" valor={sessao.user.role} />
          <Linha
            rotulo="Segundo fator"
            valor={sessao.user.mfa_enabled ? 'habilitado' : 'DESABILITADO'}
            nota={
              sessao.user.mfa_enabled
                ? undefined
                : 'ADMIN e OWNER exigem TOTP no login: sem ele, o acesso a credenciais de provedor fica bloqueado.'
            }
          />
          <Linha
            rotulo="Sessao expira"
            valor={new Date(sessao.expires_at).toLocaleString('pt-BR', {
              timeZone: 'America/Sao_Paulo',
            })}
            nota="O refresh e rotacionado a cada uso; reusar um ja rotacionado revoga TODAS as suas sessoes."
          />
        </dl>
      </section>

      {config && (
        <section className="max-w-xl">
          <h2 className="mb-2 text-sm font-semibold uppercase text-text-muted">Deploy</h2>
          <dl className="rounded-[var(--radius-card)] border border-border bg-surface px-4">
            <Linha
              rotulo="Ambientes atendidos"
              valor={config.environments.join(', ')}
              nota="Uma API key alcanca exatamente um deles, e o ambiente vem do proprio segredo da chave — nunca de um header."
            />
            <Linha rotulo="Driver de KMS" valor={config.kms_driver} />
            <Linha
              rotulo="Versao do cache"
              valor={String(config.cache_version)}
              nota="Incrementar e a alavanca de limpar tudo quando um formato de serializacao muda."
            />
            <Linha
              rotulo="TTL do saldo"
              valor={`${config.balance_cache_ttl_seconds}s`}
              nota="Consultivo: seis regras de bypass obrigam a ir ao provedor, entre elas a checagem de fundos do PIX out."
            />
            <Linha
              rotulo="Tolerancia de assinatura"
              valor={`${config.signature_tolerance_seconds}s`}
            />
            <Linha rotulo="Provedores compilados" valor={String(config.providers_compiled)} />
          </dl>
        </section>
      )}
    </>
  );
}
