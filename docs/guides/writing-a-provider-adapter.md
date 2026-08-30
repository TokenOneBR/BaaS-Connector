# Escrevendo um adapter de provedor

Este é o documento de maior alavancagem do repositório: ele converte interesse
em contribuição. Se você quer adicionar um BaaS ao conector, siga na ordem.

Um adapter completo fica em torno de 1.200 a 1.800 linhas, incluindo mappers.
Um esqueleto honesto fica em ~120.

---

## 0. Antes do código: declare o que existe

Abra uma issue com o template **Novo adapter de provedor**. O primeiro passo
não é código, é levantar honestamente o que o provedor oferece — porque é isso
que vai para o `CapabilityDescriptor`, e a suíte de conformidade cobra os dois
sentidos: capacidade declarada como suportada precisa funcionar, e capacidade
declarada como não suportada precisa devolver `CapabilityNotSupportedError`.

## 1. Scaffold

```bash
pnpm new:adapter <slug>
```

Isso cria `packages/adapters/<slug>/` com src, manifesto, spec de conformidade,
diretório de fixtures, README e changeset.

## 2. O manifesto primeiro

```ts
// src/manifest.ts
import { defineManifest } from '@baasconn/provider-spi';
import { SupportLevel } from '@baasconn/taxonomy';

export const meuProvedorManifest = defineManifest({
  'balance.get': SupportLevel.SUPPORTED,
  'pix.charge.dynamic.create': SupportLevel.SUPPORTED,
  'pix.out.send': {
    level: SupportLevel.PARTIAL,
    note: 'Exige saldo pré-alocado na conta do provedor; sem agendamento.',
    docRef: 'https://developers.exemplo.com/pix/out',
  },
  // Tudo que você não declarar vira UNSUPPORTED automaticamente.
  // `accounts.*` e `onboarding.*` omitidos => o conector devolve 501
  // com a nota, antes de qualquer chamada de rede.
});
```

Regras:

- `PARTIAL` e `EMULATED` **exigem** `note`. A nota vai no corpo do erro e na
  matriz publicada; sem ela a suíte falha.
- `constraints` são validadas pelo core **antes** de chamar você. Use-as para
  transformar "o provedor vai recusar" numa mensagem nossa útil.
- Seja conservador. Declarar de menos é fácil de corrigir; declarar de mais
  produz erro opaco em produção.

## 3. Credenciais e endpoints

```ts
// src/credentials.ts
import { z } from 'zod';

export const credentialsSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  // mTLS opcional
  certPem: z.string().optional(),
  keyPem: z.string().optional(),
});
```

Este schema é validado **antes** de a credencial ser cifrada e gravada. Ele é o
que impede uma conexão quebrada entrar no banco e só falhar na primeira
chamada.

```ts
// src/endpoints.ts
export const endpoints = {
  HOMOLOGACAO: 'https://sandbox.exemplo.com',
  PRODUCAO: 'https://api.exemplo.com',
} as const;
```

A suíte verifica que os dois **diferem**. Homologação apontando para produção é
como se faz uma transferência real achando que era teste.

## 4. Autenticação

O kit cobre os modelos que aparecem na prática:

| Provedor real | Estratégia |
|---|---|
| Celcoin | `OAuth2ClientCredentialsStrategy` com `credentialPlacement: 'body'` |
| Asaas | `StaticApiKeyStrategy({ header: 'access_token', value })` |
| Woovi | `StaticApiKeyStrategy({ header: 'Authorization', value: appId })` |
| QI Tech | `HmacSignatureStrategy` (JWT assinado com ECDSA-SHA512) |
| Fluxos SPI | `MtlsStrategy`, ou `CompositeStrategy` sobre OAuth2 |

O token cache tem single-flight embutido: 200 requisições concorrentes num
token expirado viram **uma** ida ao provedor. Sem isso a conexão toma rate
limit no pior momento possível.

## 5. Matriz de erros

Preencha a tabela. A suíte testa cada linha.

