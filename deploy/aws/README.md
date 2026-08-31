# Subir na AWS para testar

Uma instância EC2 rodando o Compose inteiro — Postgres, Redis, API, worker,
console e Mock Bank. Custa **~US$ 12/mês** ligada full-time, ou **~US$ 0,02/h**
se você ligar só para testar e desligar depois.

Para a postura de produção — RDS, ElastiCache, alta disponibilidade — o
caminho é o chart Helm em `deploy/helm/`. Este aqui é para **testar**.

---

## Antes de começar

O Compose puxa as imagens de `ghcr.io/tokenonebr/baas-connector-*`. Elas são
publicadas pelo workflow **Imagens** a cada push na `main`. Confirme que o
último run passou antes de lançar a instância:

<https://github.com/TokenOneBR/BaaS-Connector/actions/workflows/docker.yml>

Se ainda não houver imagem publicada, a instância vai construir do código —
funciona, mas leva ~10 min a mais e pede uma instância com pelo menos 4 GB.

---

## 1. Segurança da rede

O grupo de segurança é o que separa "um ambiente de teste" de "um endpoint
público que cunha dinheiro". O `_control` do Mock Bank injeta crédito em conta
**sem autenticação nenhuma** — ele fica preso em `127.0.0.1` pelo
`compose.aws.yaml`, mas o grupo de segurança é a segunda camada.

| Porta | Origem | Por quê |
|---|---|---|
| 22 | **só o seu IP** | SSH |
| 80 | `0.0.0.0/0` | Let's Encrypt precisa alcançar para emitir o certificado |
| 443 | `0.0.0.0/0` | console e API |

**Não abra 5432, 6379, 3000, 3001 nem 3002.** O `compose.aws.yaml` já não
publica Postgres e Redis em porta nenhuma do host, e prende o resto em
loopback. Alcance-os por túnel SSH quando precisar:

```bash
ssh -L 3002:127.0.0.1:3002 ec2-user@SEU_IP    # painel do Mock Bank
ssh -L 3001:127.0.0.1:3001 ec2-user@SEU_IP    # API direta
```

## 2. Domínio, se você for cadastrar credencial real

**Sem domínio o Caddy serve HTTP puro**, e a chave da Woovi que você digitar no
console viaja em claro pela internet.

Para o Mock Bank isso não importa — é um banco falso. Antes de cadastrar
qualquer credencial real, aponte um registro `A` para o IP da instância.

## 3. Lançar

```bash
aws ec2 run-instances \
  --image-id resolve:ssm:/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64 \
  --instance-type t4g.small \
  --key-name SUA_CHAVE \
  --security-group-ids sg-SEUGRUPO \
  --block-device-mappings 'DeviceName=/dev/xvda,Ebs={VolumeSize=30,VolumeType=gp3}' \
  --user-data file://deploy/aws/user-data.sh \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=baas-connector}]'
```

Com domínio, edite `DOMINIO="..."` no topo do `user-data.sh` antes.

`t4g.small` (2 vCPU ARM, 2 GB) roda o stack confortavelmente com as imagens
prontas. Se for construir na instância, use `t4g.medium`.

## 4. Pegar as credenciais

O boot leva ~3 min. Depois:

```bash
ssh ec2-user@SEU_IP
cd /opt/baas/app
docker compose -f compose.yaml -f compose.aws.yaml logs seed
```

O seed imprime o e-mail, a senha, o segredo TOTP em base32 e um link
`otpauth://` para o autenticador. **Guarde o segredo TOTP** — ele não é
mostrado de novo, e sem ele não há login (`OWNER` exige 2FA e não existe
enrolamento self-service).

Se o boot falhar: `sudo cat /var/log/baas-bootstrap.log`.

## 5. Testar

Abra `https://SEU_DOMINIO` (ou `http://SEU_IP`) e entre com essas credenciais.

Para o fluxo do dinheiro pela API, da sua máquina:

```bash
export BAAS_URL=https://SEU_DOMINIO
export BAAS_API_KEY='a chave que o seed imprimiu'
export BAAS_SIGNING_SECRET='o segredo de assinatura'

node examples/fluxo-completo.mjs
```

> O `_control` do Mock Bank não é roteado pelo Caddy de propósito. O
> `examples/fluxo-completo.mjs` o usa para injetar um PIX de entrada — abra o
> túnel SSH da porta 3002 antes, ou rode o exemplo pelo próprio host.

## 6. Desligar quando não estiver testando

```bash
aws ec2 stop-instances --instance-ids i-SEUID     # para de cobrar computação
aws ec2 start-instances --instance-ids i-SEUID    # o Compose sobe sozinho
```

O disco continua sendo cobrado (~US$ 2,40/mês por 30 GB gp3) e os dados
persistem. Para apagar tudo: `terminate-instances`.

---

## Atualizar para uma versão nova

```bash
ssh ec2-user@SEU_IP
cd /opt/baas/app
git pull
docker compose -f compose.yaml -f compose.aws.yaml pull
docker compose -f compose.yaml -f compose.aws.yaml up -d --wait
```

As migrations rodam sozinhas antes da API subir, e o seed é idempotente — não
duplica nada nem troca a sua senha.

---

## O que este ambiente NÃO é

Vale dizer com todas as letras, porque a diferença importa se alguém pensar em
promovê-lo:

- **`KMS_DRIVER=local`.** A chave mestra que envolve as credenciais de
  provedor fica numa variável de ambiente no disco da instância. Em produção
  use `aws-kms` com uma role de instância — a API inclusive **se recusa** a
  subir com o driver local quando `NODE_ENV=production`.
- **Postgres em container, sem backup.** Perder o volume perde tudo.
- **Uma instância só.** Sem alta disponibilidade, sem rollout sem downtime.
- **Sem observabilidade.** Adicione com
  `-f compose.observability.yaml` se quiser Prometheus, Grafana e Jaeger.
