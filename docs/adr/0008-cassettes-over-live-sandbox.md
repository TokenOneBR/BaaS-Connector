# ADR 0008: Fixtures gravadas servidas por HTTP real, sem sandbox no CI

- **Status:** Aceito
- **Data:** 2026-08-28

## Contexto

Adapters precisam ser testados contra o comportamento real do provedor, mas o
CI nao pode ter credencial de sandbox de cinco provedores, e sandbox de banco
cai.

## Decisao

Fixtures ("cassettes") em JSON, servidas por um **`CassetteServer` HTTP real**
em porta efemera. Gravacao e operacao local de mantenedor, com scrubber
obrigatorio. O CI nunca grava e nunca abre socket externo.

## Por que servidor HTTP real e nao nock ou MSW

Interceptacao mocka exatamente a camada que mais queremos testar: timeout,
reuso de conexao, `Retry-After`, streaming. Com servidor real, o teste
exercita a pilha HTTP de verdade do adapter e funciona igual seja ele escrito
com undici, axios ou `fetch` puro.

MSW continua sendo usado em `apps/web`, onde interceptacao e a ferramenta
certa.

## Fixtures escritas a mao

Onde nao ha sandbox publico, a fixture e escrita a partir da documentacao e
marcada `"source": "handcrafted-from-docs"`. O relatorio de conformidade
mostra isso, para ninguem confundir fixture manual com comportamento
verificado.

## Consequencias

Fixture pode envelhecer se o provedor mudar sem avisar. Mitigado por um job
noturno opcional que roda contra sandbox real quando ha credencial disponivel.

`scripts/check-cassette-pii.ts` bloqueia no CI qualquer fixture com CPF/CNPJ
de digito verificador valido, string em formato JWT ou bloco PEM.
