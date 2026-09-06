# Auditoria do adapter Celcoin

**Data:** 2026-09-06 · **Commit auditado:** `7a04997` · **Escopo:**
`packages/adapters/celcoin/`

As 12 fixtures deste adapter estão marcadas `source: 'handcrafted-from-docs'`
porque, quando foram escritas, `developers.celcoin.com.br` era inalcançável pelo
proxy de egresso do ambiente. Elas provam que os mappers são **coerentes entre
si**; nunca provaram que estão certos.

Com o MCP `cel_agents` a documentação passou a ser alcançável, e a skill
`cel-agents` trouxe um relato de campo de quem integrou. Esta auditoria compara
o adapter contra as duas fontes.

## Como ler as evidências

| Marca | Significado |
|---|---|
| 📗 **oficial** | confirmado na documentação da Celcoin, com o documento citado |
| 📙 **campo** | vem da skill `cel-agents` — relato de integração real, não confirmado na documentação |
| 🔎 **suspeita** | divergência aparente que ainda precisa de confirmação |

A distinção importa: a própria skill avisa que documentação e comportamento
divergem na Celcoin. Onde as duas concordam, a confiança é alta; onde só a skill
fala, o achado é forte mas merece verificação em sandbox.

---

## Bloqueantes — o fluxo não funciona hoje

### 1. 📗 O prefixo de todas as rotas de conta está errado

`endpoints.ts` declara:

```ts
accountPf: '/baas-onboarding/v1/account/natural-person/create',
accountPj: '/baas-onboarding/v1/account/business/create',
proposal:  '/baas-onboarding/v1/account/proposal',
```

A definição OpenAPI oficial de **Criar Conta PF** declara `servers[0].url` como
`https://sandbox.openfinance.celcoin.dev/baas/v2/` e o path como
`/account/natural-person/create`. O caminho real é portanto
**`/baas/v2/account/natural-person/create`** — o mesmo prefixo `/baas/v2` que já
usamos para PIX e DICT.

Não existe `/baas-onboarding`. Toda criação de conta devolveria 404.

> `reference/criar-conta-pf` — OpenAPI, `"deprecated": false`

### 2. 📗 `accountOnboardingType` é obrigatório e não é enviado

O schema lista como `required`: `clientCode`, `accountOnboardingType`,
`documentNumber`, `phoneNumber`, `email`, `motherName`, `fullName`, `birthDate`,
`address`. O valor é sempre `BANKACCOUNT`.

`facets/accounts.ts` monta o corpo sem esse campo.

### 3. 📗 A resposta de criação **não é uma conta**

Resposta oficial de sucesso:

```json
{ "version": "1.0.0", "status": "PROCESSING", "body": { "onBoardingId": "39c8e322-…" } }
```

`facets/accounts.ts` faz `toProviderAccount(response.body.body)` sobre isso. Não
há número de conta, agência nem situação — há um **id de onboarding**, e a conta
nasce depois, de forma assíncrona.

Isso não é um campo faltando: é um erro de modelagem. `accounts.create.*` está
declarado `SUPPORTED` no manifesto, mas o que a Celcoin oferece nesse endpoint é
a *abertura de uma proposta*. O adapter precisa devolver a conta em estado
`PENDING_ONBOARDING` sem `providerAccountId`, e o conector precisa resolver a
conta depois — o que a taxonomia já modela.

📙 A skill acrescenta a máquina de estados observada:
`PENDING → CREATED → PENDING_DOCUMENTSCOPY → APPROVED → RESOURCE_CREATED`, e
alerta que **`APPROVED` não significa que a conta existe** — só
`RESOURCE_CREATED` é terminal. Há ainda `RESOURCE_ERROR`, documentado apenas no
OpenAPI da consulta.

### 4. 📗 PIX out com `initiationType: DICT` sem `endToEndId`

`facets/pix-transfers.ts` envia, para destino do tipo chave:

```ts
creditParty: { key: destination.key },
initiationType: 'DICT',
```

A documentação do DICT é explícita:

> A cada consulta de chave Pix realizada, a Celcoin irá gerar e devolver no
> *response* um EndToEndId, que **deverá ser utilizado na hora de efetivar a
> transação**.

O adapter nunca consulta o DICT antes de pagar e nunca envia `endToEndId`.

