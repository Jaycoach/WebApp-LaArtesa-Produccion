#!/bin/bash
# Uso: ARTESA_DOMAIN="app.laartesa.com" bash ~/LaArtesa/deployment/deploy.sh
set -euo pipefail
DOMAIN="${ARTESA_DOMAIN:-}"
[[ -z "$DOMAIN" ]] && { echo "ERROR: ARTESA_DOMAIN requerido"; exit 1; }
cd ~/LaArtesa
echo "[1/4] git pull..."
git pull origin main
echo "[2/4] backend..."
cd backend && npm install --production --quiet && pm2 reload artesa-backend-prod
echo "[3/4] frontend..."
cd ../frontend
echo "VITE_API_URL=https://$DOMAIN/api" > .env.production
npm install --quiet && npm run build
sudo cp -r dist/* /var/www/artesa-frontend/dist/
echo "[4/4] nginx..."
sudo nginx -t && sudo systemctl reload nginx
echo "✅ Deploy prod completado — https://$DOMAIN"
pm2 list
