# Gravando fixtures de provedor

Fixtures ("cassettes") são as respostas gravadas que a suíte de conformidade
reproduz. Elas são o que permite testar um adapter contra o comportamento real
do provedor sem credencial no CI e sem depender de um sandbox que cai.

## Por que servidor HTTP real e não interceptação

O `CassetteServer` sobe um `node:http` de verdade numa porta efêmera. Não é
`nock` nem MSW de propósito: interceptação mocka exatamente a camada que mais
queremos testar — timeout, reuso de conexão, `Retry-After`, streaming — e
amarra o teste à biblioteca HTTP que o adapter usou por dentro. Com servidor
real, o teste vale igual seja o adapter escrito com undici, axios ou `fetch`.

MSW continua sendo a ferramenta certa em `apps/web`, onde interceptação é o que
se quer.

## Formato

```jsonc
{
  "provider": "celcoin",
  "scenario": "pix-out/success",
  // "sandbox" = comportamento verificado.
  // "handcrafted-from-docs" = escrito a partir da documentação, NÃO verificado.
  "source": "sandbox",
  "recordedAt": "2026-08-20T14:02:11Z",
  "docsRef": "https://developers.celcoin.com.br/docs/transferencia-pix",
  "interactions": [
    {
      "request": { "method": "POST", "path": "/v5/token" },
      "response": { "status": 200, "body": { "access_token": "REDACTED_TOKEN", "expires_in": 3600 } }
    },
    {
      "request": {
        "method": "POST",
        "path": "/pix/v1/payment",
        "bodyHash": "sha256:..."
      },
      "response": {
        "status": 200,
        "body": { "endToEndId": "E00000000202608281200abcdef123456", "status": "CONFIRMED" }
      }
    }
  ]
}
```

Campos úteis:

- `bodyHash` — quando presente, o servidor só serve a interação se o corpo
  casar. Ausente, ignora o corpo. Tolera ordem de chave diferente no JSON.
- `maxUses` — limita quantas vezes a interação pode ser servida, para testar
  esgotamento e paginação.
- `delayMs` — atraso simulado, para exercitar timeout de verdade.

## Gravando contra sandbox

Operação **local, de mantenedor**. O CI não tem credencial e nunca grava.

```bash
RECORD=1 \
  CELCOIN_SANDBOX_CLIENT_ID=... \
  CELCOIN_SANDBOX_CLIENT_SECRET=... \
  pnpm --filter @baasconn/adapter-celcoin test:record
```

O gravador escreve **através de um scrubber**:

| Categoria | Tratamento |
|---|---|
| Headers | Allowlist. `Authorization`, `access_token`, `x-api-key` → `REDACTED_TOKEN` |
| CPF, CNPJ | Substituídos por documentos sintéticos **determinísticos** |
| Telefone, e-mail | Falsos determinísticos |
| Número de conta | Falso determinístico |
| Blob de documento | Removido |
| String de alta entropia > 24 chars | Sinalizada para revisão manual |

Determinístico é essencial: se o mesmo CPF virasse valores diferentes em
interações diferentes, as referências cruzadas dentro do cenário quebrariam e
a fixture deixaria de reproduzir o fluxo.

## Sem sandbox

Escreva a fixture a partir da documentação pública e marque:

```json
{ "source": "handcrafted-from-docs", "docsRef": "https://..." }
```

Isso é aceito. O relatório de conformidade e a matriz de capacidades mostram a
distinção, para ninguém confundir fixture escrita à mão com comportamento
verificado em sandbox.

## Documentos sintéticos permitidos

Estes têm dígito verificador válido (por isso passam nos schemas) mas foram
gerados para este repositório e não pertencem a ninguém:

| Documento | Valor |
|---|---|
| CPF | `52998224725` |
| CPF | `11144477735` |
| CNPJ | `11222333000181` |

Qualquer outro CPF ou CNPJ com dígito verificador válido é **bloqueado no CI**
por `scripts/check-cassette-pii.ts`. Um documento real no histórico do git não
pode ser apagado.

Rode o gate localmente antes do PR:

```bash
pnpm exec tsx scripts/check-cassette-pii.ts
```

## Quando o provedor muda

Fixture envelhece. Dois mecanismos:

1. Um job noturno opcional roda a suíte contra o sandbox real quando há
   credencial disponível no ambiente, e falha se a resposta divergir da fixture.
2. Ao regravar, o diff da fixture no PR mostra exatamente o que o provedor
   mudou — o que é bem mais útil que descobrir em produção.