E não é só a chamada: **`CcDictEntry` não tem o campo**. A interface em
`dto/index.ts` modela `key`, `keyType`, `account`, `owner`, `createdAt`,
`status` — e nada mais. O adapter é estruturalmente incapaz de carregar o
`endToEndId` do DICT até o pagamento.

📙 A skill mede a consequência: falha com
`CBE180 — Não encontramos a chave informada`, **mesmo com a chave existindo**.

> `docs/consultar-chaves-pix-externa-dict`

### 5. 📗 `creditParty` não replica os campos `account.*` do DICT

A mesma página, em destaque:

> **Para os campos `account.*`, o valor retornado na consulta deverá ser
> replicado na chamada de pagamento, mesmo quando mascarado ou não preenchido.**

Enviamos só `{ key }`. Os campos vêm mascarados (`"account": "********"`), e a
tentação de "limpar" antes de enviar é exatamente o que a documentação proíbe.

---

## Graves — comportamento errado e silencioso

### 6. 📗 `birthDate` é `DD-MM-YYYY`, invertido

O exemplo oficial de requisição traz `"birthDate": "31-12-1984"`.

`facets/accounts.ts` repassa `input.holder.birthDate` cru, e o contrato canônico
usa data contábil `YYYY-MM-DD`. Toda criação de conta enviaria a data invertida.

📙 A skill acrescenta que a falha é `OBE016`, que a consulta de conta devolve o
campo no **mesmo formato invertido**, e que portanto a conversão precisa existir
nas duas direções.

### 7. 📗 O mapa de erros não corresponde à tabela oficial

`errors.ts` mapeia:

| Nosso mapa | Para |
|---|---|
| `CBE072`, `CBE073` | `INSUFFICIENT_FUNDS` |
| `CBE063`, `CBE064` | `PIX_KEY_NOT_FOUND` |
| `/^CBE1\d{2}$/` | `VALIDATION_ERROR` |

A tabela oficial de erros do DICT lista: `CBE091`, `CBE039`, `CBE175`, `CBE041`,
`CBE174`, `CBE176`, `CBE177`, `CBE190`, `CPD0013`. **Nenhum dos códigos que
mapeamos aparece nela.**

Pior que a ausência é o alcance da regex. `^CBE1\d{2}$` engole:

| Código | Significado real | Vira |
|---|---|---|
| `CBE176` | Operação não permitida. Conta está **encerrada** | `VALIDATION_ERROR` |
| `CBE177` | Operação não permitida. Conta está **bloqueada** | `VALIDATION_ERROR` |
| `CBE190` | Chave não está vinculada a essa conta | `VALIDATION_ERROR` |
| `CBE180` 📙 | Não encontramos a chave informada | `VALIDATION_ERROR` |

Conta bloqueada e chave inexistente não são erro de validação. O cliente recebe
"dados inválidos" e vai procurar o defeito no próprio payload.

Os erros de **criação de conta** usam outro prefixo — `CIE999` no exemplo
oficial — e não estão mapeados.

### 8. 📗 `CPD0013` não está mapeado

Desde 04/10/2025, pela Circular BCB nº 501, o DICT recusa devolver dados de
chaves marcadas como suspeitas de fraude:

```json
{ "status": "ERROR", "error": { "errorCode": "CPD0013",
  "message": "Chave Pix com dados restritos por marcação de fraude" } }
```

Cai no mapeamento genérico. Merece código canônico próprio — é uma recusa
regulatória, não uma falha técnica, e o cliente precisa saber a diferença.

### 9. 📗 A grafia do `endToEndId` no DICT é outra

A resposta oficial do DICT traz **`endtoEndId`** (t minúsculo, E maiúsculo).
`CcPixPayment` lê `endToEndId`. Mesmo depois de adicionar o campo ao
`CcDictEntry`, ler com a grafia errada devolveria `undefined`.

📙 A skill conta que o mesmo dado aparece com **quatro** grafias na API —
`endtoendid`, `endtoEndId`, `endToEndId` e `endtoendId` (query param de status)
— e recomenda normalizar num campo interno único.

### 10. 🔎 `accounts.get` pode estar na rota errada

Usamos `GET /baas/v2/account?Account=`. 📙 A skill afirma que a consulta exige o
segmento `/fetch` e que `/baas/v2/account?documentNumber=` devolve 404 — mas o
parâmetro dela é outro (`documentNumber`, não `Account`), então os dois casos
podem não ser o mesmo. **Não confirmado**; precisa de sondagem.

