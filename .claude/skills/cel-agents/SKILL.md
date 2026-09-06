---
name: cel-agents
description: Use the grant-scoped cel_agents sandbox MCP to read Studio context, collaborate on board concepts, consult Celcoin documentation, and perform explicitly authorized sandbox-only work safely.
---

# cel_agents MCP

Use cel_agents as two connected, first-class surfaces: the dashboard holds live
Studio projects, boards, concepts, discussions, inbox history, and connection
control; the MCP brings that state and explicitly granted Celcoin sandbox
capabilities into the agent host. The API centralizes authentication, workspace
authority, grants, and revocation. The MCP has no production access.

## Working protocol

1. Start every session with `permissions`. Read `grantedPermissions`,
   `grantedTools`, and every `availableTools` entry. Treat `granted: false` for a
   needed tool as a stop and reauthorization signal; never work around it.
2. Read live summaries and exact IDs before acting. Never guess a project,
   board, board-concept, comment, notification, revision, permission, endpoint,
   or schema.
3. Re-read the relevant live state immediately before each write. Confirm the
   human's requested intent, keep mutations minimal, and preserve unrelated
   content.
4. After every write, inspect the result and re-read the affected resource.
   Report conflicts and exact blockers; do not claim success from a request
   alone.

## Current tool map

- `permissions`: inspect the connection and all granted or unavailable tools.
- `studio_get_projects`: list concise Studio project and board summaries; use
  this first to discover current project and board IDs.
- `studio_get_board`: read one board's ordered concept metadata and activity
  without downloading HTML.
- `studio_get_board_concept_html`: retrieve one board concept's exact canonical
  HTML, `contentRevision`, content hash, viewport, editing state, and effective
  project branding.
- `studio_prepare_replace_board_concept_html`: announce editing as soon as the
  exact target is known. Its 15-minute editing lease is presence, not a lock.
- `studio_upload_board_concept_design_image`: after preparation, upload PNG,
  JPEG, or WebP bytes as base64 transport and receive the durable
  `studio-asset://design-image/...` URI.
- `studio_replace_board_concept_html`: compare-and-swap the complete canonical
  document with `expectedRevision` set to the latest read `contentRevision`.
- `studio_get_newest_comments`: find the newest live comment threads across the
  authorized workspace.
- `studio_get_board_comments`: read threads for one exact board in stable order.
- `studio_get_board_concept_comments`: read threads for one exact board concept.
- `get_notifications`: retrieve the authorizing user's platform notifications
  without changing read state. Use status, cursor, and limit for bounded pages.
- `mark_notifications_read`: explicitly mark selected accessible delivery IDs
  read after processing them. It uses the same `get_notifications` grant.
- `studio_reply_to_comment`: reply to a live root comment as the authorizing
  user. Use a fresh UUID idempotency key for each intentional reply and reuse
  that same key only to retry the identical reply.
- `search_celcoin_documentation`: search the live official Celcoin Markdown
  index for the relevant product, error, guide, recipe, or language.
- `fetch_celcoin_documentation`: fetch the complete official entry selected from
  search results before implementing against it.
- `get_celcoin_sandbox_credentials`: reveal the grant-bound sandbox client ID
  and secret only when explicitly needed to configure customer code. Keep them
  in approved secret storage or environment variables; never place them in
  source, logs, comments, concept HTML, or chat output.
- `execute_celcoin_sandbox_action`: send an explicitly intended `POST`, `PUT`,
  `PATCH`, or `DELETE` through the allowlisted sandbox proxy. Confirm the action,
  exact tool schema, official endpoint documentation, method, URL, headers, and
  body first. Use `idempotency_key` when the documented operation supports safe
  retry.

Documentation access (`celcoin_docs_read`), credential access
(`celcoin_sandbox_credentials_read`), and sandbox actions
(`celcoin_sandbox_execute`) are separate grants. Studio reads, HTML replacement,
comments, notifications, and replies are also independently grant-scoped. A
credential grant or action grant never implies another capability.

## Canonical board-concept editing

1. Discover the project and board with `studio_get_projects`, then read the
   ordered board with `studio_get_board`.
