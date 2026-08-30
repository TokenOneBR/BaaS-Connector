#!/usr/bin/env tsx
/**
 * Emite `openapi.json` a partir do Nest E dos schemas Zod.
 *
 * Duas fontes, cada uma boa numa coisa:
 *
 *   O NEST enumera os caminhos e os verbos — introspeccao dos decorators, sem
 *   ninguem manter uma lista. Uma rota nova aparece sozinha.
 *
 *   O ZOD de `@baasconn/contracts` da a FORMA do corpo e da resposta. Sao os
 *   mesmos schemas que validam a requisicao em runtime, entao a spec nao pode
 *   descrever algo que a API rejeitaria.
 *
 * A ligacao entre os dois e a tabela `ROTAS` abaixo, e ela nao pode apodrecer:
 * uma rota `/v1` que o Nest registra e a tabela nao conhece FAZ O SCRIPT
 * FALHAR. E o que impede a spec de ficar em dia por acidente — o autor da rota
 * nova e obrigado a declarar o contrato dela, que e exatamente a revisao que
 * um mantenedor precisa fazer quando alguem mexe na API publica.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  zAccount,
  zBalance,
  zCreateAccount,
  zCreateCharge,
  zCreatePixKey,
  zCreateRefund,
  zOnboardingCase,
  zOperation,
  zPixCharge,
  zPixKey,
  zPixKeyResolution,
  zSendPix,
  zStatementEntry,
  zTransaction,
} from '@baasconn/contracts';
import { NestFactory } from '@nestjs/core';
import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

interface Rota {
  resumo: string;
  /** Capacidade exigida; vira `x-baas-capability` na spec. */
  capability?: string;
  scopes?: string[];
  /** Assinatura HMAC obrigatoria com chave de producao. */
  signed?: boolean;
  idempotent?: boolean;
  body?: ZodTypeAny;
  resposta?: ZodTypeAny;
  /** Resposta e uma pagina por cursor daquele item. */
  lista?: boolean;
}

