# Despliegue

Cada vez que se une algo a `main`, GitHub Actions corre **todas las pruebas** y, solo si pasan, despliega la demo en Cloudflare: migraciones de la base, datos ficticios (si la base está vacía), el Worker y una prueba de humo (`scripts/humo.sh`). En cada PR corren solo las pruebas.

## Lo que ya está creado en Cloudflare (cuenta de BC Informática, 23/10/2026)
- Base D1 `siroconsultas-v2-demo` (su id ya está en `wrangler.jsonc`).
- Archivos R2 `siroconsultas-v2-demo-archivos` y `siroconsultas-v2-demo-respaldos`.

## Lo que falta cargar en GitHub (una sola vez)
En el repo: **Settings → Secrets and variables → Actions → New repository secret**.

| Secreto | Qué es |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Token de Cloudflare con permiso para editar Workers, D1 y R2. Se crea en Cloudflare → My Profile → API Tokens, con la plantilla «Edit Cloudflare Workers» y sumándole D1: Edit. |
| `CLOUDFLARE_ACCOUNT_ID` | El id de tu cuenta de Cloudflare (está en el panel, a la derecha de «Workers & Pages»). |
| `DEMO_SESION_SECRETO` | Un valor al azar de 64 caracteres. |
| `DEMO_TOTP_CLAVE` | Otro valor al azar de 64 caracteres (cifra el segundo código). |
| `DEMO_CLAVE_PRUEBA` | La clave para entrar a la demo con datos ficticios. |

Mientras falten los dos de Cloudflare, el flujo «Desplegar» avisa y no despliega (no queda en rojo).

## Entrar con Google y activar el segundo código
1. En Google Cloud, crear un ID de cliente OAuth (aplicación web) con el origen de la instalación y la dirección de retorno `https://<la instalación>/ingresar/google`. Cargar el id como variable `GOOGLE_CLIENT_ID` en `wrangler.jsonc`.
2. Poner el correo de la profesional en `CORREOS_PERMITIDOS`.
3. BC genera el código de alta con `node scripts/codigo-alta.mjs correo@de-la-profesional.com`, carga la huella con el comando que imprime y le entrega el código **en persona**.
4. La profesional entra con Google, escribe el código de alta, escanea el QR y guarda sus 8 códigos de recuperación.

## Producción (etapa 3)
`MODO_PRUEBA=0` (sin clave de prueba ni muestrario de componentes), dominio propio en vez de `workers.dev`, términos aceptados, simulacro de restauración y un repositorio por cliente que recibe las mejoras del madre por PR automático.
