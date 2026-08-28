# ADR 0009: Credenciais de provedor cifradas em envelope no Postgres

- **Status:** Aceito
- **Data:** 2026-08-28

## Contexto

Credenciais de provedor sao por conexao e por ambiente. Precisam ser
gravaveis pelo console sem redeploy, e o mesmo chart precisa rodar em
EKS, GKE e AKS.

## Decisao

Envelope encryption: DEK aleatoria por conexao, cifrada por chave mestra do
KMS da nuvem; ciphertext AES-256-GCM na linha do Postgres. Driver de KMS
plugavel (`aws-kms | gcp-kms | azure-kv | local`).

## Alternativas consideradas

**Secret do Kubernetes.** Adicionar provedor exigiria redeploy, o console nao
poderia gravar credencial, e o valor ficaria em base64 no etcd, visivel a
qualquer um com `get secret` no namespace.

**Referencia para secret manager externo** (Secrets Manager, Vault). Mais
seguro num sentido, mas vira dependencia dura: nao da para rodar
`docker compose up` sem provisionar um secret manager. O driver `local`
resolve isso com a mesma interface, sem ramificacao no chamador.

## Consequencias

O K8s so precisa de `DATABASE_URL`, `REDIS_URL`, `JWT_PRIVATE_KEY` e
`KMS_KEY_ID`. E por isso que o chart e pequeno e que trocar de nuvem e uma
anotacao de ServiceAccount.

Rotacao incrementa `credentials_version`, o que invalida o cache in-process
por construcao. O plaintext nunca vai para o Redis.
