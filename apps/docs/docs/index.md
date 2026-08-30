---
title: Comecando
sidebar_position: 0
slug: /
---

# BaaS Connector

Uma **API canônica única** sobre múltiplos BaaS brasileiros — Celcoin, QI Tech,
Dock, Asaas, Woovi — mais um **Mock Bank** com razão de partidas dobradas real
para testes determinísticos.

Integrar com cada BaaS hoje significa escrever e manter uma integração
dedicada por provedor: contratos, autenticação, webhooks, códigos de erro e
semântica de PIX todos diferentes. Trocar de provedor, operar multi-provedor
ou testar sem sandbox é caro e arriscado.

## Subindo a stack

```bash
corepack enable
pnpm install
pnpm up          # postgres, redis, mock-bank, api, worker, console
```

| Serviço | Endereço |
|---|---|
| API canônica | http://localhost:3001/v1 |
| Console | http://localhost:3000 |
| Mock Bank | http://localhost:3002 |
| OpenAPI | http://localhost:3001/docs/v1 |

A stack sobe já configurada com o **Mock Bank**, então você cria uma conta,
recebe um PIX e envia outro sem credencial de nenhum provedor real.

## O primeiro PIX

```ts
import { BaasConnector, BaasOutcomeUnknown } from '@baasconn/sdk';

const baas = new BaasConnector({
  baseUrl: 'http://localhost:3001',
  apiKey: process.env.BAAS_API_KEY!,       // bck_hml_... ou bck_prd_...
  signingSecret: process.env.BAAS_SIGNING_SECRET,
});

try {
  const txn = await baas.pixTransfers.send(contaId, {
    amount: { amount: '50000', currency: 'BRL', scale: 2 },
    destination: { type: 'KEY', key: 'destino@example.com' },
  });
} catch (erro) {
  if (erro instanceof BaasOutcomeUnknown) {
    // O dinheiro PODE ter saido. NUNCA reenvie.
    await baas.operations.get(erro.operationId);
  }
}
```

## Três coisas que este projeto faz diferente

**O ambiente é propriedade da chave.** Uma chave `bck_hml_*` só alcança
conexões de homologação; `bck_prd_*`, só produção. Não há header
`X-Environment`, nem parâmetro `environment`. Um header de ambiente está a um
typo de uma transferência PIX real.

**O desfecho desconhecido é um estado, não um erro.** Quando a chamada ao
provedor dá timeout, não sabemos se o dinheiro se moveu. A transação vai para
`UNKNOWN`, o razão sombra **mantém o hold**, e a API responde 202 — nunca 500,
porque 500 convida ao retry que precisamos evitar. Ver
[status](./taxonomy/status.md).

**A matriz de capacidades é gerada dos manifestos.** Nenhum adapter promete o
que não faz: uma capacidade não declarada devolve **501 antes de qualquer
chamada de rede**, com a nota do manifesto no corpo. A
[matriz publicada](./providers/capability-matrix.md) mostra as lacunas
honestamente — é um dos artefatos mais valiosos do projeto.

## Por onde seguir

- [Dinheiro](./taxonomy/money.md) — o modelo de valor, e por que nunca `float`
- [Fluxos de dinheiro](./guides/money-flows.md) — PIX in, PIX out, conciliação
- [Escrevendo um adapter](./guides/writing-a-provider-adapter.md) — o caminho de contribuição
- [Decisões de arquitetura](./adr/index.md) — por que cada escolha foi feita