2. Read the exact target with `studio_get_board_concept_html`. Confirm its ID,
   viewport, hash, editing state, branding, and `contentRevision` before the
   first write.
3. Call `studio_prepare_replace_board_concept_html` immediately after confirming
   the target. Do not treat the lease as concurrency protection.
4. Preserve the board's concept order and the document's intended structure.
   Keep `<style data-studio-project-branding>` as the first style in `<head>`,
   preserve its trusted `@font-face` and `--studio-primary-color`,
   `--studio-secondary-color`, `--studio-border-radius`, and
   `--studio-font-family` variables, and keep concept-specific CSS in later
   style blocks.
5. For a new raster, call `studio_upload_board_concept_design_image` and insert
   only its returned durable URI. Base64 is transport-only. Use exactly
   `studio-branding://project-logo` for the dynamic project logo. Never persist
   signed, external, protocol-relative, blob, inline/data, private-storage, or
   invented image references.
6. Re-read with `studio_get_board_concept_html` immediately before replacement.
   Submit the complete canonical document to
   `studio_replace_board_concept_html` with that read's `contentRevision` as
   `expectedRevision`. On a stale-revision conflict, re-read and reconcile;
   never force or guess a revision.
7. Re-read again after replacement and verify the exact HTML, new
   `contentRevision`, hash, viewport, branding contract, image references, and
   cleared/expected editing state.

## Collaboration and sandbox safety

Read comments or notifications before replying so the response addresses the
complete live thread. Notifications and review requests point to live state,
not snapshots. Preserve coordinate/comment context when editing. Never reuse a
reply idempotency key for different text or a different comment.

Use documentation reads to establish the current sandbox API contract before
credentials or actions. Confirm human intent before revealing credentials or
executing mutations even when OAuth already grants the tool. Inspect the tool's
current input schema instead of inferring fields. Operate only on the sandbox
bound to the validated grant. Never claim or attempt production credentials,
production data, production endpoints, or production operations through CEL
Agents.

## Receitas de integração Celcoin (Onboarding + Pix)

### Antes de começar: pergunte o escopo

Não comece a construir a partir de suposição. Antes de ler boards ou escrever a
primeira linha, pergunte ao humano e espere a resposta:

- **Qual projeto.** Liste os disponíveis com `studio_get_projects` e peça para
  ele escolher — não deduza pelo nome nem assuma que só há um.
- **Quais boards e telas entram nesta rodada.** Um projeto costuma ter dezenas
  de conceitos, e construir todos quase nunca é o pedido. Liste os boards com o
  número de conceitos de cada um e deixe ele recortar.
- **O que já existe.** Se parte já foi construída, você está estendendo, não
  começando.

Confirmado o escopo, repita de volta o que entendeu — quais telas, em que
ordem — antes de escrever código. Errar o escopo custa mais do que qualquer
armadilha de API deste documento.

### A ordem importa: onboarding vem antes de Pix

**Sem conta na Celcoin não existe Pix.** Toda operação parte de uma conta
pagadora, e ela só nasce ao fim do onboarding. Não é uma dependência de
interface — é da API:

- `GET /baas/v2/pix/dict/entry/external/{conta}` leva o número da **conta
  pagadora** no path. Sem ela você não consegue nem resolver uma chave.
- `POST /baas/v2/pix/payment` precisa do `debitParty`, e `GET
  /baas/v2/wallet/balance?Account=` precisa da conta.
- Com conta inexistente, todas devolvem `CBE039 — Account invalido`.

Implemente e conclua o onboarding primeiro. Se a criação de contas estiver
indisponível (ver o teste de saúde adiante) e você ainda precisar exercitar
Pix, use uma conta de sandbox já existente e **diga isso ao humano** — não
finja que o fluxo fecha.

### Regras de conduta

**Nunca conclua que um recurso não existe a partir de busca vazia.**
`search_celcoin_documentation` pontua título, descrição, URL e um `product`
inferido — nunca o conteúdo do documento. Slug desalinhado do conteúdo derruba
o resultado junto. Consulta longa e descritiva dilui o ranking,
sinônimos não funcionam ("agendamento" não encontra "agendar") e filtrar por
`product` pode excluir o alvo (o guia de agendamento está catalogado como `pix`
embora seja do BaaS). Antes de declarar ausência: tente o título quase literal,
sonde a rota, ou pergunte ao humano. Nunca reimplemente na aplicação um recurso
que você não conseguiu encontrar.