```ts
// src/errors.ts
import { COMMON_ERROR_MAPPINGS, type ErrorMapping } from '@baasconn/adapter-kit';
import { BaasErrorCode } from '@baasconn/taxonomy';

export const errorMappings: readonly ErrorMapping[] = [
  // Mais específico primeiro.
  { when: { status: 400, code: /^SALDO/ }, to: BaasErrorCode.INSUFFICIENT_FUNDS },
  { when: { status: 400, code: 'CPF_INVALIDO' }, to: BaasErrorCode.INVALID_TAX_ID },
  { when: { status: 422, messageMatch: /chave.*n[aã]o.*encontrada/i }, to: BaasErrorCode.PIX_KEY_NOT_FOUND },
  ...COMMON_ERROR_MAPPINGS,
];
```

**A regra que impede a tabela de apodrecer:** toda fixture em
`test/fixtures/errors/` precisa mapear para algo diferente do fallback
`PROVIDER_REJECTED`. Um código novo do provedor aparece como falha de teste, e
não como erro genérico em produção às 3h da manhã.

## 6. Uma capacidade por vez

Cada capacidade entra com fixture e conformidade verde. Layout do adapter:

```
packages/adapters/<slug>/
├── src/
│   ├── index.ts              # exporta APENAS a factory
│   ├── factory.ts            # implementa ProviderAdapterFactory
│   ├── adapter.ts            # monta as facetas, implementa health()
│   ├── manifest.ts
│   ├── credentials.ts
│   ├── endpoints.ts
│   ├── auth.ts
│   ├── errors.ts
│   ├── redaction.ts          # BASE_REDACTION + caminhos deste provedor
│   ├── facets/               # uma por faceta declarada
│   ├── mappers/              # funções PURAS canônico <-> provedor
│   └── dto/                  # tipos do wire do provedor
└── test/
    ├── fixtures/{happy,errors,webhooks}/
    ├── conformance.spec.ts   # ~15 linhas
    └── mappers.spec.ts       # testa os mappers sem HTTP
```

Mappers são funções puras e testadas sem HTTP. É onde vive a maior parte da
lógica e é o que quebra quando o provedor muda um campo.

## 7. Gravando fixtures

```bash
RECORD=1 EXEMPLO_SANDBOX_CLIENT_ID=... EXEMPLO_SANDBOX_CLIENT_SECRET=... \
  pnpm --filter @baasconn/adapter-exemplo test:record
```

Isso faz o `CassetteServer` virar proxy gravador contra o sandbox real e
escreve as fixtures **através de um scrubber**:

- Headers passam por allowlist; `Authorization` e afins viram `REDACTED_TOKEN`.
- CPF, CNPJ, telefone e e-mail viram falsos **determinísticos** — determinísticos
  para as referências cruzadas entre interações sobreviverem.
- Qualquer string de alta entropia com mais de 24 caracteres é sinalizada para
  revisão manual.

Gravação é operação **local, de mantenedor**. O CI não tem credencial e nunca
grava.

Sem sandbox público, escreva a fixture a partir da documentação e marque:

```json
{ "source": "handcrafted-from-docs", "docsRef": "https://developers.exemplo.com/..." }
```

O relatório de conformidade mostra isso, para ninguém confundir fixture manual
com comportamento verificado.

`scripts/check-cassette-pii.ts` bloqueia no CI qualquer fixture com CPF/CNPJ de
dígito verificador válido, string em formato JWT ou bloco PEM.

## 8. Dinheiro, datas, documentos

- **Dinheiro é `bigint` em centavos.** Nunca `number`. Nunca `parseFloat`. Use
  `Money.fromDecimalString('150.75')` na fronteira, e `toDecimalString()` para
  provedores que exigem decimal. Há regra de lint.
- **Datas** normalizadas para UTC ISO-8601 com offset. Data contábil usa
  `toEffectiveDate()`, que respeita o dia bancário brasileiro — um PIX às 22h de
  Brasília é do mesmo dia útil, mas já é o dia seguinte em UTC.
- **`Date.now()` é proibido.** Use `ctx.runtime.clock`.
- **Documentos** trafegam como stream, nunca base64 bufferizado: documento de
  KYC passa de 20 MB.

## 9. Webhooks

```ts
verifySignature(request, secret) {
  // Use request.rawBody, NUNCA o JSON parseado: reserializar muda a
  // assinatura e ela deixa de conferir.
}

eventIdentity(request) {
  // Identidade ESTÁVEL entre reentregas. Nunca derive de Date.now():
  // reentrega é comportamento normal do provedor, e identidade instável
  // faz o cliente ver o mesmo PIX duas vezes.
  return { providerEventId: body.id ?? sha256(request.rawBody) };
}

parse(request) {
  // Zero ou mais eventos canônicos. Devolver array é deliberado:
  // provedores empacotam vários fatos num webhook, e muitos webhooks são
  // ruído que descartamos.
}
```

