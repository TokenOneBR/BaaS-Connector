#!/usr/bin/env bash
#
# Sobe o BaaS Connector num EKS novo, do zero, num comando.
#
#   ./deploy/aws/eks-up.sh
#
# Faz o que o guia deploy/aws/eks.md descreve em nove passos: verifica o
# ambiente, cria o cluster, resolve as imagens do GHCR, gera os segredos,
# instala o chart e imprime as credenciais.
#
# LEIA ISTO ANTES DE RODAR:
#
#   Este script CRIA RECURSOS COBRADOS na sua conta AWS — cerca de US$ 160
#   por mes enquanto o cluster existir (~US$ 5 por dia). Ele pede confirmacao
#   explicita antes de criar qualquer coisa.
#
#   Para desligar tudo: ./deploy/aws/eks-down.sh
#
# E idempotente: rodar de novo reaproveita o cluster e os segredos que ja
# existem, e faz `helm upgrade` em vez de `install`. Rodar duas vezes nao
# cria dois clusters nem rotaciona a chave JWT por baixo dos dados.
set -euo pipefail

# --- ajuste aqui, se quiser -----------------------------------------------

REGIAO="${REGIAO:-sa-east-1}"          # Sao Paulo: menor latencia para PIX
CLUSTER="${CLUSTER:-baas-teste}"
NAMESPACE="${NAMESPACE:-baas}"
TAG="${TAG:-main}"                     # NUNCA use o padrao do chart: nao existe imagem :0.1.0
TIPO_NO="${TIPO_NO:-t3.medium}"
NOS="${NOS:-2}"
VERSAO_K8S="${VERSAO_K8S:-1.31}"

# Onde os segredos gerados ficam. Fora do repositorio, de proposito.
SEGREDOS="${SEGREDOS:-$HOME/.baas-connector/$CLUSTER}"

# Para imagens privadas no GHCR. Se as suas estiverem publicas, ignore.
GHCR_USER="${GHCR_USER:-}"
GHCR_TOKEN="${GHCR_TOKEN:-}"           # PAT com escopo read:packages

# Pule a confirmacao de custo (para CI). Deixe vazio para ser perguntado.
CONFIRMAR="${CONFIRMAR:-}"

# --------------------------------------------------------------------------

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHART="$RAIZ/deploy/helm/baas-connector"
IMAGENS=(api worker web mock-bank migrate)

vermelho() { printf '\033[31m%s\033[0m\n' "$*"; }
verde()    { printf '\033[32m%s\033[0m\n' "$*"; }
passo()    { printf '\n\033[1m== %s\033[0m\n' "$*"; }
morrer()   { vermelho "ERRO: $*"; exit 1; }

# --- 0. o ambiente tem o que precisa? -------------------------------------

passo "0/8  Verificando o ambiente"

for bin in aws eksctl kubectl helm openssl curl; do
  command -v "$bin" >/dev/null 2>&1 || morrer "\`$bin\` nao encontrado no PATH.
  aws     https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html
  eksctl  https://eksctl.io/installation/
  kubectl https://kubernetes.io/docs/tasks/tools/
  helm    https://helm.sh/docs/intro/install/"
done

[ -f "$CHART/Chart.yaml" ] || morrer "chart nao encontrado em $CHART — rode a partir do repositorio."

IDENTIDADE="$(aws sts get-caller-identity --query Arn --output text 2>/dev/null)" \
  || morrer "a AWS CLI nao esta autenticada. Rode \`aws configure\` ou \`aws sso login\`."

echo "  aws       $IDENTIDADE"
echo "  regiao    $REGIAO"
echo "  cluster   $CLUSTER"
echo "  tag       $TAG"

# --- 1. o custo, de frente ------------------------------------------------

if ! eksctl get cluster --name "$CLUSTER" --region "$REGIAO" >/dev/null 2>&1; then
  passo "1/8  Confirmacao de custo"
  cat <<AVISO

  Vou criar um cluster EKS em $REGIAO. Isso e cobrado.

  Precos REAIS de sa-east-1 (Sao Paulo), da API de pricing da AWS:

    control plane EKS ....... US\$  73,00/mes   (US\$ 0,10/h, fixo)
    $NOS nos $TIPO_NO ............ US\$  98,12/mes
    volumes EBS ............. US\$  11,55/mes
                              -----------------
    total ................... US\$ 182,67/mes   (~US\$ 6/dia)

  Se voce mudou REGIAO ou TIPO_NO, os numeros mudam.

  Uma EC2 com docker compose faz o mesmo por ~US\$ 44/mes — 4x mais barato,
  e o produto e IDENTICO. Veja deploy/aws/README.md
  Dos US\$ 139 a mais, US\$ 73 sao o control plane: uma taxa que nao roda
  nenhum pod seu. Voce paga por orquestracao — replicas, self-healing,
  deploy sem downtime. Para uma copia de cada servico, e caro.

  Para desligar depois:  ./deploy/aws/eks-down.sh

