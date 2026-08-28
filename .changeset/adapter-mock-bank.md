---
'@baasconn/adapter-mock-bank': minor
'@baasconn/conformance': patch
'@baasconn/taxonomy': minor
---

Primeiro adapter de provedor: o Mock Bank, implementado por inteiro contra o
SPI facetado.

- `adapter-mock-bank`: contas, onboarding, saldo, chaves PIX, cobrancas, PIX
  in/out, devolucao, extrato e webhooks, com manifesto honesto (EMULATED e
  PARTIAL onde o provedor nao entrega o comportamento pleno) e conformidade
  verde nos 10 grupos.
- `conformance`: corrige o grupo da matriz de erros, que servia as fixtures
  felizes e as de erro no mesmo servidor — a resposta 200 casava primeiro em
  toda rota que os dois conjuntos cobriam, entao a fixture de erro nunca era
  alcancada e o teste passava sem exercitar nada.
- `taxonomy`: novo `PROVIDER_INTERNAL_ERROR` (502). Nao havia codigo para
  "o servidor do provedor falhou" — o unico destino era `PROVIDER_REJECTED`,
  que e o fallback da tabela de mapeamento e portanto reprovado pela
  conformidade.
