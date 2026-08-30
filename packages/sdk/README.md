# @baasconn/sdk

Cliente TypeScript da API canonica (`/v1`) do BaaS Connector.

```bash
npm i @baasconn/sdk
```

```ts
import { BaasConnector } from '@baasconn/sdk';

const baas = new BaasConnector({
  baseUrl: 'https://api.suaempresa.com.br',
  apiKey: process.env.BAAS_API_KEY!,        // bck_hml_... ou bck_prd_...
  signingSecret: process.env.BAAS_SIGNING_SECRET,
});
```

## O ambiente vem da chave

Nao existe opcao `environment`, e a ausencia e deliberada. Uma chave
`bck_hml_*` so alcanca conexoes de homologacao; `bck_prd_*`, so producao. Um
parametro estaria a um typo de uma transferencia PIX real; amarrar ao segredo
torna esse erro estruturalmente impossivel.

```ts
baas.environment; // 'HOMOLOGACAO' | 'PRODUCAO'
```

## Os tres desfechos de uma transferencia

Isto e o que mais diferencia integrar com PIX de integrar com um gateway de
cartao:

```ts
try {
  const txn = await baas.pixTransfers.send(contaId, { ... });
  // Aceita. O webhook `pix.out.settled` confirma a liquidacao.
} catch (erro) {
  if (erro instanceof BaasOutcomeUnknown) {
    // DESCONHECIDO. O dinheiro PODE ter saido. NUNCA reenvie.
    const op = await baas.operations.get(erro.operationId);
    return;
  }
  if (erro instanceof BaasApiError && !erro.safeToRetry) {
    // Recusa determinista: saldo, chave invalida, limite.
    return;
  }
  throw erro;
}
```

`BaasOutcomeUnknown` nao e um erro disfarcado: e um terceiro desfecho, e ele
existe no tipo justamente para que voce nao possa trata-lo como falha e
reenviar. O conector mantem o hold no razao sombra e um worker consulta o
provedor pela chave de idempotencia ate resolver.

## Idempotencia

O SDK gera uma `Idempotency-Key` quando a rota exige e voce nao passa uma.
Gerar e melhor que omitir: sem chave, um retry de rede vira um segundo
pagamento. Passe a sua quando quiser controlar o replay:

```ts
await baas.pixTransfers.send(contaId, payload, { idempotencyKey: pedido.id });
```

Repetir a mesma chave com o mesmo corpo devolve a resposta original. Com corpo
diferente, a API responde `422 IDEMPOTENCY_KEY_REUSED`.

## Retry

**Nao ha retry automatico**, e a ausencia e a decisao. Um retry cego num
`POST /pix/transfers` e o caminho mais curto para o pagamento duplicado. O SDK
entrega a informacao para voce decidir:

| Situacao | Tipo | Repetir |
|---|---|---|
| DNS, conexao recusada, timeout de connect | `BaasTransportError` | Sim — nada chegou ao servidor |
| `429`, `503` | `BaasApiError`, `safeToRetry === true` | Sim, respeitando `Retry-After` |
| `422` de saldo, chave invalida | `BaasApiError`, `safeToRetry === false` | Nao — vai falhar de novo |
| `202` numa rota de dinheiro | `BaasOutcomeUnknown` | **Nunca** — consulte a operacao |

## Saldo: a frescura e sempre declarada

```ts
const saldo = await baas.accounts.balance(contaId);
saldo._meta.freshness; // { source: 'cached' | 'provider' | 'ledger', age_seconds, as_of }

// Forca ida ao provedor.
await baas.accounts.balance(contaId, { consistency: 'strong' });
```

O padrao serve do cache quando ele tem menos de 30s — mas o padrao so e seguro
porque a declaracao e obrigatoria e porque seis bypasses sao impostos por
codigo, entre eles a checagem de fundos na autorizacao do PIX out.

## Verificar webhooks

```ts
import { verifyWebhookSignature } from '@baasconn/sdk';

const resultado = verifyWebhookSignature({
  header: req.headers['x-baas-signature'],
  payload: corpoCru,           // os BYTES, antes de qualquer parse
  secrets: [segredoAtual, segredoAnterior],
  nowSeconds: Math.floor(Date.now() / 1000),
  toleranceSeconds: 300,
});
```

Passe o corpo **cru**: reserializar o JSON muda a assinatura. Durante a
rotacao, passe os dois segredos — nos enviamos dois elementos `v1=` no mesmo
cabecalho, e qualquer um deles confere.

E o mesmo codigo que assina do nosso lado, nao uma reimplementacao — por isso
vive em `@baasconn/crypto` e e reexportado aqui.

## Tipos

Todos os tipos sao inferidos dos **mesmos schemas Zod** que a API usa para
validar a requisicao. Nao ha um segundo conjunto de interfaces escrito a mao:
uma mudanca no modelo canonico vira erro de compilacao no seu projeto, e nao
uma surpresa em runtime.

## Licenca

Apache-2.0.
