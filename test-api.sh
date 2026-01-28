#!/bin/bash

# Script de prueba rápida de API - La Artesa

echo "🧪 PRUEBA DE API - SISTEMA LA ARTESA"
echo "===================================="
echo ""

API_URL="http://localhost:3000/api"

# 1. Login
echo "1️⃣  Haciendo login..."
LOGIN_RESPONSE=$(curl -s -X POST "$API_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Admin123!@#"}')

TOKEN=$(echo $LOGIN_RESPONSE | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "❌ Error al obtener token"
  echo "Response: $LOGIN_RESPONSE"
  exit 1
fi

echo "✅ Login exitoso"
echo "Token: ${TOKEN:0:20}..."
echo ""

# 2. Obtener masas
echo "2️⃣  Obteniendo masas del día..."
MASAS_RESPONSE=$(curl -s -X GET "$API_URL/masas?fecha=2026-01-28" \
  -H "Authorization: Bearer $TOKEN")

echo "Respuesta:"
echo "$MASAS_RESPONSE" | head -20
echo ""

# 3. Obtener progreso de fase de masa 2
echo "3️⃣  Obteniendo progreso de Masa 2..."
FASES_RESPONSE=$(curl -s -X GET "$API_URL/fases/2" \
  -H "Authorization: Bearer $TOKEN")

echo "Respuesta:"
echo "$FASES_RESPONSE" | head -20
echo ""

# 4. Obtener checklist de pesaje de masa 2
echo "4️⃣  Obteniendo checklist de pesaje (Masa 2)..."
CHECKLIST_RESPONSE=$(curl -s -X GET "$API_URL/pesaje/2/checklist" \
  -H "Authorization: Bearer $TOKEN")

echo "Respuesta:"
echo "$CHECKLIST_RESPONSE" | head -30
echo ""

echo "✅ Pruebas completadas"
echo ""
echo "💡 Para continuar con la demo, consulta GUIA_DEMO.md"