## 10. A suíte de conformidade

```ts
// test/conformance.spec.ts
import { runConformanceSuite } from '@baasconn/conformance';
import { exemploFactory } from '../src';
import { happyPath, errors, webhooks } from './fixtures';

runConformanceSuite({
  factory: exemploFactory,
  credentials: { clientId: 'test', clientSecret: 'test' },
  fixtures: { happyPath, errors, webhooks },
});
```

Onze grupos de asserção, cada um matando uma classe de bug que já custou
dinheiro em integração com BaaS:

1. **Honestidade de capacidade** — declarado suportado precisa funcionar;
   declarado não suportado precisa devolver 501. Mata o modo de falha
   "declarado mas quebrado".
2. **Schema de credenciais** — aceita as de teste, recusa vazio.
3. **Health check** — responde sem lançar, mesmo com o provedor ruim.
4. **Mapeamento canônico** — nenhum status cru do provedor vaza.
5. **Precisão monetária** — pega o `Number(valor) * 100` que vira
   `15074.999999999998`.
6. **EndToEndId** — formato do BACEN quando presente; ausente é legítimo.
7. **Matriz de erros** — nenhuma fixture cai no fallback.
8. **Webhooks** — assinatura válida aceita; corpo adulterado, segredo errado e
   identidade instável recusados.
9. **Redação** — nenhum documento ou credencial em log ou registro de chamada.
10. **Isolamento de rede** — todas as chamadas vão para o cassette server.
    Pega adapter com URL fixa no código.
11. **Extrato** — paginar termina, não repete cursor nem linha, e os saldos de
    abertura e fechamento (opcionais) precisam fechar com as linhas da janela.
    Pega o adapter que ignora `hasMore` e trunca a janela em silêncio, e o que
    devolve dois saldos plausíveis e incoerentes entre si.

O servidor de fixtures é **HTTP real** e não `nock`/MSW de propósito:
interceptação mocka exatamente a camada que mais queremos testar (timeout,
reuso de conexão, `Retry-After`, streaming) e amarra o teste à biblioteca HTTP
que você usou por dentro.

## 11. A regra que impede pagamento duplo

Leia isto antes de escrever `pixTransfers.send`.

O kit **nunca** retenta uma escrita não idempotente cuja falha não seja
provadamente pré-commit. Timeout de headers ou body num POST que move dinheiro
é **desfecho indeterminado**: o kit lança `ProviderOutcomeUnknownError`, a
transação vai para `UNKNOWN`, o cliente recebe **202** e um job resolve
consultando o provedor pela nossa chave.

Se o seu provedor **não tem** mecanismo de idempotência
(`idempotency: { 'pix.out': { mode: 'none' } }`), você é **obrigado** a
implementar `findByIdempotencyKey`. A validação de boot recusa o adapter sem
isso, porque sem essa busca o único jeito de resolver um timeout seria reenviar
o pagamento.

## 12. Antes de abrir o PR

```bash
pnpm --filter @baasconn/adapter-<slug> lint
pnpm --filter @baasconn/adapter-<slug> typecheck
pnpm --filter @baasconn/adapter-<slug> test
pnpm test:conformance
pnpm exec tsx scripts/check-cassette-pii.ts
pnpm changeset
```

Checklist:

- [ ] Manifesto reflete honestamente o que foi implementado
- [ ] Conformidade verde
- [ ] Fixtures passaram pelo scrubber, ou estão marcadas `handcrafted-from-docs`
- [ ] Matriz de erros cobre os códigos que aparecem nas fixtures
- [ ] `README.md` do adapter tem links da documentação e as peculiaridades
- [ ] `docs/providers/<slug>.md` com o que o integrador precisa saber
- [ ] Nenhum documento, credencial ou chave real em código ou fixture

## 13. Depois do merge

Você entra no `CODEOWNERS` do caminho do seu adapter — e apenas dele. Isso é
deliberado: você passa a poder aprovar mudanças no seu adapter, e continua
estruturalmente impedido de alterar o modelo canônico, o código de
autenticação, o pipeline de release ou o adapter de outro provedor. Veja
[GOVERNANCE.md](../../GOVERNANCE.md).
