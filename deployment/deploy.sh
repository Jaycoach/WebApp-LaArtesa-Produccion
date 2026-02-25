#!/bin/bash
# =============================================================
# Script de deployment para ARTESA Staging
# Uso: bash ~/LaArtesa/deployment/deploy.sh
# =============================================================

set -e

echo ""
echo "🚀 Iniciando deployment ARTESA Staging..."
echo "============================================"

cd ~/LaArtesa

# 1. Pull últimos cambios
echo ""
echo "📥 [1/4] Pulling cambios de Git..."
git pull origin main

# 2. Backend - instalar dependencias y reiniciar
echo ""
echo "⚙️  [2/4] Actualizando backend..."
cd ~/LaArtesa/backend
npm install --production
pm2 restart artesa-backend-staging
sleep 2
pm2 status

# 3. Frontend - asegurar .env.production y buildear
echo ""
echo "🎨 [3/4] Buildeando frontend..."
cd ~/LaArtesa/frontend
# IMPORTANTE: .env.production no está en Git (seguridad)
# Se regenera en cada deploy con la IP del servidor
echo "VITE_API_URL=http://54.196.194.114/api" > .env.production
npm install
npx vite build

# 4. Copiar build a nginx y recargar
echo ""
echo "📦 [4/4] Desplegando frontend a nginx..."
sudo cp -r dist/* /var/www/artesa-frontend/dist/
sudo nginx -s reload

echo ""
echo "============================================"
echo "✅ Deployment completado exitosamente"
echo "🌐 URL: http://54.196.194.114"
echo "============================================"
echo ""
pm2 logs artesa-backend-staging --lines 10 --nostream