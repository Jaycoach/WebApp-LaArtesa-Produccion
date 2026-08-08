#!/bin/bash
# =============================================================
# Script de deployment para ARTESA
# Uso staging : bash ~/LaArtesa/deployment/deploy.sh staging
# Uso prod    : bash ~/LaArtesa/deployment/deploy.sh prod
# =============================================================
set -e

AMBIENTE="${1:-staging}"

if [ "$AMBIENTE" = "prod" ]; then
  PM2_NAME="artesa-backend-prod"
  FRONTEND_URL="https://produccion.artesapanaderia.com"
  NGINX_CONF="deployment/nginx/artesa-prod.conf"
  NGINX_ENABLED="/etc/nginx/sites-enabled/artesa-prod"
else
  PM2_NAME="artesa-backend-staging"
  FRONTEND_URL="http://54.196.194.114"
  NGINX_CONF="deployment/nginx/artesa.conf"
  NGINX_ENABLED="/etc/nginx/sites-enabled/artesa"
fi

echo ""
echo "Iniciando deployment ARTESA [$AMBIENTE]..."
echo "============================================"

cd ~/LaArtesa

echo "[1/4] git pull..."
git pull origin main

echo "[2/4] Backend..."
cd ~/LaArtesa/backend
npm install --omit=dev
DEPLOY_VERSION=$(date +%Y%m%d%H%M%S)
sed -i "s/APP_VERSION=.*/APP_VERSION=${DEPLOY_VERSION}/" ~/LaArtesa/backend/.env
pm2 flush $PM2_NAME
if pm2 list | grep -q "$PM2_NAME"; then
  pm2 restart $PM2_NAME --update-env
else
  pm2 start ~/LaArtesa/backend/ecosystem.config.js --only $PM2_NAME
fi
pm2 save
sleep 3
pm2 status

echo "[3/4] Frontend..."
cd ~/LaArtesa/frontend
unset NODE_ENV
echo "VITE_API_URL=$FRONTEND_URL/api" > .env.production
npm install
npx vite build

echo "[4/4] NGINX..."
sudo rm -rf /var/www/artesa-frontend/dist/assets
sudo cp -r dist/* /var/www/artesa-frontend/dist/
sudo chmod 644 /var/www/artesa-frontend/dist/index.html
sudo touch /var/www/artesa-frontend/dist/index.html
sudo cp ~/LaArtesa/$NGINX_CONF $NGINX_ENABLED
sudo nginx -t && sudo nginx -s reload

echo ""
echo "============================================"
echo "Deploy [$AMBIENTE] completado"
echo "URL: $FRONTEND_URL"
echo "============================================"
pm2 logs $PM2_NAME --lines 10 --nostream
