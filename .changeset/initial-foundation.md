---
"@baasconn/taxonomy": minor
"@baasconn/contracts": minor
---

Primeira versao da taxonomia canonica e dos contratos.

`@baasconn/taxonomy` traz o vocabulario compartilhado: `Money` em unidades
menores com alocacao sem residuo, identificadores ULID com prefixo e tipo
marcado, maquinas de estado com guard monotonico para ingestao de webhook,
catalogo de erros canonicos separando `retryable` de `safeToRetry`, validadores
de CPF/CNPJ/telefone/CEP e um codec completo de BR Code (EMV MPM) com CRC.

`@baasconn/contracts` traz os DTOs em Zod que servem simultaneamente de
validacao de requisicao, tipo do handler e fonte do OpenAPI.
