# Politica de seguranca

## Como reportar uma vulnerabilidade

**Nao abra uma issue publica.** Use o
[Private Vulnerability Reporting do GitHub](https://github.com/TokenOneBR/BaaS-Connector/security/advisories/new)
ou envie e-mail para **security@tokenone.com.br**.

Voce recebera confirmacao em **2 dias uteis** e uma avaliacao inicial em
**7 dias corridos**. Trabalhamos com divulgacao coordenada em **90 dias**,
negociavel se a correcao exigir mais tempo.

### O que NAO incluir no relato

Este e um projeto de infraestrutura financeira. Um relato de seguranca nao
deve conter:

- Credenciais reais de provedor (client secret, chave de API, certificado).
- CPF, CNPJ, nome, endereco ou qualquer dado pessoal de pessoa real.
- Chaves Pix, EndToEndId ou numeros de conta reais.
- Dumps de banco de producao ou de homologacao com dado real.

Se a reproducao exigir esse tipo de dado, descreva o formato e nos avise; nos
reproduzimos internamente.

## Escopo

Em escopo: `apps/api`, `apps/worker`, `apps/web`, todos os `packages/*`, o
chart Helm, os Dockerfiles e os workflows de CI.

**Fora de escopo, de proposito: `apps/mock-bank`.** O Mock Bank e um banco
falso para teste. Ele expoe endpoints `_control` que injetam falha, aprovam
onboarding e movem o relogio, sem autenticacao forte. Isso e intencional.
Ele **nunca** deve ser exposto na internet nem habilitado em producao, e o
chart o mantem desabilitado por padrao.

Tambem fora de escopo: ataques de negacao de servico por volume, relatorios
gerados apenas por scanner automatizado sem analise, e vulnerabilidades em
dependencias ja com advisory publico e correcao em andamento.

## Versoes suportadas

| Versao | Suporte |
|---|---|
| 0.x (pre-1.0) | Apenas a ultima minor |

A partir da 1.0, cada minor recebe correcao de seguranca por 12 meses.

## Boas praticas para quem opera

- Credenciais de provedor sao cifradas em envelope no Postgres com chave
  gerenciada por KMS. **Nunca** as coloque em Secret do Kubernetes, variavel
  de ambiente ou arquivo de configuracao.
- Nao exponha `/admin/v1` no ingress publico: o console fala com ele dentro
  do cluster.
- Mantenha `/metrics` na porta 9464, separada da porta publica.
- Chaves de API de producao devem ter assinatura HMAC obrigatoria.
