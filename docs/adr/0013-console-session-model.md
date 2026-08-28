# ADR 0013: Sessao do console com JWT assimetrico e refresh rotativo

- **Status:** Aceito
- **Data:** 2026-08-28

## Contexto

O console precisa autenticar pessoas, e o `/admin/v1` faz o que nenhuma API
key pode fazer: gravar credencial de provedor e cunhar chaves. A ADR 0006 ja
separou as duas superficies; falta decidir como a sessao humana funciona.

Tres requisitos empurram em direcoes diferentes. O console e um BFF Next.js,
entao o token nao pode chegar ao JavaScript do browser. "Desconectar todos os
dispositivos" precisa ter efeito imediato, nao quando o token expirar. E um
refresh token vazado nao pode valer para sempre.

## Decisao

**Access token JWT RS256, curto (15 min), verificado com algoritmo fixado.**

**Refresh token opaco `<sessionId>.<segredo>`, rotacionado a cada uso**, com
o segredo guardado como sha256. Reapresentar um token ja rotacionado revoga
**todas** as sessoes do usuario.

**Toda requisicao autenticada confere se a sessao ainda existe** no banco,
alem de validar o JWT.

**`OWNER` e `ADMIN` exigem TOTP**, e o segredo TOTP fica cifrado em envelope,
como credencial de provedor.

## Por que assim

**RS256 e nao HS256.** A chave privada fica so na API. Quando o worker
precisar validar um token — para uma acao administrativa agendada — ele
recebe apenas a publica. Com HMAC, validar exigiria distribuir a chave que
tambem assina, e todo servico que le vira um servico que pode forjar.

**`algorithms: ['RS256']` fixado na verificacao.** Sem isso, um token com
`"alg": "none"` passa, e um token HS256 assinado com a *chave publica* como
segredo tambem — a familia de bugs de confusao de algoritmo. A defesa e nunca
deixar o proprio token escolher como sera verificado.

**Checagem de sessao viva a cada requisicao.** Um JWT autocontido nao pode ser
revogado; e a caracteristica dele. Aceitar isso significaria que "encerrar
sessao" e uma promessa que so vale daqui a quinze minutos — inaceitavel para
a superficie que grava credencial. O custo e uma leitura indexada por
requisicao no `/admin/v1`, que e trafego de console, nao de integracao.

**Rotacao com deteccao de reuso.** E o padrao do BCP de OAuth 2.0 para
clientes publicos, e resolve o problema que TTL sozinho nao resolve: com
token fixo, quem rouba usa ate expirar sem deixar rastro. Com rotacao, o
ladrao e o dono acabam apresentando o mesmo token, e o segundo a chegar falha
— a falha e o sinal. Como nao da para saber qual dos dois e o legitimo,
revogamos ambos.

**sha256, e nao Argon2id, no refresh token.** O segredo tem 256 bits de
entropia aleatoria: nao existe dicionario para atacar. Um KDF caro aqui so
tornaria o refresh — que roda a cada quinze minutos em toda aba aberta —
lento sem ganho.

**TOTP implementado no `packages/crypto`, nao trazido de dependencia.** O
algoritmo cabe em trinta linhas, tem vetores de teste normativos na RFC 6238
(que a suite verifica), e uma dependencia a mais na arvore de autenticacao e
superficie de cadeia de suprimento desproporcional ao que economiza.

**`OWNER`/`ADMIN` sem TOTP configurado nao entram.** Deixar entrar seria
manter a conta com mais poder do sistema protegida so por senha, que e
exatamente a conta que um atacante procura.

**Papel minimo por rota (`@MinRole`), nao lista de papeis.** Lista obriga a
lembrar de incluir `OWNER` em toda rota nova; esquecer disso e o modo de
falha classico de RBAC feito a mao, e ele falha *fechado para o dono*, que e
justamente quem vai contornar o controle.

## Consequencias

- O `/admin/v1` nao escala como API de integracao, e nem deveria: para isso
  existe o `/v1`, com API key e sem leitura de sessao por requisicao.
- Rotacionar o par de chaves invalida todos os access tokens vivos. Aceitavel:
  os refresh tokens sobrevivem, e o console renova sozinho.
- Perder a chave privada e perder a capacidade de emitir sessao. Ela entra no
  mesmo secret manager de `DATABASE_URL`, e e um dos quatro unicos segredos
  que ficam no Kubernetes (ADR 0009).

## Alternativas descartadas

**Sessao opaca em Redis, sem JWT.** Revogacao imediata de graca, mas o Redis
vira sistema de registro de autenticacao: um failover desloga a operacao
inteira no meio de um incidente. Como ja consultamos o banco para verificar a
sessao viva, o JWT nos da a forma tipada e o `sid` sem custo adicional.

**Access token longo, sem refresh.** Simples ate o primeiro vazamento; sem
rotacao nao ha nada para detectar reuso.

**Delegar para um IdP externo (OIDC).** Certo para uma organizacao grande, e
o caminho quando houver demanda. Torna-lo obrigatorio agora significaria que
subir o conector exige antes provisionar um IdP — barreira grande demais para
um projeto que as pessoas vao auto-hospedar. O modelo aqui nao impede o
plugue posterior: o `AdminSessionGuard` continua sendo o unico ponto que
transforma credencial em `AdminSession`.