AVISO
  if [ -z "$CONFIRMAR" ]; then
    read -r -p "  Digite 'sim' para criar o cluster: " CONFIRMAR
  fi
  [ "$CONFIRMAR" = "sim" ] || { echo "  Cancelado. Nada foi criado."; exit 0; }
else
  passo "1/8  Cluster $CLUSTER ja existe — reaproveitando"
fi

# --- 2. as imagens do GHCR sao alcancaveis? -------------------------------
#
# Este e o bloqueio mais silencioso do caminho: pacotes publicados pelo
# GitHub Actions nascem PRIVADOS mesmo num repositorio publico, e o unico
# sintoma e todo pod em ImagePullBackOff sem dizer por que.

passo "2/8  Verificando acesso as imagens no GHCR"

REPO_GHCR="tokenonebr/baas-connector"
PRIVADAS=()
for img in "${IMAGENS[@]}"; do
  tok="$(curl -fsS "https://ghcr.io/token?scope=repository:${REPO_GHCR}-${img}:pull&service=ghcr.io" 2>/dev/null \
        | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')"
  if [ -z "$tok" ] || ! curl -fsS -o /dev/null \
       -H "Authorization: Bearer $tok" \
       -H 'Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json' \
       "https://ghcr.io/v2/${REPO_GHCR}-${img}/manifests/${TAG}" 2>/dev/null; then
    PRIVADAS+=("$img")
  fi
done

