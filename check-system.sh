#!/bin/bash

# Script para verificar el estado del sistema antes de la demo

echo "🔍 VERIFICACIÓN DEL SISTEMA - LA ARTESA"
echo "========================================"
echo ""

# Colores
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 1. Verificar si el backend está corriendo
echo "1️⃣  Verificando Backend..."
if curl -s http://localhost:3000/api > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Backend está corriendo en puerto 3000${NC}"
else
    echo -e "${RED}❌ Backend NO está corriendo${NC}"
    echo "   👉 Ejecuta: cd backend && npm run dev"
fi
echo ""

# 2. Verificar PostgreSQL
echo "2️⃣  Verificando Base de Datos..."
cd backend
if node -e "const {Pool}=require('pg');const c=require('./src/config');new Pool({host:c.database.host,port:c.database.port,database:c.database.name,user:c.database.user,password:c.database.password}).query('SELECT 1').then(()=>{console.log('OK');process.exit(0)}).catch(e=>{console.error('ERROR:',e.message);process.exit(1)})" 2>&1 | grep -q "OK"; then
    echo -e "${GREEN}✅ PostgreSQL conectado correctamente${NC}"
else
    echo -e "${RED}❌ No se puede conectar a PostgreSQL${NC}"
    echo "   👉 Verifica que PostgreSQL esté corriendo"
fi
cd ..
echo ""

# 3. Verificar datos de demo
echo "3️⃣  Verificando Datos de Demo..."
cd backend
MASA_COUNT=$(node -e "const {Pool}=require('pg');const c=require('./src/config');new Pool({host:c.database.host,port:c.database.port,database:c.database.name,user:c.database.user,password:c.database.password}).query('SELECT COUNT(*) FROM masas_produccion').then(r=>{console.log(r.rows[0].count);process.exit(0)}).catch(e=>{console.log('0');process.exit(1)})" 2>/dev/null)

if [ "$MASA_COUNT" -gt "0" ]; then
    echo -e "${GREEN}✅ Hay $MASA_COUNT masas disponibles${NC}"
else
    echo -e "${YELLOW}⚠️  No hay masas en la base de datos${NC}"
    echo "   👉 Ejecuta: node load-demo-data.js"
fi
cd ..
echo ""

# 4. Verificar frontend
echo "4️⃣  Verificando Frontend..."
if [ -d "frontend/node_modules" ]; then
    echo -e "${GREEN}✅ Dependencias del frontend instaladas${NC}"
else
    echo -e "${YELLOW}⚠️  Faltan dependencias del frontend${NC}"
    echo "   👉 Ejecuta: cd frontend && npm install"
fi
echo ""

# 5. Verificar archivos clave
echo "5️⃣  Verificando Archivos de Configuración..."
if [ -f "backend/.env" ]; then
    echo -e "${GREEN}✅ backend/.env existe${NC}"
else
    echo -e "${RED}❌ backend/.env no encontrado${NC}"
fi

if [ -f "frontend/.env" ]; then
    echo -e "${GREEN}✅ frontend/.env existe${NC}"
else
    echo -e "${YELLOW}⚠️  frontend/.env no encontrado (opcional)${NC}"
fi
echo ""

# 6. Resumen
echo "========================================"
echo "📊 RESUMEN"
echo "========================================"
echo ""
echo "Credenciales:"
echo "  Usuario: admin"
echo "  Password: Admin123!@#"
echo ""
echo "URLs:"
echo "  Backend:  http://localhost:3000"
echo "  Frontend: http://localhost:5173"
echo ""
echo "Documentación:"
echo "  📖 README_DEMO.md  - Inicio rápido"
echo "  📋 GUIA_DEMO.md    - Guía paso a paso"
echo "  🧪 test-api.sh     - Prueba de API"
echo ""
echo "💡 Tip: Ejecuta 'bash test-api.sh' para probar la API"
echo ""
echo "✨ Sistema verificado"