const ROTAS: Record<string, Rota> = {
  'POST /v1/accounts': {
    resumo: 'Cria uma conta PF ou PJ',
    capability: 'accounts.create.pf|accounts.create.pj',
    scopes: ['accounts:write'],
    idempotent: true,
    body: zCreateAccount,
    resposta: zAccount,
  },
  'GET /v1/accounts': {
    resumo: 'Lista contas',
    scopes: ['accounts:read'],
    resposta: zAccount,
    lista: true,
  },
  'GET /v1/accounts/:id': {
    resumo: 'Detalha uma conta',
    scopes: ['accounts:read'],
    resposta: zAccount,
  },
  'POST /v1/accounts/:id/block': {
    resumo: 'Bloqueia a conta',
    capability: 'accounts.updateStatus',
    scopes: ['accounts:write'],
    resposta: zAccount,
  },
  'POST /v1/accounts/:id/unblock': {
    resumo: 'Desbloqueia a conta',
    capability: 'accounts.updateStatus',
    scopes: ['accounts:write'],
    resposta: zAccount,
  },
  'POST /v1/accounts/:id/close': {
    resumo: 'Encerra a conta',
    capability: 'accounts.close',
    scopes: ['accounts:close'],
    resposta: zAccount,
  },
  'GET /v1/accounts/:id/balance': {
    resumo: 'Saldo, com a frescura declarada',
    capability: 'balance.get',
    scopes: ['balance:read'],
    resposta: zBalance,
  },
  'GET /v1/accounts/:accountId/statement': {
    resumo: 'Extrato por cursor',
    capability: 'statement.list',
    scopes: ['statement:read'],
    resposta: zStatementEntry,
    lista: true,
  },
  'GET /v1/accounts/:id/onboarding': {
    resumo: 'Situacao do onboarding',
    capability: 'onboarding.status.get',
    scopes: ['onboarding:read'],
    resposta: zOnboardingCase,
  },
  'POST /v1/onboarding/:caseId/documents': {
    resumo: 'Envia documento de KYC/KYB (multipart, em stream)',
    capability: 'onboarding.document.upload',
    scopes: ['onboarding:documents'],
  },
  'POST /v1/onboarding/:caseId/requirements/:code/fulfill': {
    resumo: 'Cumpre uma pendencia',
    capability: 'onboarding.requirements.fulfill',
    scopes: ['onboarding:write'],
    resposta: zOnboardingCase,
  },
  'POST /v1/accounts/:accountId/pix/keys': {
    resumo: 'Cria chave PIX',
    capability: 'pix.keys.create',
    scopes: ['pix:keys:write'],
    body: zCreatePixKey,
    resposta: zPixKey,
  },
  'GET /v1/accounts/:accountId/pix/keys': {
    resumo: 'Lista chaves PIX',
    capability: 'pix.keys.list',
    scopes: ['pix:keys:read'],
    resposta: zPixKey,
    lista: true,
  },
  'GET /v1/accounts/:accountId/pix/keys/resolve': {
    resumo: 'Resolve uma chave no DICT',
    capability: 'pix.keys.resolve',
    scopes: ['pix:keys:read'],
    resposta: zPixKeyResolution,
  },
  'DELETE /v1/accounts/:accountId/pix/keys/:keyId': {
    resumo: 'Remove chave PIX',
    capability: 'pix.keys.delete',
    scopes: ['pix:keys:write'],
  },
  'POST /v1/accounts/:accountId/pix/charges': {
    resumo: 'Cria cobranca estatica ou dinamica',
    capability: 'pix.charge.static.create|pix.charge.dynamic.create',
    scopes: ['pix:write'],
    body: zCreateCharge,
    resposta: zPixCharge,
  },
  'GET /v1/accounts/:accountId/pix/charges': {
    resumo: 'Lista cobrancas',
    capability: 'pix.charge.list',
    scopes: ['pix:read'],
    resposta: zPixCharge,
    lista: true,
  },
  'GET /v1/accounts/:accountId/pix/charges/:txid': {
    resumo: 'Detalha cobranca',
    capability: 'pix.charge.get',
    scopes: ['pix:read'],
    resposta: zPixCharge,
  },
  'POST /v1/accounts/:accountId/pix/charges/:txid/cancel': {
    resumo: 'Cancela cobranca',
    capability: 'pix.charge.cancel',
    scopes: ['pix:write'],
    resposta: zPixCharge,
  },
  'POST /v1/accounts/:accountId/pix/transfers': {
    resumo: 'Envia PIX. Responde 202 quando o desfecho e desconhecido',
    capability: 'pix.out.send',
    scopes: ['pix:write'],
    signed: true,
    idempotent: true,
    body: zSendPix,
    resposta: zTransaction,
  },
  'POST /v1/accounts/:accountId/pix/refunds': {
    resumo: 'Devolve um PIX recebido',
    capability: 'pix.refund.create',
    scopes: ['pix:refund'],
    signed: true,
    idempotent: true,
    body: zCreateRefund,
    resposta: zTransaction,
  },
  'GET /v1/transactions': {
    resumo: 'Lista transacoes',
    scopes: ['pix:read'],
    resposta: zTransaction,
    lista: true,
  },

  'GET /v1/transactions/:id': {
    resumo: 'Detalha transacao',
    scopes: ['pix:read'],
    resposta: zTransaction,
  },
  'GET /v1/operations/:id': {
    resumo: 'Estado de uma operacao assincrona ou em UNKNOWN',
    scopes: ['pix:read'],
    resposta: zOperation,
  },
  'POST /v1/operations/:id/reconcile': {
    resumo: 'Consulta o provedor agora. NUNCA reenvia',
    scopes: ['pix:write'],
    resposta: zOperation,
  },
};

interface CamadaExpress {
  route?: { path: string; methods: Record<string, boolean> };
}

/**
 * Carrega o `AppModule` do `dist`, e nao do `src`.
 *
 * O `tsx` usa esbuild, que NAO emite `emitDecoratorMetadata` — sem ela o
 * container de DI do Nest nao resolve dependencia por tipo e a aplicacao nem
 * sobe. E o mesmo motivo de `gen-capability-matrix.ts` ler os adapters do
 * `dist`. Exige `pnpm build` antes; o CI ja constroi.
 */
async function carregarAppModule(): Promise<unknown> {
  const caminho = join(process.cwd(), 'apps/api/dist/app.module.js');
  if (!existsSync(caminho)) {
    console.error('apps/api/dist nao existe. Rode `pnpm build` antes.');
    process.exit(1);
  }
  const modulo = (await import(caminho)) as { AppModule: unknown };
  return modulo.AppModule;
}