PULL_SECRET=""
if [ ${#PRIVADAS[@]} -eq 0 ]; then
  verde "  Todas as ${#IMAGENS[@]} imagens sao publicas em :$TAG"
elif [ -n "$GHCR_USER" ] && [ -n "$GHCR_TOKEN" ]; then
  echo "  Privadas: ${PRIVADAS[*]} — vou criar um imagePullSecret."
  PULL_SECRET="ghcr"
else
  morrer "estas imagens nao sao alcancaveis anonimamente em :$TAG — ${PRIVADAS[*]}

  Sem resolver isso todo pod fica em ImagePullBackOff.

  Opcao A (recomendada, o projeto e Apache-2.0): torne os pacotes publicos em
    https://github.com/orgs/TokenOneBR/packages
    para cada um: Package settings -> Change visibility -> Public

  Opcao B: crie um PAT com escopo read:packages e rode de novo com
    GHCR_USER=seu-usuario GHCR_TOKEN=ghp_... ./deploy/aws/eks-up.sh

  (Se o erro for na tag e nao no acesso: confira se :$TAG existe. O workflow
   publica :main e :sha-<commit>; nao existe :0.1.0.)"
fi

# --- 3. o cluster ---------------------------------------------------------

passo "3/8  Cluster EKS"

if eksctl get cluster --name "$CLUSTER" --region "$REGIAO" >/dev/null 2>&1; then
  echo "  Ja existe. Atualizando o kubeconfig."
  aws eks update-kubeconfig --name "$CLUSTER" --region "$REGIAO" >/dev/null
else
  echo "  Criando. Leva ~15 minutos — e normal parecer travado."
  eksctl create cluster \
    --name "$CLUSTER" \
    --region "$REGIAO" \
    --version "$VERSAO_K8S" \
    --nodegroup-name padrao \
    --node-type "$TIPO_NO" \
    --nodes "$NOS" \
    --managed
fi

kubectl get nodes

# --- 4. os segredos -------------------------------------------------------
#
# Gerados na sua maquina, nunca no repositorio. Reaproveitados entre execucoes:
# rotacionar a chave JWT ou o segredo do KMS por baixo de um banco existente
# invalida as sessoes e torna ILEGIVEL tudo que ja foi cifrado.

passo "4/8  Segredos"

mkdir -p "$SEGREDOS"
chmod 700 "$SEGREDOS"

if [ -f "$SEGREDOS/jwt.key" ]; then
  echo "  Reaproveitando os segredos de $SEGREDOS"
else
  echo "  Gerando em $SEGREDOS"
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$SEGREDOS/jwt.key" 2>/dev/null
  openssl rsa -in "$SEGREDOS/jwt.key" -pubout -out "$SEGREDOS/jwt.pub" 2>/dev/null
  openssl rand -base64 48 > "$SEGREDOS/kms-master"
  openssl rand -base64 48 > "$SEGREDOS/blind-index-pepper"
  openssl rand -base64 18 | tr -d '\n' > "$SEGREDOS/senha-console"
  openssl rand -base64 18 | tr -d '\n' > "$SEGREDOS/senha-postgres"
  chmod 600 "$SEGREDOS"/*
fi

KMS_SECRET="$(cat "$SEGREDOS/kms-master")"
PEPPER="$(cat "$SEGREDOS/blind-index-pepper")"
SENHA_CONSOLE="$(cat "$SEGREDOS/senha-console")"
SENHA_PG="$(cat "$SEGREDOS/senha-postgres")"

# --- 5. namespace e pull secret -------------------------------------------

passo "5/8  Namespace"

kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -

if [ -n "$PULL_SECRET" ]; then
  kubectl create secret docker-registry "$PULL_SECRET" \
    --docker-server=ghcr.io \
    --docker-username="$GHCR_USER" \
    --docker-password="$GHCR_TOKEN" \
    --namespace "$NAMESPACE" \
    --dry-run=client -o yaml | kubectl apply -f -
fi

# --- 6. subcharts ---------------------------------------------------------
#
# Postgres e Redis como subcharts sao adequados para TESTE e inadequados para
# qualquer outra coisa: sem backup, sem PITR, sem failover. Para producao,
# desligue os dois e aponte secrets.databaseUrl/redisUrl para RDS e ElastiCache.

passo "6/8  Dependencias do chart"
helm dependency update "$CHART"

# --- 7. instalar ----------------------------------------------------------

passo "7/8  Instalando o chart"

ARGS=(
  --namespace "$NAMESPACE"
  # Sem isto os recursos nascem `baas-baas-connector-*`: o helper monta
  # "<release>-<nome do chart>". Fixar o nome e o que faz `svc/baas-api` e
  # `job/baas-seed` existirem com esses nomes.
  --set fullnameOverride=baas
  --set image.tag="$TAG"
  --set postgresql.enabled=true
  --set postgresql.auth.username=baas
  --set postgresql.auth.password="$SENHA_PG"
  --set postgresql.auth.database=baas
  --set redis.enabled=true
  --set redis.auth.enabled=false
  --set mockBank.enabled=true
  --set seed.enabled=true
  --set kms.driver=local
  --set secrets.create=true
  --set secrets.databaseUrl="postgresql://baas:$SENHA_PG@baas-postgresql:5432/baas?schema=public"
  --set secrets.redisUrl="redis://baas-redis-master:6379"
  --set-file secrets.jwtPrivateKey="$SEGREDOS/jwt.key"
  --set-file secrets.jwtPublicKey="$SEGREDOS/jwt.pub"
  --set secrets.kmsMasterSecret="$KMS_SECRET"
  --set secrets.blindIndexPepper="$PEPPER"
  --set secrets.seedPassword="$SENHA_CONSOLE"
  --wait --timeout 15m
)
[ -n "$PULL_SECRET" ] && ARGS+=(--set image.pullSecrets[0].name="$PULL_SECRET")

# `upgrade --install` e nao `install`: reexecutar depois de uma falha parcial
# nao deve exigir um `helm uninstall` manual antes.
helm upgrade --install baas "$CHART" "${ARGS[@]}"

# --- 8. as credenciais ----------------------------------------------------

passo "8/8  Credenciais"

echo "  Aguardando o Job de seed..."
kubectl wait --for=condition=complete --timeout=5m \
  -n "$NAMESPACE" job/baas-seed 2>/dev/null || true

echo
kubectl logs -n "$NAMESPACE" job/baas-seed 2>/dev/null \
  || vermelho "  O Job de seed nao terminou. Veja: kubectl describe job -n $NAMESPACE baas-seed"

cat <<FINAL

$(verde "== Pronto ==")

  ACESSO — abra dois terminais, ou rode em background:

    kubectl port-forward -n $NAMESPACE svc/baas-web 3000:3000 &
    kubectl port-forward -n $NAMESPACE svc/baas-api 3001:3001 &

    Console  http://localhost:3000
    API      http://localhost:3001/v1

  ENTRAR no console: o e-mail, a senha, o segredo TOTP e a API key estao no
  log acima. A API key aparece UMA VEZ SO.

  Senha do console tambem em: $SEGREDOS/senha-console

  $(vermelho "AVISO") Esses valores ficam no log do pod. Qualquer pessoa com
  \`kubectl logs\` nesse namespace le o segredo TOTP e a API key. Depois de
  anotar:  kubectl delete job -n $NAMESPACE baas-seed

  $(vermelho "AVISO") O Mock Bank esta ligado e /_control NAO TEM AUTENTICACAO,
  de proposito. Num cluster alcancavel da internet, isso e um endpoint que
  injeta credito em conta de cliente. Este cluster nao tem ingress — so o
  port-forward acima — entao por ora ele nao esta exposto.

  $(vermelho "CUSTO") ~US\$ 6/dia enquanto existir. Para desligar:

    ./deploy/aws/eks-down.sh

FINAL
