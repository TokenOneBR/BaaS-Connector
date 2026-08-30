import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

import type { AdminRequest } from './admin-session.guard.js';
import { AdminSessionGuard } from './admin-session.guard.js';

/**
 * Rotas de `/admin/v1` que NAO exigem sessao.
 *
 * Lista fechada e explicita, casada por metodo e caminho exatos. Um prefixo
 * (`/admin/v1/auth`) abriria toda rota futura sob ele — e `logout` mora ali e
 * precisa de sessao.
 */
const ANONIMAS: ReadonlySet<string> = new Set([
  'POST /admin/v1/auth/login',
  'POST /admin/v1/auth/refresh',
]);

/**
 * Toda a superficie `/admin/v1` exige sessao de console, por CAMINHO.
 *
 * O padrao anterior era `@Public()` na classe — o que desliga o `ApiKeyGuard`,
 * unico guard de autenticacao global — mais um `@UseGuards(AdminSessionGuard)`
 * lembrado em cada metodo. Isso e FAIL-OPEN: um metodo novo sem o decorator
 * fica anonimo, e a superficie admin e onde se grava credencial de provedor e
 * se cunha API key. Com onze controllers a mais, a pergunta deixa de ser se
 * alguem vai esquecer e passa a ser quando.
 *
 * Aqui a decisao vem do CAMINHO, nao de decorator: um controller novo sob
 * `admin/v1` sem nenhuma anotacao devolve 401. Para ficar anonimo, e preciso
 * editar a lista acima — que e uma linha visivel em revisao, e nao a ausencia
 * de uma linha.
 *
 * Roda ANTES do `ApiKeyGuard` e resolve a rota inteiramente: chave de API nao
 * alcanca `/admin/v1` em hipotese nenhuma (ADR 0006), e sessao de console nao
 * alcanca `/v1`.
 */
@Injectable()
export class AdminSurfaceGuard implements CanActivate {
  constructor(private readonly session: AdminSessionGuard) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    const path = request.path ?? request.url ?? '';

    if (!path.startsWith('/admin/v1')) return true;
    if (ANONIMAS.has(`${request.method} ${normalize(path)}`)) return true;

    // Delega para a implementacao, que ja verifica token, confere se a sessao
    // segue viva e aplica `@MinRole`. Uma so implementacao de RBAC.
    return this.session.canActivate(context);
  }
}

/** Sem barra final: `/admin/v1/auth/login/` e a mesma rota. */
function normalize(path: string): string {
  const semQuery = path.split('?')[0]!;
  return semQuery.length > 1 && semQuery.endsWith('/') ? semQuery.slice(0, -1) : semQuery;
}

/** Exportada para o teste enumerar o que e anonimo, em vez de reescrever a lista. */
export const ROTAS_ANONIMAS: readonly string[] = Object.freeze([...ANONIMAS]);
