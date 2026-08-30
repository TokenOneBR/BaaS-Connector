---
'@baasconn/adapter-celcoin': minor
'@baasconn/conformance': patch
---

Adiciona o adapter da Celcoin.

Contas PF e PJ, leitura de proposta de onboarding, saldo, chaves PIX (criar,
listar, remover, resolver no DICT) e PIX out com consulta por chave de
idempotência — a rota que a escada de desfecho desconhecido usa como primeira
tentativa.

As fixtures são `handcrafted-from-docs`, escritas a partir da documentação
pública e não gravadas contra o sandbox. A conformidade prova que os mappers
são coerentes com o que a documentação descreve; não prova que a documentação
está certa. O manifesto declara `UNSUPPORTED` tudo que não foi possível
confirmar, e a matriz publicada mostra as lacunas.

Em `@baasconn/conformance`, as duas verificações que cobram promessas — exigir
fixture de erro e exigir tráfego para o cassette server — passam a valer só a
partir da primeira capacidade declarada, para que um esqueleto honesto (que não
promete nada) não reprove a própria suíte.
