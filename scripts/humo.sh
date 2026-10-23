#!/usr/bin/env bash
# Prueba de humo después de desplegar: la app responde, pide ingreso y conserva las cabeceras de seguridad.
# Uso: bash scripts/humo.sh https://siroconsultas-v2.<cuenta>.workers.dev
set -euo pipefail
URL="${1:?Falta la dirección}"

for i in 1 2 3 4 5 6; do
  curl -fsS "$URL/salud" | grep -q '"ok":true' && break
  echo "Esperando que responda ($i)…"; sleep 5
done
curl -fsS "$URL/salud" | grep -q '"ok":true' || { echo "La app no responde en /salud"; exit 1; }

codigo=$(curl -s -o /dev/null -w '%{http_code}' "$URL/")
[ "$codigo" = "302" ] || { echo "Sin sesión, / debería llevar al ingreso (dio $codigo)"; exit 1; }

cabeceras=$(curl -sSI "$URL/ingresar")
for c in 'content-security-policy' 'strict-transport-security' 'x-content-type-options'; do
  echo "$cabeceras" | grep -qi "^$c:" || { echo "Falta la cabecera $c"; exit 1; }
done
echo "$cabeceras" | grep -i '^content-security-policy:' | grep -q 'unsafe-inline' && { echo "La CSP no debe permitir unsafe-inline"; exit 1; }

echo "Prueba de humo OK: $URL"
