# ADR 0016: O extrato do SPI carrega saldos opcionais e o Mock Bank pagina de verdade

- **Status:** Aceito
- **Data:** 2026-08-30

## Contexto

A conciliação em três vias tem cinco passes, e o quinto — `abertura + Σ movimentos casados ?= fechamento` — é a rede que pega o que os quatro anteriores não pegam: um movimento que existe nos dois lados, casa perfeitamente, e mesmo assim não explica o saldo. Tarifa não extratada, bloqueio judicial, estorno lançado fora da janela.

Esse passe foi construído e testado, e **não tinha fonte de dados**. `StatementFacet.list()` devolvia `Page<StatementEntry>` e nada mais: nenhum saldo. `BALANCE_MISMATCH` — um dos onze tipos de quebra que o produto promete ao operador — nunca abriria.

Ao mesmo tempo, o único adapter existente declarava `statement.list` como `PARTIAL`, devolvia a janela inteira de uma vez e `hasMore: false` sempre. O conector pagina até `hasMore === false`; com o único provedor de teste nunca paginando, esse laço nunca era exercitado contra um servidor HTTP real. É o comportamento mais perigoso do lado do provedor: ignorá-lo trunca a janela em silêncio e produz `MISSING_ON_LOCAL` fantasma. **Quebra inventada é pior que quebra nenhuma** — a real custa uma investigação, a inventada custa a confiança no painel inteiro.

As duas lacunas moram na mesma rota, e fechá-las juntas custa uma regravação de fixture em vez de duas.

## Decisão

**1. `StatementFacet.list()` passa a devolver `StatementPage`, com `openingBalance` e `closingBalance` OPCIONAIS.**

```ts
export interface StatementPage extends Page<StatementEntry> {
  openingBalance?: MoneyJSON;
  closingBalance?: MoneyJSON;
}
```

Aditivo e retrocompatível: `StatementPage` é assinável por qualquer `Page<StatementEntry>` existente, então nenhum adapter deixa de compilar.

**2. Os saldos são da JANELA, não da página.** Idênticos em toda página da mesma consulta; quem consome lê da primeira que receber. Repetir é redundante e barato; obrigar o consumidor a chegar à última página para saber o saldo seria hostil.

**3. Opcionais no SPI, obrigatoriamente coerentes na conformidade.** Quem informa os dois precisa que `abertura + Σ(créditos − débitos da janela) = fechamento` feche. O grupo 11 da suíte verifica exatamente isso, e só roda quando os campos vêm.

**4. O Mock Bank pagina de verdade,** com cursor de keyset por `(liquidação, id)`, e sobe de `PARTIAL` para `SUPPORTED`. É a primeira rota paginada dele, e o cursor é opaco: cliente que o decodifica passa a depender do formato, e o formato deixa de ser nosso.

**5. A tarifa vira uma LINHA de extrato própria,** com `StatementEntryType.FEE`. O razão debita `valor + tarifa` da conta do cliente; se a tarifa não for uma linha, a soma das linhas não bate com a variação de saldo e a conferência acusaria diferença em toda conta que paga tarifa. De quebra, `UNMATCHED_FEE` deixa de ser um tipo de quebra que nada consegue produzir.

**6. O extrato do Mock Bank só lista o que liquidou,** pela mesma lista de status que o conector usa (`SETTLED`, `REVERSED`, `PARTIALLY_REVERSED`), e janela por liquidação, não por criação. Um extrato que mostra pagamento em `PROCESSING` não é extrato, e os saldos deixariam de fechar com as linhas.

## Consequências

- O passe 5 sai da dormência: contra o Mock Bank, `BALANCE_MISMATCH` passa a ser alcançável, e o e2e do marco pode semear uma divergência de saldo de verdade.
- Adapter que não informa saldo continua válido e a conciliação declara o passe pulado (`skippedReason`), em vez de acreditar num número.
- O laço de paginação do conector passa a ser exercitado por HTTP real, com duas páginas na fixture. Um adapter que ignorasse `hasMore` reprova.
- O Mock Bank ganha uma convenção de paginação que os próximos recursos dele vão seguir.
- Fixtures de extrato mudam de forma, e a suíte de conformidade ganha um décimo primeiro grupo. Os guias que enumeravam "dez grupos" precisam acompanhar.

## Alternativas rejeitadas

**Tornar os saldos obrigatórios no SPI.** Forçaria todo adapter a devolver um número mesmo sem ter como calculá-lo, e o caminho de menor esforço seria repetir o saldo atual. Um saldo ausente a conciliação declara; um saldo inventado ela acredita, e passa a abrir quebra de saldo em cima de ficção — alguém investiga por uma tarde um número que nunca existiu.

**Derivar abertura e fechamento de `BalanceFacet.get()`.** Devolve o saldo de agora, não o do fim da janela. Serviria para uma execução intradiária terminando neste instante e seria simplesmente errado para a execução diária sobre o dia anterior — que é justamente a execução contábil que mais importa.

**Derivar fechamento como `abertura + Σ linhas`.** A identidade passaria a valer por construção da fórmula, e a asserção da conformidade viraria tautologia. Os dois lados precisam ser calculados de fontes independentes — o razão e as linhas — para que concordarem signifique alguma coisa.

**Manter o Mock Bank sem paginação e provar o laço com um dobro em memória.** Testaria o laço contra exatamente a camada que o projeto decidiu não mockar. É o mesmo argumento do `CassetteServer` sobre `nock`: bibliotecas de interceptação mockam a camada que mais queremos testar.

**Dobrar a tarifa dentro do valor da linha.** O cliente veria R$ 100,50 numa transferência de R$ 100,00. Fecharia a aritmética mentindo no extrato.
