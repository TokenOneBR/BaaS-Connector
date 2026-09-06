# Subir num EKS para testar

Guia de ponta a ponta para pôr o BaaS Connector num cluster EKS. Escrito para
**teste**, não para produção — a seção final diz exatamente o que falta.

> **O que está verificado e o que não está.** O chart passa `helm lint`,
> `helm template` e `kubeconform` em Kubernetes 1.28 a 1.31, no CI, a cada
> commit. As cinco imagens constroem e publicam. O que **ninguém rodou ainda**
> é `helm install` num cluster de verdade — não há `helm`, `kubectl` nem
> `eksctl` no ambiente onde este guia foi escrito. Se algum passo falhar,
> [abra uma issue](https://github.com/TokenOneBR/BaaS-Connector/issues) com o
> log; é a informação que falta.

## O caminho curto

Os nove passos abaixo estão num script. Se você só quer o produto no ar:

```bash
./deploy/aws/eks-up.sh      # cria tudo e imprime as credenciais
./deploy/aws/eks-down.sh    # apaga tudo (não é opcional — ver Custo)
```

Ele pede confirmação antes de criar qualquer coisa cobrada, é idempotente
(rodar de novo reaproveita cluster e segredos, e faz `helm upgrade`), e falha
com uma mensagem útil se as imagens do GHCR estiverem privadas. Variáveis:
`REGIAO`, `CLUSTER`, `TAG`, `TIPO_NO`, `NOS`, `GHCR_USER`, `GHCR_TOKEN`.

O resto desta página é o mesmo caminho passo a passo, para quando você quiser
entender ou ajustar algum pedaço.

## Antes de começar

Na sua máquina: `aws` (autenticado), `eksctl`, `kubectl` e `helm`.

**Custo, de frente.** EKS não é barato para teste:

Valores de **`sa-east-1` (São Paulo)**, consultados na API de pricing da AWS.
São Paulo é uma das regiões mais caras — em `us-east-1` isto sai por bem menos.

| Item | US$/mês |
|---|---|
| Control plane EKS (US$ 0,10/h) | 73,00 |
| 2 nós `t3.medium` (US$ 0,0672/h cada) | 98,12 |
| EBS dos nós (2 × 30 GB gp3, US$ 0,152/GB) | 9,12 |
| EBS do Postgres + Redis (16 GB) | 2,43 |
| **Total** | **≈ 182,67** |
| Load balancer, se expuser publicamente | +24,82 |

Uma EC2 com `docker compose` faz o mesmo por **≈ US$ 43,69/mês** — ver
[`README.md`](README.md) nesta mesma pasta. **Cerca de 4× mais barato.**

A diferença não é desperdício: dos US$ 139 a mais, **US$ 73 são o control
plane**, uma taxa fixa que não roda nenhum pod seu — você paga pelos
servidores de API do Kubernetes e o etcd replicados em três AZs. O resto é o
segundo nó. Isso compra réplicas, self-healing, deploy sem downtime e
autoscaling. Para uma cópia de cada serviço, é um gerente de frota
administrando uma frota de um.

**O produto é idêntico nos dois caminhos.** Mesmas imagens, mesmo Postgres,
mesmo console. Este aqui vale quando você quer exercitar o Kubernetes em si,
ou quando outros serviços vão dividir o cluster.

**A seção [Desligar](#desligar) não é opcional.** Um cluster esquecido de pé
custa ~US$ 5/dia.

---

## 1. Liberar as imagens do GHCR

**Este é o primeiro bloqueio, e ele é silencioso.** Os pacotes publicados pelo
GitHub Actions nascem **privados**, mesmo num repositório público. Verificado:

```console
$ curl -s "https://ghcr.io/token?scope=repository:tokenonebr/baas-connector-api:pull&service=ghcr.io"
{"errors":[{"code":"UNAUTHORIZED","message":"authentication required"}]}
```

Sem resolver isso, todo pod fica em `ImagePullBackOff` sem explicar por quê.

**Opção A — tornar públicos** (recomendado; o projeto é Apache-2.0). Em
`github.com/orgs/TokenOneBR/packages`, para cada um dos cinco pacotes
(`baas-connector-api`, `-worker`, `-web`, `-mock-bank`, `-migrate`):
*Package settings → Change visibility → Public*.

**Opção B — `imagePullSecret`.** Crie um PAT com escopo `read:packages` e:

```bash
kubectl create secret docker-registry ghcr \
  --docker-server=ghcr.io \
  --docker-username=SEU_USUARIO \
  --docker-password=SEU_PAT \
  --namespace baas
```

Depois passe `--set image.pullSecrets[0].name=ghcr` no `helm install`.

## 2. A tag: `main`, nunca o padrão

**Segundo bloqueio.** O chart usa `appVersion` do `Chart.yaml` (`0.1.0`) quando
`image.tag` está vazio — e **não existe imagem `:0.1.0`**. O workflow publica
`:main` e `:sha-<commit>`; a tag semver só nasce num release, que ainda não
aconteceu.

Sempre passe a tag:

```bash
--set image.tag=main
```

Para um deploy reproduzível, prefira o SHA: `--set image.tag=sha-<40 chars>`.

## 3. Criar o cluster

```bash
export REGIAO=sa-east-1        # São Paulo: menor latência para PIX
export CLUSTER=baas-teste

eksctl create cluster \
  --name "$CLUSTER" \
  --region "$REGIAO" \
  --version 1.31 \
  --nodegroup-name padrao \
  --node-type t3.medium \
  --nodes 2 \
  --managed
```

Leva ~15 minutos. Ao terminar, o `kubectl` já aponta para ele:

```bash
kubectl get nodes
```

## 4. Postgres e Redis

O chart traz os dois como **subcharts opcionais, desabilitados por padrão** —
de propósito. Banco financeiro em StatefulSet é conveniente na primeira semana
e problema para sempre: backup, failover e upgrade de versão maior passam a ser
seus.

**Para teste**, ligue os subcharts (é o caminho deste guia):

```bash
helm dependency update deploy/helm/baas-connector
```

**Para qualquer coisa séria**, use RDS e ElastiCache e deixe os subcharts
desligados, apontando `secrets.databaseUrl` e `secrets.redisUrl` para eles.

## 5. Gerar os segredos

O chart precisa de cinco (o par JWT conta como dois). **Gere na sua máquina,
nunca no repositório:**

```bash
mkdir -p /tmp/baas-segredos && cd /tmp/baas-segredos

openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out jwt.key
openssl rsa -in jwt.key -pubout -out jwt.pub

export KMS_SECRET=$(openssl rand -base64 48)
export PEPPER=$(openssl rand -base64 48)
export SENHA_CONSOLE=$(openssl rand -base64 18)
export SENHA_PG=$(openssl rand -base64 18)

echo "Guarde a senha do console: $SENHA_CONSOLE"
```

## 6. Instalar

```bash
cd -   # volta para a raiz do repositorio
kubectl create namespace baas

helm install baas deploy/helm/baas-connector \
  --namespace baas \
  --set fullnameOverride=baas \
  --set image.tag=main \
  --set postgresql.enabled=true \
  --set postgresql.auth.username=baas \
  --set postgresql.auth.password="$SENHA_PG" \
  --set postgresql.auth.database=baas \
  --set redis.enabled=true \
  --set redis.auth.enabled=false \
  --set mockBank.enabled=true \
  --set seed.enabled=true \
  --set kms.driver=local \
  --set secrets.create=true \
  --set secrets.databaseUrl="postgresql://baas:$SENHA_PG@baas-postgresql:5432/baas?schema=public" \
  --set secrets.redisUrl="redis://baas-redis-master:6379" \
  --set-file secrets.jwtPrivateKey=/tmp/baas-segredos/jwt.key \
  --set-file secrets.jwtPublicKey=/tmp/baas-segredos/jwt.pub \
  --set secrets.kmsMasterSecret="$KMS_SECRET" \
  --set secrets.blindIndexPepper="$PEPPER" \
  --set secrets.seedPassword="$SENHA_CONSOLE" \
  --wait --timeout 15m
```

Quatro escolhas aí merecem explicação:

- **`fullnameOverride=baas`** não é cosmético. O helper monta o nome como
  `<release>-<nome do chart>`, então sem ele os recursos nascem
  `baas-baas-connector-api` e todo comando `kubectl` desta página falharia com
  `NotFound`. Com ele, os nomes são os que aparecem aqui.

- **`seed.enabled=true`** é o que torna o cluster utilizável. Sem ele as
  migrations criam as tabelas, `console_user` fica vazia, e como não existe
  rota de cadastro nem enrolamento de TOTP, **ninguém consegue entrar no
  console**. Nem um `INSERT` manual resolve: o segredo TOTP precisa estar
  cifrado com a mesma KMS que a API usa para decifrá-lo.
- **`mockBank.enabled=true`** liga o banco falso. `/_control` **não tem
  autenticação nenhuma**, de propósito — é para teste. Num cluster alcançável
  da internet, isso é um endpoint que injeta crédito em conta de cliente.
- **`kms.driver=local`** é obrigatório junto com o seed, e o chart falha
  explicitamente se você combinar seed com KMS de nuvem: o seed cifra com o
  `LocalKmsDriver` e não fala com AWS KMS.

## 7. Pegar as credenciais

O Job de seed imprime tudo no log:

```bash
kubectl logs -n baas job/baas-seed
```

Você verá o e-mail, a senha que você definiu, **o segredo TOTP em base32**, um
código válido no momento, e a **API key** — que aparece uma única vez.

> ⚠️ **Esses valores ficam no log do pod.** Qualquer pessoa com `kubectl logs`
> nesse namespace lê o segredo TOTP e a API key. É aceitável num cluster de
> teste e não é aceitável em produção. Depois de anotar:
> `kubectl delete job -n baas baas-seed`.

## 8. Acessar

**Imediato, sem custo extra** — só da sua máquina:

```bash
kubectl port-forward -n baas svc/baas-web 3000:3000 &
kubectl port-forward -n baas svc/baas-api 3001:3001 &
```

Console em `http://localhost:3000`, API em `http://localhost:3001/v1`.

**Público, com URL de verdade** — custa um load balancer (~US$ 20/mês) e exige
um ingress controller:

```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx --create-namespace

kubectl get svc -n ingress-nginx ingress-nginx-controller   # pegue o hostname do NLB
```

Aponte seu DNS para esse hostname e reinstale com `ingress.enabled=true`,
`ingress.className=nginx` e os hosts em `ingress.hosts`. Ajuste também
`config.publicBaseUrl` e `config.consoleOrigin` para a URL pública — senão o
link de webhook que o produto entrega ao provedor aponta para dentro do
cluster.

Para TLS, instale o cert-manager e anote o Ingress com o issuer.

## 9. Verificar

```bash
kubectl get pods -n baas
kubectl logs -n baas deploy/baas-api | tail -20
curl -s localhost:3001/readyz
```

O `/readyz` checa Postgres e Redis. O `/healthz` **não toca o banco** de
propósito: uma oscilação de banco não pode reiniciar todos os pods e
transformar degradação em outage.

## Desligar

Enquanto o cluster existe, ele cobra.

```bash
helm uninstall baas -n baas
helm uninstall ingress-nginx -n ingress-nginx   # se instalou
eksctl delete cluster --name "$CLUSTER" --region "$REGIAO"
```

Confirme que os volumes EBS sumiram — os PVCs dos subcharts podem sobreviver
ao `uninstall`:

```bash
kubectl get pvc -A
aws ec2 describe-volumes --region "$REGIAO" \
  --filters Name=status,Values=available --query 'Volumes[].VolumeId'
```

## O que este ambiente NÃO é

Igual ao guia da EC2, e pelas mesmas razões:

- **KMS local.** A chave mestra é um Secret do Kubernetes, não o AWS KMS. Em
  produção use `kms.driver=aws-kms` com `KMS_KEY_ID` e IRSA no ServiceAccount —
  e aí o seed não roda (ver passo 6).
- **Postgres sem backup.** Subchart em StatefulSet, sem snapshot, sem PITR,
  sem failover. Use RDS.
- **Mock Bank ligado.** `/_control` injeta crédito sem autenticação.
- **Segredos em `--set`.** Vão para o histórico do shell e para o release do
  Helm. Em produção use `secrets.existingSecret` alimentado por External
  Secrets ou SOPS.
- **Sem TLS por padrão**, sem WAF, sem limite de taxa na borda.
- **O adapter Celcoin tem cinco bloqueantes conhecidos** — ver
  [`docs/providers/celcoin-auditoria.md`](../../docs/providers/celcoin-auditoria.md).
  Para exercitar o fluxo de dinheiro, use o Mock Bank.
