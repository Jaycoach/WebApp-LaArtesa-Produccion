#!/bin/bash
# ============================================================
# Aplica la configuración de NGINX desde el repositorio
# Uso: bash ~/LaArtesa/deployment/scripts/apply-nginx.sh
# ============================================================

set -e

REPO_DIR="$HOME/LaArtesa"
NGINX_CONF="$REPO_DIR/deployment/nginx/artesa.conf"
CERT="/etc/ssl/certs/artesa-selfsigned.crt"
KEY="/etc/ssl/private/artesa-selfsigned.key"

echo "=== Aplicando configuración NGINX de ARTESA ==="

# 1. Generar certificado self-signed si no existe
if [ ! -f "$CERT" ]; then
  echo "→ Generando certificado self-signed..."
  sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout "$KEY" \
    -out "$CERT" \
    -subj "/C=CO/ST=Bogota/L=Bogota/O=LaArtesa/CN=54.196.194.114"
  echo "✓ Certificado generado"
else
  echo "→ Certificado ya existe, omitiendo generación"
fi

# 2. Copiar config al directorio de NGINX
echo "→ Copiando artesa.conf a /etc/nginx/sites-available/..."
sudo cp "$NGINX_CONF" /etc/nginx/sites-available/artesa

# 3. Activar site y desactivar default
sudo ln -sf /etc/nginx/sites-available/artesa /etc/nginx/sites-enabled/artesa
sudo rm -f /etc/nginx/sites-enabled/default

# 4. Validar configuración
echo "→ Validando configuración NGINX..."
sudo nginx -t

# 5. Recargar NGINX
echo "→ Recargando NGINX..."
sudo systemctl reload nginx

echo ""
echo "✅ NGINX actualizado correctamente"
echo "   HTTP  → https://54.196.194.114 (redirect automático)"
echo "   HTTPS → https://54.196.194.114"
echo ""
echo "   NOTA: El navegador mostrará advertencia por self-signed."
echo "   Cuando tengas DNS: sudo certbot --nginx -d tudominio.com"
