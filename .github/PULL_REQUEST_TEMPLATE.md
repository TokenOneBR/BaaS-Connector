## O que muda

<!-- Uma ou duas frases. O "porque" importa mais que o "o que". -->

## Por que

<!-- Issue relacionada, incidente, ou o problema que isto resolve. -->

Closes #

## Como verificar

<!-- Comandos exatos que o revisor pode rodar. -->

```bash
pnpm test
```

## Checklist

- [ ] Commits assinados com `-s` (DCO)
- [ ] Titulo do PR em conventional commit
- [ ] `pnpm lint && pnpm typecheck && pnpm test` passam localmente
- [ ] Changeset adicionado, se mexeu em `packages/`
- [ ] Nenhum documento, credencial ou chave real em codigo ou fixture
- [ ] Dinheiro continua em `bigint` de centavos; nenhum `number` novo
- [ ] Nenhum `Date.now()` novo fora de teste

### Se mexeu num adapter

- [ ] `CapabilityDescriptor` reflete honestamente o que foi implementado
- [ ] `pnpm test:conformance` passa
- [ ] Fixtures gravadas passaram pelo scrubber, ou estao marcadas como
      `handcrafted-from-docs`
- [ ] Matriz de erros cobre os codigos que aparecem nas fixtures

### Se mexeu no modelo canonico

- [ ] ADR aberto e aprovado antes deste PR
- [ ] Changeset declara corretamente patch / minor / major