**Qualquer página da documentação vira Markdown com `.md` no fim da URL** — e
isso alcança páginas que o índice **não** contém. O `llms.txt` que alimenta a
busca não cobre as URLs `/page/`, onde estão, entre outras coisas, as tabelas de
massa de teste:

```
curl -s "https://developers.celcoin.com.br/page/<slug>.md"
```

Quando a busca não achar algo que deveria existir, navegue o site e puxe a
página com `.md`, em vez de concluir que não existe.

**Pergunte antes de decidir arquitetura fora da Celcoin.** Banco de dados, ORM,
autenticação, estratégia de sessão, política de senha, se um usuário pode ter
mais de uma conta — são decisões do produto. Levante-as antes de escrever a
primeira linha, não depois.

**Nunca abra exceção de segurança para manter o app demonstrável.** Sem sessão
válida, recuse a requisição. Sem conta própria vinculada ao usuário, recuse a
operação — nunca recaia numa conta padrão ou de ambiente.

### A fronteira: o que a Celcoin não faz

| Necessidade | Onde resolver |
|---|---|
| Código por e-mail ou SMS (OTP) | mensageria própria |
| Busca de CEP | serviço externo (ex.: ViaCEP) |
| Autenticação do usuário final | backend próprio — a Celcoin conhece a conta, não quem entra no app |
| Login, senha, recuperação, logout | se os boards não trouxerem, precisam ser projetados |

Não passe substituto provisório (OTP fixo, por exemplo) por verificação real.

### O usuário existe no seu app antes de existir na Celcoin

Cadastrar-se no seu app e ter conta na Celcoin são eventos separados por vários
minutos — e a conta pode nunca ser criada, se a proposta travar. Existe portanto
uma janela em que o usuário está autenticado no seu app e **não tem conta**.

Nessa janela não há de onde debitar, consultar saldo ou listar chaves. Trate
"sem conta" como um estado de primeira classe do seu modelo: bloqueie as telas e
rotas que dependem de conta e devolva erro explícito, em vez de deixar a
chamada seguir sem destino.

### Persistência é responsabilidade do seu app

A Celcoin é o núcleo transacional, não o sistema de registro do produto. Modele
desde o início:

- Usuários e credenciais do seu app.
- Vínculo usuário ↔ conta Celcoin.
- Transações e o `clientCode` que você envia em cada uma — idempotência e
  correlação posterior dependem dele.
- Estado da proposta de onboarding.
- Eventos de webhook recebidos, para dedupe e reprocessamento.

### Onboarding PF

Use:

```
POST /onboarding/v1/onboarding-proposal/natural-person
```

`POST /baas/v2/account/natural-person/create` e `/business/create` respondem
`403 CBE468 — Cliente não autorizado para utilizar essa API` com payload
completo. Se isso é rota descontinuada ou permissão que falta ao grant não está
determinado — de todo modo, o caminho acima é o confirmado para criar conta.

Estados: `PENDING → CREATED → PENDING_DOCUMENTSCOPY → APPROVED →
RESOURCE_CREATED`. `APPROVED` **não significa que a conta existe**; só
`RESOURCE_CREATED` é terminal. Existe também `RESOURCE_ERROR`, documentado
apenas no OpenAPI da consulta — inclua-o no seu modelo de estados.

Acompanhe por consulta direta, não por webhook:

```
GET /onboarding/v1/onboarding-proposal?proposalId=…   (ou ?clientCode=…)
GET /baas/v2/account/fetch?documentNumber=…
```

Use exatamente essas duas formas. A forma REST `/onboarding-proposal/{id}` não
existe, e a consulta de conta exige o segmento `/fetch` — `/baas/v2/account?
documentNumber=` devolve 404. Enquanto a conta não existe, `fetch` devolve
`CBE078`: isso é "ainda não", não erro.

Consulte em intervalos com recuo progressivo, na casa de dezenas de segundos, e
pare por condição real: `RESOURCE_CREATED`, ou a conta aparecendo em `fetch`.