📙 A skill também registra que `body.account` do `/fetch` é **objeto**, não
string: o número está em `body.account.account`.

---

## Onde o adapter já está certo

Vale registrar, porque auditoria que só lista defeito não ajuda a decidir onde
mexer.

- 📗 **Base de homologação correta.** `https://sandbox.openfinance.celcoin.dev`
  bate com o `servers[0].url` do OpenAPI e com o cURL do guia do DICT.
- 📗 **`resolve` usa o endpoint certo.** `/baas/v2/pix/dict/entry/external/{conta}`
  com a **conta pagadora** no path — exatamente o que a skill diz ser o único que
  serve ao cashout do BaaS, e o que o cURL oficial mostra.
- 📗 **`PROCESSING` não vira `SETTLED`.** `mappers/pix.ts` mapeia
  `PROCESSING → TransactionStatus.PROCESSING`. A skill alerta que
  `200 PROCESSING` não é sucesso — aqui já estávamos certos, e o desenho de
  `UNKNOWN` + escada de reconsulta do conector é a resposta correta a isso.
- ✅ **`idempotent: false` no pagamento.** Timeout de corpo num POST que move
  dinheiro vira `ProviderOutcomeUnknownError`, não retry cego.
- ✅ **Desconhecido vira `UNKNOWN`, nunca `FAILED`.**

---

## Não aplicável hoje, mas relevante quando for

O manifesto não declara `statement.*` nem `webhooks.*` para a Celcoin, então
dois achados da skill ainda não tocam código nosso — e é bom que estejam
escritos antes de tocarem:

- 📙 **Os timestamps trazem sufixo `Z` mas são horário de Brasília.** Uma janela
  derivada de `new Date().toISOString()` fica 3 horas adiantada e devolve
  `CBE238` para sempre, fazendo o polling parecer "sem eventos". Isso bate
  direto na lógica de janela da conciliação quando o extrato for ligado.
- 📙 **A entidade de webhook `pix-infraction ` tem espaço no fim do nome.** Sem
  `trim()`, cria-se uma subscrição morta sem aviso. A lista autoritativa é
  `GET /baas/v2/webhook/entity/list`.
- 📙 **Não usar `POST /escrow/api/v1/accounts/{id}/webhook-configurations`** — é o
  que a busca devolve primeiro, mas pertence à `escrow-api`, outra plataforma e
  outra base URL.

---

## O que a matriz de capacidades está prometendo a mais

`accounts.create.pf` e `accounts.create.pj` estão `SUPPORTED`. Pelos achados 1,
2 e 3, nenhum dos dois funciona: rota inexistente, campo obrigatório ausente, e
resposta interpretada como algo que ela não é.

`pix.out.send` está `SUPPORTED`. Pelos achados 4 e 5, um pagamento por chave
falha com `CBE180`.

A regra editorial do próprio manifesto diz: *"declarar de mais produz erro opaco
em produção, e destrói a confiança na matriz inteira"*. Enquanto os bloqueantes
não forem corrigidos, essas três capacidades estão declarando a mais.

---

## Ordem sugerida de correção

1. **Prefixo das rotas de conta** (achado 1) — uma linha, destrava tudo o mais.
2. **Fluxo DICT → pagamento** (achados 4, 5, 9) — o maior: exige campo novo no
   DTO, `endToEndId` no `PixKeyResolution` do SPI, e o `send` passando a resolver
   antes de pagar. Mexe no contrato do SPI, então pede ADR.
3. **Modelagem da criação de conta** (achados 2, 3, 6) — conta nasce
   `PENDING_ONBOARDING` sem `providerAccountId`.
4. **Mapa de erros** (achados 7, 8) — trocar a regex por códigos explícitos da
   tabela oficial.
5. **Regravar as fixtures** com procedência real, e rebaixar o manifesto até que
   cada capacidade volte a ser verdade.

Nada disso é exercitável contra sandbox sem antes rodar o teste de saúde que a
skill descreve — 📙 propostas com telefone terminado em `2` devem voltar
`REPROVED` em segundos. A skill relata sandbox com criação automática de contas
indisponível; se for o caso aqui, o caminho é usar conta de sandbox existente e
dizer isso, em vez de depurar payload.
