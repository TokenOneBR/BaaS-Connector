# ADR 0020 — O SDK e a fronteira do pacote

**Estado:** Aceito · **Data:** 2026-08-30

## Contexto

O SDK é publicado no npm. Um pacote publicado não pode depender de um app
privado (`apps/api` é `private: true` e não existe no registry). Isso força
uma decisão sobre **onde vive o código que os dois lados compartilham**.

Três coisas são compartilhadas de verdade:

1. A **forma** dos DTOs — os schemas Zod de `@baasconn/contracts`.
2. O **verificador de assinatura de webhook** — o cliente precisa verificar o
   que o servidor assinou.
3. O **assinante HMAC de requisição** — o cliente precisa assinar o que o
   servidor verifica.

## Decisão

### Os tipos vêm dos schemas Zod, não de interfaces escritas à mão

`z.infer` sobre os mesmos schemas que validam a requisição em runtime. Não há
um segundo conjunto de interfaces. Uma mudança em `@baasconn/contracts` que
quebre o cliente vira **erro de compilação** no projeto de quem integra, e não
uma surpresa em runtime.

O custo é que `@baasconn/contracts` e `zod` viram dependências públicas do
SDK. É aceito: a alternativa é gerar tipos a partir do `openapi.json`, o que
adiciona um passo de build e uma terceira representação da mesma verdade.

### Ambos os assinantes vivem em `@baasconn/crypto`

O verificador de webhook já morava lá desde o M7, por esta razão. O assinante
HMAC de requisição **mudou de lugar** (`apps/api/src/auth/api-key.service.ts`
→ `packages/crypto/src/request-signature.ts`) quando o SDK passou a precisar
assinar.

`apps/api` reexporta daqui. Assim o servidor que verifica e o cliente que
assina compartilham **uma** implementação — duas cópias da mesma fórmula
divergem, e o sintoma seria o servidor recusar uma assinatura correta, que é
um bug para o qual ninguém olha no lugar certo.

### O SDK não retenta

Um retry cego num `POST /pix/transfers` é o caminho mais curto para o
pagamento duplicado. O kit do servidor só retenta quando a falha é
**provadamente pré-commit**; um cliente não tem como saber isso.

O SDK entrega a informação e a decisão fica com quem integra:

| Situação | Tipo | Repetir |
|---|---|---|
| DNS, conexão recusada, timeout de connect | `BaasTransportError` | Sim — nada chegou |
| `429`, `503` | `BaasApiError.safeToRetry === true` | Sim |
| `422` determinístico | `BaasApiError.safeToRetry === false` | Não |
| `202` numa rota de dinheiro | `BaasOutcomeUnknown` | **Nunca** |

### O 202 tem tipo próprio

`BaasOutcomeUnknown` não é erro nem sucesso — é um terceiro desfecho, e existe
no tipo justamente para que quem integra **não possa** tratá-lo como falha e
reenviar. Devolvê-lo como transação faria marcar o pagamento como enviado;
devolvê-lo como erro genérico faria reenviar. As duas custam dinheiro.

### O ambiente vem da chave, não do construtor

Não existe opção `environment`. Um parâmetro estaria a um typo de uma
transferência PIX real; amarrar ao segredo (`bck_hml_` / `bck_prd_`) torna o
erro catastrófico estruturalmente impossível — e é a convenção que Stripe,
Asaas e Woovi já usam.

### Idempotência é gerada quando falta

Em rotas que a exigem, o SDK cunha um UUID se o chamador não passar chave.
Gerar é melhor que omitir: **sem** chave, um retry de rede vira um segundo
pagamento; **com** chave, vira uma repetição sem efeito.

Essa chave é a do **cliente**, e não a que mandamos ao provedor — o conector
cunha um `operationId` próprio para isso. Confundir as duas quebra assim que
um cliente repete a chave depois de um 500 que aconteceu *depois* de o
provedor ter aceitado o pagamento.

## Consequências

- `packages/crypto` deixa de ser um pacote puramente interno e passa a ter
  parte da superfície pública. Só as duas funções de assinatura são
  reexportadas pelo SDK; o resto (envelope, KMS, blind index) não.
- Os testes do SDK rodam contra um servidor `node:http` **real**, não contra
  `nock`. O SDK é uma pilha HTTP: o que interessa provar é o que sai na rede —
  o cabeçalho de assinatura, os bytes exatos que entraram no digest, o 202.
  É o mesmo raciocínio do `CassetteServer` (ADR 0008).
- `apps/api`, `apps/worker`, `apps/web`, `apps/mock-bank`, `apps/docs` e `e2e`
  seguem `private: true` e ignorados pelo changesets.