**Em sandbox o final do telefone controla o KYC** — `phoneNumber` para PF,
`contactNumber` para PJ. O que a documentação promete e o que foi medido num
grant real:

| Final | Documentado | Observado |
|---|---|---|
| `1` | aprova os dois webhooks e cria a conta | passa a 1ª etapa em segundos e **para** em `PENDING_DOCUMENTSCOPY` |
| `2` | reprovado no primeiro webhook | ✅ `REPROVED` em segundos |
| `3` | aprova a 1ª etapa e reprova a 2ª | passa a 1ª e **para** em `PENDING_DOCUMENTSCOPY` |
| outro | cenário real, com documentoscopia de verdade | — |

O primeiro webhook funciona; o segundo não dispara. A recusa é honrada, a
aprovação automática não acontece.

**Use isso como teste de saúde antes de construir**, custa segundos:

1. Crie uma proposta com final `2`. Se não voltar `REPROVED` em segundos, a
   sandbox não está respondendo — pare e reporte.
2. Crie uma com final `1`. Se virar conta, siga; o resto desta seção não se
   aplica a você.
3. Se a de final `1` ficar parada em `PENDING_DOCUMENTSCOPY`, **a criação
   automática de contas está indisponível**. Não depure o seu payload: você vai
   precisar de documentoscopia humana, e mesmo ela pode não bastar (ver abaixo).

O caminho com documentoscopia real troca segundos por um fluxo com passo humano
e prazo indeterminado:

- A **documentoscopia vira passo humano** num link externo
  (`celcoin.cadastro.io`), com envio de documento e selfie.
- A transição de documentoscopia aprovada para conta leva cerca de **11
  minutos** quando funciona. Passou bem disso: suspeite de indisponibilidade da
  plataforma, não do seu payload.
- Uma proposta pode ficar parada em `APPROVED`, com documentoscopia aprovada,
  sem erro e sem `RESOURCE_ERROR`. Não há endpoint de reprocessamento — trate
  como espera, mostre o estado, e não prometa prazo.
- Esse é o estado observado: propostas PF **e** PJ acumuladas em `APPROVED` sem
  virar conta. Se o seu grant estiver assim, nenhum caminho de onboarding fecha
  — siga com uma conta já existente e reporte ao humano em vez de insistir.

`birthDate` usa **`DD-MM-YYYY`**, invertido em relação ao resto da API. Um
`<input type="date">` produz ISO e falha com `OBE016`. A consulta de conta
devolve o campo no mesmo formato invertido — converta nas duas direções.

### Pix: qual DICT usar para pagar

Dois endpoints resolvem uma chave e ambos devolvem `endToEndId`, mas só um serve
ao cashout do BaaS:

```
GET /baas/v2/pix/dict/entry/external/{conta}?key=…&ownerTaxId=…   ← use este para pagar
POST /pix/v1/dict/v2/key                                          ← não use o endToEndId deste no BaaS
```

O path param é o **número da conta pagadora**, não o CNPJ da instituição (isso
vale só para o `PayerID` do outro endpoint); com o valor errado devolve
`CBE039`. O `ownerTaxId` aparece no cURL do guia `Consultar Chaves Pix Externa
(DICT)` com valor distinto do CPF da chave consultada; confirme nesse guia o que
ele representa e se é obrigatório antes de preencher.

Com o `endToEndId` do endpoint errado, o pagamento falha com
`CBE180 — Não encontramos a chave informada`, mesmo com a chave existindo.
`CBE180` também aparece ao pagar de uma conta para ela mesma; nesse caso só
`initiationType: MANUAL` revela a razão real (`CBE220`).

Em `POST /baas/v2/pix/payment`, os campos `account.*` retornados pelo DICT vão
para **`creditParty`** e devem ser replicados **exatamente como vieram, mesmo
mascarados** (`"***"`). Não limpe esses valores.

Na transferência por agência e conta (`initiationType: MANUAL`) não há DICT para
copiar, então monte o `creditParty` você mesmo:

