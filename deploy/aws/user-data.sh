#!/usr/bin/env bash
#
# user-data de uma EC2 Amazon Linux 2023: sobe o BaaS Connector no boot.
#
# Cole no campo "User data" ao lancar a instancia, ou passe com
# `--user-data file://deploy/aws/user-data.sh`. Roda como root, uma vez.
#
# Ajuste as duas linhas abaixo antes de usar. O resto e automatico.
set -euo pipefail

# --- ajuste aqui ----------------------------------------------------------

# Dominio que aponta para o IP desta instancia. Com ele o Caddy emite
# certificado Let's Encrypt sozinho.
#
# Vazio serve HTTP puro — e ai a credencial do provedor que voce digitar no
# console viaja EM CLARO pela internet. Para o Mock Bank tudo bem; antes de
# cadastrar uma chave real da Woovi, aponte um dominio.
DOMINIO="${DOMINIO:-}"

REPO="https://github.com/TokenOneBR/BaaS-Connector.git"
BRANCH="main"

# --------------------------------------------------------------------------

exec > >(tee /var/log/baas-bootstrap.log | logger -t baas -s 2>/dev/console) 2>&1
echo "== bootstrap do BaaS Connector =="

dnf update -y
dnf install -y docker git

systemctl enable --now docker

# Compose v2 como plugin do docker, no caminho que o `docker compose` procura.
ARQ="$(uname -m)"
mkdir -p /usr/local/lib/docker/cli-plugins
curl -fsSL "https://github.com/docker/compose/releases/download/v2.32.1/docker-compose-linux-${ARQ}" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

usermod -aG docker ec2-user || true

install -d -o ec2-user -g ec2-user /opt/baas
sudo -u ec2-user git clone --depth 1 --branch "$BRANCH" "$REPO" /opt/baas/app
cd /opt/baas/app

# --- segredos -------------------------------------------------------------
#
# Gerados NA INSTANCIA, nunca commitados. O par RSA assina a sessao do
# console; a chave mestra do KMS local envolve as credenciais de provedor, que
# ficam cifradas no Postgres.
#
# `KMS_DRIVER=local` guarda a chave mestra numa variavel de ambiente. Serve
# para TESTE. Em producao de verdade use `aws-kms` com uma role de instancia.

if [ ! -f .env ]; then
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out /tmp/jwt.key 2>/dev/null
  openssl rsa -in /tmp/jwt.key -pubout -out /tmp/jwt.pub 2>/dev/null

  IP_PUBLICO="$(curl -fsS -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' \
      -X PUT http://169.254.169.254/latest/api/token 2>/dev/null \
    | xargs -I{} curl -fsS -H 'X-aws-ec2-metadata-token: {}' \
      http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || echo localhost)"

  if [ -n "$DOMINIO" ]; then
    PUBLIC_URL="https://${DOMINIO}"
    SITE_ADDRESS="$DOMINIO"
  else
    PUBLIC_URL="http://${IP_PUBLICO}"
    SITE_ADDRESS=":80"
  fi

  {
    echo "PUBLIC_URL=${PUBLIC_URL}"
    echo "SITE_ADDRESS=${SITE_ADDRESS}"
    echo "KMS_MASTER_SECRET=$(openssl rand -hex 32)"
    echo "BLIND_INDEX_PEPPER=$(openssl rand -hex 32)"
    printf 'JWT_PRIVATE_KEY="%s"\n' "$(awk '{printf "%s\\n", $0}' /tmp/jwt.key)"
    printf 'JWT_PUBLIC_KEY="%s"\n' "$(awk '{printf "%s\\n", $0}' /tmp/jwt.pub)"
  } > .env

  chown ec2-user:ec2-user .env
  chmod 600 .env
  shred -u /tmp/jwt.key /tmp/jwt.pub
fi

# --- sobe -----------------------------------------------------------------
#
# `--wait` respeita os healthchecks: o comando so volta quando a API responde
# `/readyz`. O `seed` roda depois do `migrate` e cria o primeiro usuario do
# console, a conexao do Mock Bank e uma API key.

docker compose -f compose.yaml -f compose.aws.yaml up -d --wait

echo
echo "=================================================================="
docker compose logs seed --no-log-prefix 2>/dev/null | tail -30
echo "=================================================================="
echo
echo "Credenciais tambem em: docker compose -f compose.yaml -f compose.aws.yaml logs seed"
echo "Log completo deste bootstrap: /var/log/baas-bootstrap.log"
