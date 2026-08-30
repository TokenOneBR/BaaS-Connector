# Woovi

PSP de **recebimento**: o produto é a cobrança PIX, não a conta. Não há
abertura de conta, onboarding de titular nem PIX out por chave — e declarar
essas capacidades por simetria com os outros adapters seria a forma mais rápida
de tornar a matriz inútil.

> Fixtures `handcrafted-from-docs`, escritas a partir de
> [developers.woovi.com](https://developers.woovi.com). Não gravadas contra
> sandbox.

## Autenticação

`Authorization: <AppID>` — **sem** `Bearer`. Adicionar o prefixo, que é o
reflexo de quem vem de OAuth2, devolve 401 sem explicação.

## Ambientes

`api.woovi.com` e `api.openpix.com.br` são ambos hosts reais operados pela
Woovi (o segundo é o alias herdado da OpenPix). **Não existe host de sandbox
separado**: o ambiente de teste é selecionado pelo **AppID**, não pela URL.

Essa é a armadilha deste provedor. Apontar um AppID de produção para o que você
chama de "homologação" cobra de verdade. O mapa em `src/endpoints.ts` é só um
padrão; quem cadastra a conexão precisa conferir o AppID.

## Peculiaridades

**Centavos inteiros.** `"value": 150075`. A Woovi é o único dos cinco que já
fala a mesma unidade que o domínio do conector — sem conversão decimal, sem
arredondamento.

**`correlationID` é a chave de idempotência.** Vai no corpo, não em header.
Repetir o mesmo valor devolve a cobrança existente em vez de criar outra. O
manifesto declara `mode: 'body_field'`.

**Paginação por `skip`, não por cursor.** O adapter embute o próximo offset no
cursor opaco, então o cliente do conector nunca vê a diferença — que é
exatamente o que o SPI promete.

## Não coberto

`webhooks.inbound` ficou **de fora**, e a suíte de conformidade foi quem
cobrou: declarei sem implementar a faceta e o grupo 1 reprovou na hora. A Woovi
entrega webhook sem assinatura por padrão; a verificação depende de um HMAC
configurado no painel, cujo esquema não está na documentação pública. Declarar
`webhooks.signature.verify` sem saber o esquema seria prometer uma verificação
que não acontece — pior do que não ter.