async function main(): Promise<void> {
  process.env.NODE_ENV = 'test';
  process.env.KMS_MASTER_SECRET ??= 'segredo-mestre-para-emitir-a-spec-openapi';
  process.env.DATABASE_URL ??= 'postgresql://baas:baas@127.0.0.1:5432/baas?schema=public';

  const app = await NestFactory.create((await carregarAppModule()) as never, {
    logger: false,
    bodyParser: false,
  });
  await app.init();

  const express = app.getHttpAdapter().getInstance() as {
    _router: { stack: CamadaExpress[] };
  };

  const registradas = new Set<string>();
  for (const camada of express._router.stack) {
    if (!camada.route) continue;
    for (const [verbo, ativo] of Object.entries(camada.route.methods)) {
      if (ativo) registradas.add(`${verbo.toUpperCase()} ${camada.route.path}`);
    }
  }
  await app.close();

  // Somente `/v1`. `/admin/v1` e `/webhooks` sao superficies internas: a
  // primeira so o console usa, e a segunda tem contrato de PROVEDOR, nao
  // nosso. Publica-las na spec do cliente convidaria alguem a integrar com
  // elas, e ai passariam a ser publicas de fato.
  const publicas = [...registradas].filter((rota) => rota.includes(' /v1/'));

  const semContrato = publicas.filter((rota) => !ROTAS[rota]);
  if (semContrato.length > 0) {
    console.error('Rotas /v1 registradas que a tabela de contratos nao conhece:\n');
    for (const rota of semContrato) console.error(`  ${rota}`);
    console.error(
      '\nAdicione cada uma a `ROTAS` em scripts/gen-openapi.ts. A spec e o',
      '\ncontrato publico: uma rota que ninguem documentou e uma rota que os',
      '\nclientes vao descobrir por engenharia reversa.',
    );
    process.exit(1);
  }

  const naTabela = Object.keys(ROTAS).filter((rota) => !publicas.includes(rota));
  if (naTabela.length > 0) {
    console.error('Rotas na tabela que a API NAO registra (removidas ou renomeadas):\n');
    for (const rota of naTabela) console.error(`  ${rota}`);
    process.exit(1);
  }

  const schemas: Record<string, unknown> = {};
  const registrar = (nome: string, schema: ZodTypeAny): string => {
    schemas[nome] ??= zodToJsonSchema(schema, { target: 'openApi3', $refStrategy: 'none' });
    return `#/components/schemas/${nome}`;
  };

  const paths: Record<string, Record<string, unknown>> = {};
  for (const [chave, rota] of Object.entries(ROTAS).sort(([a], [b]) => a.localeCompare(b))) {
    const [verbo, caminho] = chave.split(' ') as [string, string];
    // OpenAPI usa `{id}`; o Express usa `:id`.
    const openapiPath = caminho.replace(/:(\w+)/g, '{$1}');
    const parametros = [...caminho.matchAll(/:(\w+)/g)].map(([, nome]) => ({
      name: nome,
      in: 'path',
      required: true,
      schema: { type: 'string' },
    }));

    const headers: unknown[] = [];
    if (rota.idempotent) {
      headers.push({
        name: 'Idempotency-Key',
        in: 'header',
        required: true,
        description:
          'Chave do CLIENTE. Nao e a que mandamos ao provedor: o conector cunha um operationId proprio.',
        schema: { type: 'string', maxLength: 255 },
      });
    }
    if (rota.signed) {
      headers.push(
        { name: 'X-Baas-Timestamp', in: 'header', required: true, schema: { type: 'string' } },
        { name: 'X-Baas-Nonce', in: 'header', required: true, schema: { type: 'string' } },
        {
          name: 'X-Baas-Signature',
          in: 'header',
          required: true,
          description: 'HMAC-SHA256 de METHOD\\nPATH\\nTS\\nNONCE\\nsha256(body).',
          schema: { type: 'string' },
        },
      );
    }

    const nomeBase = openapiPath
      .replace(/[^a-zA-Z0-9]+/g, ' ')
      .trim()
      .split(' ')
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join('');

    const respostaSchema = rota.resposta
      ? rota.lista
        ? {
            type: 'object',
            properties: {
              object: { type: 'string', enum: ['list'] },
              data: { type: 'array', items: { $ref: registrar(`${nomeBase}Item`, rota.resposta) } },
              page: {
                type: 'object',
                properties: {
                  has_more: { type: 'boolean' },
                  next_cursor: { type: 'string', nullable: true },
                  limit: { type: 'integer' },
                },
              },
            },
          }
        : {
            $ref: registrar(
              `${nomeBase}${verbo === 'POST' ? 'Created' : 'Response'}`,
              rota.resposta,
            ),
          }
      : undefined;

    paths[openapiPath] ??= {};
    paths[openapiPath][verbo.toLowerCase()] = {
      summary: rota.resumo,
      operationId: `${verbo.toLowerCase()}${nomeBase}`,
      // Extensao vendor: o SDK gerado consegue dizer QUAIS provedores
      // suportam a chamada, lendo a matriz de capacidades.
      ...(rota.capability ? { 'x-baas-capability': rota.capability } : {}),
      ...(rota.scopes ? { 'x-baas-scopes': rota.scopes } : {}),
      ...(rota.signed ? { 'x-baas-signature-required': true } : {}),
      security: [{ apiKey: [] }],
      parameters: [...parametros, ...headers],
      ...(rota.body
        ? {
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { $ref: registrar(`${nomeBase}Request`, rota.body) },
                },
              },
            },
          }
        : {}),
      responses: {
        [verbo === 'POST' ? '201' : verbo === 'DELETE' ? '204' : '200']: {
          description: 'Sucesso',
          ...(respostaSchema
            ? { content: { 'application/json': { schema: respostaSchema } } }
            : {}),
        },
        ...(rota.signed
          ? {
              '202': {
                description:
                  'Desfecho DESCONHECIDO: mandamos ao provedor e nao sabemos se o dinheiro se moveu. Consulte GET /v1/operations/{operationId}. NUNCA reenvie.',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        status: { type: 'string', enum: ['processing'] },
                        operation_id: { type: 'string' },
                      },
                    },
                  },
                },
              },
            }
          : {}),
        '4XX': {
          description: 'Erro canonico',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Erro' } } },
        },
        '5XX': {
          description: 'Erro canonico',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Erro' } } },
        },
      },
    };
  }

  schemas.Erro = {
    type: 'object',
    required: ['error'],
    properties: {
      error: {
        type: 'object',
        required: ['code', 'message'],
        properties: {
          code: { type: 'string' },
          category: { type: 'string' },
          message: { type: 'string' },
          message_ptbr: { type: 'string', description: 'De catalogo, nao traducao automatica.' },
          details: { type: 'array', items: { type: 'object' } },
          request_id: { type: 'string' },
          docs_url: { type: 'string' },
          provider: {
            type: 'object',
            description: 'Preservado LITERALMENTE, para escalacao com o provedor.',
            properties: {
              slug: { type: 'string' },
              code: { type: 'string' },
              message: { type: 'string' },
            },
          },
        },
      },
    },
  };

  const spec = {
    openapi: '3.1.0',
    info: {
      title: 'BaaS Connector — API canonica',
      version: '0.1.0',
      description: [
        'API canonica unica sobre multiplos BaaS brasileiros.',
        '',
        'O AMBIENTE e propriedade da chave (`bck_hml_*` / `bck_prd_*`), nunca de',
        'um header ou de um parametro: um header de ambiente esta a um typo de',
        'uma transferencia PIX real.',
        '',
        'Dinheiro no wire e sempre `{ amount, currency, scale }` com `amount` em',
        'STRING de unidades menores. Nunca use `parseFloat`.',
        '',
        'Paginacao e sempre por CURSOR. Offset sobre tabela que recebe insert',
        'constante produz duplicata e buraco, e num extrato financeiro isso e',
        'bug de correcao.',
      ].join('\n'),
      license: { name: 'Apache-2.0', url: 'https://www.apache.org/licenses/LICENSE-2.0' },
    },
    servers: [{ url: '{baseUrl}', variables: { baseUrl: { default: 'http://localhost:3001' } } }],
    components: {
      securitySchemes: {
        apiKey: {
          type: 'http',
          scheme: 'bearer',
          description: 'API key `bck_hml_<keyId>_<secret>` ou `bck_prd_<keyId>_<secret>`.',
        },
      },
      schemas,
    },
    paths,
  };

  const destino = join(process.cwd(), 'docs/openapi.json');
  writeFileSync(destino, `${JSON.stringify(spec, null, 2)}\n`);
  console.warn(
    `openapi.json emitido: ${Object.keys(paths).length} caminho(s), ${publicas.length} operacao(oes).`,
  );
}

void main();
