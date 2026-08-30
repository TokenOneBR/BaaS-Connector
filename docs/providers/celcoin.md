# Celcoin

Adapter de referência para a [Celcoin](https://developers.celcoin.com.br), a
plataforma de BaaS e Core Banking mais usada no mercado brasileiro.

> **Leia isto antes de usar em produção.** As fixtures deste adapter são
> `handcrafted-from-docs`: foram escritas a partir da documentação pública,
> **não** gravadas contra o sandbox. A suíte de conformidade prova que os
> mappers são coerentes com o que a documentação descreve; ela **não** prova
> que a documentação está certa nem que o sandbox se comporta assim. Quem tiver
> credencial de sandbox deve regravar — ver
> [`docs/guides/recording-fixtures.md`](../guides/recording-fixtures.md).

## Autenticação

OAuth2 `client_credentials` com o segredo **no corpo**, form-encoded:

```
POST /v5/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&client_id=...&client_secret=...
```

O token vale 3600s e vai nas chamadas seguintes como `Authorization: Bearer`.

A RFC 6749 permite Basic **ou** corpo; a Celcoin usa corpo, e mandar Basic para
quem espera corpo devolve 401 sem dizer por quê. O kit modela a escolha como
`credentialPlacement: 'body'`, então ela fica declarada em vez de implícita.

## Credenciais

| Campo | Obrigatório | Nota |
|---|---|---|
| `clientId` | sim | |
| `clientSecret` | sim | |
| `defaultAccount` | não | Conta padrão da conexão, para operações sem conta explícita |
| `webhookSecret` | não | Rotaciona em cadência própria |

## Bases

| Ambiente | URL |
|---|---|
| `HOMOLOGACAO` | `https://sandbox.openfinance.celcoin.dev` |
| `PRODUCAO` | `https://api.openfinance.celcoin.com.br` |

Não há prefixo único: onboarding vive sob `/baas-onboarding`, o core banking
sob `/baas`, o PIX de recebimento sob `/pix`, e o token na raiz. Todos os
caminhos estão em `src/endpoints.ts`, num lugar só — espalhá-los pelas facetas
é como um prefixo errado sobrevive à revisão.

## Peculiaridades

**Dinheiro é número JSON.** `"amount": 1500.75`, não string decimal nem
centavos. `JSON.parse` já converteu para `double` antes de qualquer código
nosso rodar, então o dano de precisão, quando existe, aconteceu na borda. O que
o adapter faz é converter para centavos com arredondamento explícito
(`Math.round(valor * 100)`) e nunca deixar o `number` seguir para o domínio.
`src/mappers/money.ts` é o único ponto autorizado a ver um `number` de dinheiro.

`8.2 * 100` é `819.9999999999999` em ponto flutuante. Truncar daria 819 — um
centavo a menos, em silêncio, em toda transação com esse valor. Há teste.

**`MAIL` é `EMAIL`.** A Celcoin chama de `MAIL` o que o BACEN chama de `EMAIL`.
Sem a linha de tradução, toda chave de e-mail viraria `EVP` e o cliente veria o
tipo errado no extrato.

**`CONFIRMED` e `APPROVED` são o mesmo desfecho de proposta.** A documentação
usa os dois nomes em lugares diferentes. Mapear só um deixaria metade das
aprovações presas em análise para sempre.

**O onboarding não é uma submissão separada.** Criar a conta gera a proposta,
que segue sozinha para *background check*, com o desfecho voltando por webhook.
Por isso `onboarding.kyc.submit` e `onboarding.kyb.submit` estão declaradas
`EMULATED`: o adapter **lê** a proposta em vez de submeter. O efeito é
equivalente, o mecanismo não é, e quem integra precisa saber a diferença antes
de desenhar o próprio fluxo.

**Não há header de idempotência.** Quem deduplica é o `clientCode` no corpo.
O manifesto declara `mode: 'external_id'`, e é por isso que
`findByIdempotencyKey` **precisa** existir: sem ele, a escada do desfecho
desconhecido não teria primeira tentativa e cairia direto na varredura de
extrato.

**Consultar o DICT consome bucket de tokens do BACEN.** O saldo volta no header
`x-bacen-bucket` e não é exposto pelo SPI. Por isso `pix.keys.resolve` está
`PARTIAL` com nota.

**Chaves `PHONE` e `EMAIL` exigem validação por OTP** fora deste fluxo. Na
prática só `CPF`, `CNPJ` e `EVP` completam sem interação do titular — e é
exatamente isso que a restrição `allowedPixKeyTypes` do manifesto declara.

## Erros

O código do provedor vem em `error.errorCode`, com prefixo `CBE`, e é
preservado **literalmente** no corpo do erro canônico. É o que o suporte da
Celcoin pede numa escalação, e traduzi-lo é perder a única informação que eles
reconhecem.

| Código | Canônico |
|---|---|
| `CBE072`, `CBE073` | `INSUFFICIENT_FUNDS` |
| `CBE063`, `CBE064` | `PIX_KEY_NOT_FOUND` |
| `CBE1xx` | `VALIDATION_ERROR` |
| 401 / 403 / 404 / 409 / 429 / 5xx | via `COMMON_ERROR_MAPPINGS` |

Regras por status genérico **não** são repetidas na tabela deste adapter: o
mapeador para no primeiro `when` que casa, então uma regra por status colocada
antes das específicas engoliria o `CBE***`.

## Capacidades

Ver [a matriz gerada](capability-matrix.md). A regra editorial do manifesto —
e a razão de ele ser curto — é que **o que não foi confirmado na documentação
pública sai `UNSUPPORTED`**. Declarar de menos produz um 501 honesto, com a
nota no corpo do erro e uma issue de contribuição. Declarar de mais produz erro
opaco em produção e destrói a confiança na matriz inteira, que é o artefato
open source de maior valor do projeto.

## Contribuindo

As capacidades ainda não cobertas — extrato, cobranças, devolução, webhooks,
bloqueio e encerramento de conta — estão abertas como
[issues de contribuição](https://github.com/TokenOneBR/BaaS-Connector/issues?q=label%3Aadapter-celcoin).
O caminho está em
[`writing-a-provider-adapter.md`](../guides/writing-a-provider-adapter.md).