- `creditParty.bank` é o **ISPB**, não o código de compensação. Use
  `GET /pix/v1/participants`, que lista as instituições com `ispb`, `name`,
  `shortName` e `type`. Ele **não devolve o código de compensação** ("341",
  "260"); se a interface precisa exibi-lo, mantenha um mapa próprio.
- `creditParty.accountType` segue o tipo real da conta de destino. Contas de
  sandbox da Celcoin são **`TRAN`**, não `CACC` — não fixe `TRAN` para todo
  destino.

O mesmo dado aparece com quatro grafias na API — `endtoendid`, `endtoEndId`,
`endToEndId` e `endtoendId` (query param de status). Normalize num campo interno
único.

| `initiationType` | Exige |
|---|---|
| `MANUAL` | sem `key`, `endToEndId`, `transactionIdentification` |
| `DICT` | `key` + `endToEndId`; **não** aceita `transactionIdentification` |
| `STATIC_QRCODE` / `DYNAMIC_QRCODE` | `key` + `endToEndId` + `transactionIdentification` |

Derive o `initiationType` do **tipo do QR Code** informado na resposta do decode
(estático ou dinâmico), não da presença de `transactionIdentification` — inferir
pelo campo classifica errado e o pagamento é recusado.

Ao decodificar Copia e Cola (`POST /pix/v1/emv/full`), o erro vem como JSON
escapado dentro de `description`, com `code: "999"` genérico por fora e o código
real (ex.: `PCE002`) dentro. Faça o parse do JSON interno; não exiba
`description` na tela.

### `200 PROCESSING` não é sucesso

`POST /baas/v2/pix/payment` aceita a transação e responde `200` com
`status: PROCESSING` **mesmo sem saldo**. A falha real
(`CBE123 — saldo insuficiente`) só aparece depois, no payload do webhook.

Declare "em processamento", nunca "concluído", e confirme pelo desfecho
assíncrono.

### Agendamento (`scheduler`)

Mesmo endpoint de cashout com o objeto `scheduler`, mas validação própria:

- `remittanceInformation` é **obrigatório quando agendado** (senão `SCH025`),
  mesmo que a interface trate o campo como opcional. No cashout imediato segue
  opcional.
- `paymentType: SCHEDULED`, `urgency: NORMAL` (não `HIGH`).
- `scheduler.schedulerDate` no formato `YYYY-MM-DD`.
- QR Code não é aceito — só chave Pix ou manual.
- `SCH085` recusa agendamento idêntico (mesmo valor, destino e data).
- O exemplo do guia contradiz a tabela dele, trazendo `IMMEDIATE`/`HIGH` junto
  do `scheduler`. Siga a tabela.
- Saldo não é checado no agendamento, só na data de execução.
- O sucesso responde `status: CREATED` (não `PROCESSING`) com
  `scheduler.schedulerId` — persista esse id.
- Consultar e cancelar existem, embora a busca não os encontre:
  `GET /baas/v2/scheduler/{schedulerId}` e
  `DELETE /baas/v2/scheduler/{schedulerId}`.

### Pagamento de contas (boleto)

**Existem dois produtos com o mesmo nome, e eles não se misturam.** Se cada
usuário paga da própria conta, é o **BaaS**:

| | Avulso | BaaS |
|---|---|---|
| Debita | conta proprietária do cliente Celcoin | conta do usuário final |
| Efetivação | `POST /v5/transactions/billpayments` + `PUT .../{id}/capture` | `POST /baas/v2/billpayment` |
| Status | `GET /v5/transactions/status-consult` | `GET /baas/v2/billpayment/status` |

A busca devolve primeiro o guia do avulso (`docs/pagamento-de-contas-1`). Não o
siga por engano.

Ordem das operações no BaaS — o `authorize` é o mesmo nos dois produtos:

```
1. POST /v5/transactions/billpayments/authorize   → transactionId
2. POST /baas/v2/billpayment                      → 200 PROCESSING (não é sucesso)
3. GET  /baas/v2/billpayment/status?ClientRequestId=…   → CONFIRMED | ERROR
```

**Sem a massa de teste oficial nada funciona.** Código de barras fora dela é
recusado — uma linha inventada devolve `822 — Erro na conversão de linha
digitável`. A tabela **não está no índice da busca**; puxe com o truque do `.md`:

```
curl -s "https://developers.celcoin.com.br/page/tabela-de-massa-de-teste-para-pagamentos-de-ficha-de-compensa%C3%A7%C3%A3o.md"
```

Linha para começar (caso base, R$ 1.500, `allowChangeValue: false`):
`23793381286008301352856000063307789840000150000`

Armadilhas:

- **O valor do código de barras não é o valor a pagar.** Use
  `registerData.totalUpdated`, que já traz juros, multa e desconto. Só mande
  valor diferente quando `allowChangeValue` for `true`, e dentro de
  `[minValue, maxValue]`.
- **Vencimento vem de campos diferentes por tipo.** Ficha de compensação usa
  `registerData.dueDateRegister`; convênio usa `dueDate` da raiz, que pode vir
  `null`.
- **`errorCode: "000"` é o único sucesso do `/v5/`** — qualquer outro valor é
  falha, mesmo com HTTP 200.
- **`200 PROCESSING` não é sucesso**, igual ao Pix: o desfecho leva ~30s e só
  aparece na consulta de status.
- **`PCE088 — "Excede limite de saldo" não é sobre saldo.** Verificado: falha
  igual com saldo folgado (R$ 1.742 pagando R$ 1.500). É limite de produto não
  provisionado no tenant. Se aparecer, pare e peça liberação — nenhum valor vai
  passar, e mexer no payload não resolve.
- **`body.account` do `/baas/v2/account/fetch` é objeto**, não string: o número
  está em `body.account.account`.

Agendamento: `POST /baas/v2/billpayment` aceita
`scheduler: { schedulerDate: "YYYY-MM-DD" }`, e a data não pode passar do
vencimento do boleto (`SCH091`). Não há documentação disso.

### Desfecho de fluxo assíncrono

**Webhook é o mecanismo.** Em qualquer ambiente com endereço público —
produção, homologação, staging, preview —, configure webhook e trate-o como
fonte primária de estado. Os guias são `docs/webhooks-baas` e
`docs/gerenciamento-de-webhook`; `GET /baas/v2/webhook/subscription` lista as
assinaturas. Se não encontrar a rota de cadastro, pergunte ao humano.

**Não use `POST /escrow/api/v1/accounts/{id}/webhook-configurations`.** É o que
a busca devolve, mas pertence à `escrow-api` — outra plataforma, outra base URL
— e publica nomes de evento (`ACCOUNT-STATUS-CHANGE`) que o BaaS rejeita.

**Polling é exceção, e só por um motivo:** `localhost` não tem endereço público
para a Celcoin chamar. Só nesse caso, consulte o histórico de eventos. Não
transforme isso no mecanismo definitivo do app nem o leve para nenhum ambiente
publicado — lá o webhook existe e o polling só esconde eventos perdidos:

**Coloque o polling onde o usuário está esperando.** De nada adianta implementar
a reconciliação e disparar só numa tela de extrato: quem acabou de mandar um Pix
fica olhando "em processamento" para sempre e conclui que a integração quebrou,
quando ela já liquidou. A tela de confirmação é a que precisa buscar o desfecho,
com recuo progressivo, e trocar o próprio estado quando ele chegar.

```
GET /baas/v2/webhook/replay/{entity}/details?DateFrom=…&DateTo=…&OnlyPending=true
```

- `OnlyPending=true` é **obrigatório**. Sem ele os eventos pendentes ficam
  invisíveis: o endpoint irmão de contagem responde `totalItems: 0` e o
  `/details` responde `404 CBE238`, ambos indistinguíveis de "nada aconteceu".
- Janela de no máximo ~1 hora. Janelas de 2–3 dias podem não responder em 180s.
- `404 CBE238` significa "ainda não há evento no período" — continue tentando,
  não trate como erro definitivo.
- Correlacione pelo `clientCode` enviado no request original.
- Pare por condição real, não por contagem fixa de tentativas; use recuo
  progressivo. Um Pix decide em segundos.
- **Isto serve ao Pix, não ao onboarding.** As entidades `onboarding-proposal` e
  `onboarding-documentscopy` não respondem (pendura, ~120s sem retorno), e
  `onboarding-create`, `kyc` e `account-status` devolvem `CBE238` mesmo havendo
  eventos. Para onboarding, use as consultas diretas.
- Os timestamps do payload trazem sufixo `Z` mas estão em **horário de
  Brasília**. Isso vale também para montar `DateFrom`/`DateTo`: uma janela
  derivada de `new Date().toISOString()` fica 3 horas adiantada, devolve
  `CBE238` para sempre e faz o polling parecer "sem eventos". **Monte a janela
  no fuso de Brasília (UTC-3).**

`GET /baas/v2/pix/payment/status` existe, mas na sandbox não localiza
transações: devolve `CBE106` por `id`, `clientCode` e `endtoendId`. Não construa
o fluxo em cima dele.

Nomes de entidade de webhook são minúsculos com hífen e precisam ser exatos
(`pix-payment-out`, `account-status` — não `ACCOUNT-STATUS-CHANGE`); nome
inválido devolve `CBE208`. A lista autoritativa é
`GET /baas/v2/webhook/entity/list`. A lista de templates publica pelo menos uma
entidade com espaço em branco no fim do nome (`pix-infraction `) — aplique
`trim()`, senão você cria uma subscrição morta sem aviso.

### Endpoints que a busca não encontra

| Para que | Endpoint |
|---|---|
| Creditar saldo em sandbox | `POST /baas/v2/wallet/entry/{conta}` com `{ clientCode, amount, type: "CREDIT", description }` |
| Consultar saldo | `GET /baas/v2/wallet/balance?Account=` |
| Histórico de eventos | `GET /baas/v2/webhook/replay/{entity}/details` |
| Entidades de webhook | `GET /baas/v2/webhook/entity/list` |
| Status de pagamento no BaaS | `GET /baas/v2/pix/payment/status` (ver ressalva acima) |

**`CBE468` é "Cliente não autorizado para utilizar essa API" — permissão, não
caminho errado.** A mensagem não distingue rota descontinuada de permissão que
falta ao grant, então não conclua nenhuma das duas a partir dela. Se aparecer
numa rota viva, o caminho é pedir liberação ao humano, não procurar endpoint
alternativo.

Isso **não** quer dizer que o crédito em carteira esteja bloqueado: em grant
verificado, `POST /baas/v2/wallet/entry/{conta}` responde `CONFIRMED` e credita
normalmente. Teste antes de assumir bloqueio — sem saldo nada liquida, e vale
saber cedo de que lado você está.

**Sondar rota tem armadilha.** A validação de schema roda antes da checagem de
autorização, então payload mínimo devolve `CBE225` (campo obrigatório) e parece
permissão liberada. O sinal confiável é o corpo do erro: rota inexistente
devolve `{"statusCode":404,"message":"Resource not found"}`; rota existente
devolve erro de negócio (`CBE468`, `CBE106`, `CBE225`). Um **`500` de corpo
vazio não classifica nada** — é o que `/baas/v2/account/natural-person/create`
devolve com payload incompleto; não o leia como rota inexistente nem como
indisponibilidade.

### Massa de teste de sandbox

**Resolver no DICT e liquidar um pagamento são coisas diferentes.** Estas duas
resolvem no DICT, mas **nenhum pagamento para elas liquida** — terminam em
`ED05` e são estornadas:

| Chave | Tipo | |
|---|---|---|
| `77517432125` | CPF | resolve, não liquida |
| `testecelbaas@celcoin.com.br` | EMAIL | resolve, não liquida |
| `testepix@celcoin.com.br` | EMAIL | **resolve e liquida** — use esta para pagar |

Para exercitar pagamento ponta a ponta, use `testepix@celcoin.com.br` (Pix
Celcoin Teste 2 Avulso). Não confunda com `teste@celcoin.com.br`, que é uma das
chaves de exemplo marcadas como fraude.

`+5532976886942` está publicada como chave de teste mas não existe no DICT da
sandbox (`404 CBE180`).

Não use as chaves dos exemplos da documentação (`teste@celcoin.com.br`,
`fulano.tal@provedor.com.br`, `+5511988889999`, `98631057088`, `32383861820`):
devolvem `CPD0013 — dados restritos por marcação de fraude`, que parece erro de
integração.
