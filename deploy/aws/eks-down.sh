#!/usr/bin/env bash
#
# Desliga tudo que o eks-up.sh criou.
#
#   ./deploy/aws/eks-down.sh
#
# Enquanto o cluster existe, ele cobra — ~US$ 6/dia em sa-east-1. Este script nao e
# opcional no fim de um teste.
#
# Ele NAO apaga os segredos em ~/.baas-connector: sao arquivos locais que nao
# custam nada e que voce precisa se for subir de novo com o mesmo banco.
set -euo pipefail

REGIAO="${REGIAO:-sa-east-1}"
CLUSTER="${CLUSTER:-baas-teste}"
NAMESPACE="${NAMESPACE:-baas}"
CONFIRMAR="${CONFIRMAR:-}"

vermelho() { printf '\033[31m%s\033[0m\n' "$*"; }
verde()    { printf '\033[32m%s\033[0m\n' "$*"; }
passo()    { printf '\n\033[1m== %s\033[0m\n' "$*"; }

command -v eksctl >/dev/null 2>&1 || { vermelho "ERRO: eksctl nao encontrado."; exit 1; }

if ! eksctl get cluster --name "$CLUSTER" --region "$REGIAO" >/dev/null 2>&1; then
  verde "Cluster $CLUSTER nao existe em $REGIAO. Nada a fazer."
  exit 0
fi

cat <<AVISO

  Vou APAGAR o cluster EKS "$CLUSTER" em $REGIAO, e com ele:

    - todos os pods, services e load balancers
    - o banco Postgres do subchart e TODOS OS DADOS nele
    - os volumes EBS do release

  Isso e irreversivel. Nao ha snapshot.

AVISO

if [ -z "$CONFIRMAR" ]; then
  read -r -p "  Digite 'apagar' para confirmar: " CONFIRMAR
fi
[ "$CONFIRMAR" = "apagar" ] || { echo "  Cancelado. Nada foi apagado."; exit 0; }

# Desinstalar o release ANTES de apagar o cluster: e o que da chance ao
# controlador de service do AWS remover o load balancer. Apagar o cluster com
# um Service LoadBalancer de pe deixa o NLB orfao — cobrando, e invisivel no
# console do EKS porque o cluster nao existe mais.
passo "1/3  Desinstalando os releases"
if command -v helm >/dev/null 2>&1; then
  helm uninstall baas -n "$NAMESPACE" 2>/dev/null || echo "  (release 'baas' ja nao existia)"
  helm uninstall ingress-nginx -n ingress-nginx 2>/dev/null || true
  echo "  Aguardando os load balancers sumirem..."
  sleep 30
fi

passo "2/3  Apagando o cluster (leva ~10 minutos)"
eksctl delete cluster --name "$CLUSTER" --region "$REGIAO" --wait

# Os PVCs dos subcharts podem sobreviver ao uninstall, e um EBS "available"
# continua cobrando. E o custo esquecido mais comum depois de um teste.
passo "3/3  Volumes EBS que sobraram"
ORFAOS="$(aws ec2 describe-volumes --region "$REGIAO" \
  --filters Name=status,Values=available \
  --query 'Volumes[].[VolumeId,Size,Tags[?Key==`kubernetes.io/cluster/'"$CLUSTER"'`].Value|[0]]' \
  --output text 2>/dev/null | grep -v '^$' || true)"

if [ -z "$ORFAOS" ]; then
  verde "  Nenhum volume disponivel sobrou."
else
  vermelho "  Estes volumes EBS ficaram e CONTINUAM COBRANDO:"
  echo "$ORFAOS" | sed 's/^/    /'
  echo
  echo "  Confira se sao mesmo deste teste e apague com:"
  echo "$ORFAOS" | awk '{print "    aws ec2 delete-volume --region '"$REGIAO"' --volume-id " $1}'
  echo
  echo "  (Nao apago automaticamente: um volume 'available' pode ser de outra"
  echo "   coisa sua, e apagar EBS por engano nao tem volta.)"
fi

echo
verde "== Cluster removido =="
echo "  Os segredos continuam em ~/.baas-connector — apague voce se nao for reusar."
