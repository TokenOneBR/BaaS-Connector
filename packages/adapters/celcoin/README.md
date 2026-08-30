# Adapter Celcoin

Adapter de referência para a Celcoin. A documentação de integração está em
[`docs/providers/celcoin.md`](../../../docs/providers/celcoin.md); este arquivo
cobre só o que é específico do pacote.

## Fixtures

`source: 'handcrafted-from-docs'` — escritas a partir da documentação pública,
**não** gravadas contra o sandbox. Todo documento tem dígito verificador
inválido de propósito: o gate de PII do CI recusa CPF/CNPJ válido em fixture, e
os sintéticos que ele permite são os mesmos canários de vazamento do grupo 9 da
conformidade. A interseção das duas regras só deixa documento inválido.

## Rodando

```bash
pnpm --filter @baasconn/adapter-celcoin test              # mappers + conformidade
pnpm --filter @baasconn/adapter-celcoin test:conformance  # só a conformidade
```
