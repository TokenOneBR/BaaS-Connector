# Dock

**Esqueleto honesto.** A Dock publica a referência de API atrás de portal de
parceiro. O que este pacote entrega e verifica é a **autenticação**, que a
documentação pública descreve — e nada além.

## Por que o manifesto está vazio

Declarar capacidades a partir de suposição seria o pior desfecho possível para
este projeto. A [matriz publicada](capability-matrix.md) é o artefato open
source de maior valor do repositório, e ela só vale enquanto ninguém precisar
conferir se é verdade.

Um esqueleto honesto **convida** contribuição de quem tem acesso ao portal; um
manifesto inventado afasta essa pessoa, porque ela encontra código errado em
vez de espaço em branco.

Cada capacidade não declarada devolve **501** com a nota do manifesto.

## Autenticação

OAuth2 `client_credentials` com o segredo em **Basic** — diferente da Celcoin,
que usa o corpo. A RFC 6749 permite os dois, e mandar o errado devolve 401 sem
dizer por quê; por isso a escolha é declarada em `credentialPlacement` em vez
de ficar implícita no `fetchToken`.

O `scope` varia por produto contratado e é opcional nas credenciais.

## Ambientes

Os hosts em `src/endpoints.ts` são o padrão da plataforma e **devem ser
confirmados no onboarding técnico**. A conexão pode sobrescrever com `baseUrl`,
que é exatamente para isso que o campo existe.

## Contribuindo

Se você tem acesso ao portal da Dock, o caminho está em
[`writing-a-provider-adapter.md`](../guides/writing-a-provider-adapter.md).
Comece pelo `CapabilityDescriptor` — declare honestamente, e a conformidade
cobra cada declaração.
