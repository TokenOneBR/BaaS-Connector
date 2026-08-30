# Asaas

Gateway de cobrança com conta de pagamento acoplada. Tem saldo e chaves PIX,
mas não abre conta de terceiro pelo mesmo caminho que Celcoin ou Dock —
subconta é outro fluxo, e não foi possível confirmá-lo na documentação pública.

> Fixtures `handcrafted-from-docs`, escritas a partir de
> [docs.asaas.com](https://docs.asaas.com). Não gravadas contra sandbox.

## Autenticação

Header próprio `access_token`, **não** `Authorization: Bearer`.

A base de redação do kit já mascara `asaas-access-token`, que é o header de
**entrada** (o que o Asaas envia no webhook). O de **saída** é `access_token`,
e sem a linha correspondente em `src/redaction.ts` a chave da conexão apareceria
em texto claro em todo `ProviderCallRecord`.

O Asaas também exige um `User-Agent` que identifique a aplicação, e recusa
requisição sem ele em produção.

## Ambientes

| Ambiente | URL |
|---|---|
| `HOMOLOGACAO` | `https://api-sandbox.asaas.com` |
| `PRODUCAO` | `https://api.asaas.com` |

O saldo em sandbox é fictício e não é provisionado automaticamente: é preciso
criar cliente, criar cobrança e confirmar pagamento para haver saldo.

## Peculiaridades

**Status 400 para quase tudo, inclusive saldo insuficiente.** Por isso o
mapeamento de erro é por **código** (`errors[0].code`), não por status. Cair no
400 genérico transformaria "sem saldo" em "requisição inválida", e o cliente
tentaria corrigir o payload.

**Saldo é só o total.** Não há bloqueado nem a liberar, então os dois saem
**ausentes** — não zerados. Zero afirmaria que não há bloqueio; ausente diz que
não sabemos, e a conciliação trata ausente como "não comparar".

**Só chave aleatória pela API.** CPF, CNPJ, e-mail e telefone são cadastrados
pelo painel. A restrição `allowedPixKeyTypes: ['EVP']` declara isso, e o
adapter recusa os demais tipos antes de chamar a rede.
