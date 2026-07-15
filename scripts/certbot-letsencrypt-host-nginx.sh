#!/usr/bin/env bash
# Certbot con plugin Nginx en el SISTEMA OPERATIVO (paquete nginx de Debian/Ubuntu).
#
# NO usar tal cual si tu único Nginx es el contenedor de docker-compose.edge*: ahí conviene
# certbot certonly (standalone o webroot) y copiar los PEM a docker/nginx/tls/ — ver docs/docker-edge-stack.md
#
# Requisitos: dominio apuntando a esta máquina, puertos 80/443 libres, Nginx del host ya sirviendo el sitio.

set -euo pipefail

DOMAIN="${DOMAIN:-radioflow.example.com}"
EMAIL="${EMAIL:-admin@radioflow.example.com}"

if [[ "${EUID:-}" -ne 0 ]]; then
  echo "Ejecutá con sudo o como root." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

apt-get update -y
apt-get install -y certbot python3-certbot-nginx

certbot --nginx -d "$DOMAIN" -m "$EMAIL" --agree-tos --redirect --non-interactive

# Renovación diaria (Certbot ya instala a menudo un timer systemd; este cron es redundante pero explícito)
if [[ ! -f /etc/cron.d/certbot-renew ]]; then
  printf '%s\n' "0 3 * * * root certbot renew --quiet --deploy-hook 'systemctl reload nginx'" >/etc/cron.d/certbot-renew
  chmod 0644 /etc/cron.d/certbot-renew
fi

systemctl reload nginx || systemctl restart nginx

echo "Certificado SSL (Let's Encrypt) solicitado y Nginx recargado. Dominio: $DOMAIN"
