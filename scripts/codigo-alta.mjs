// Genera el código de alta del segundo factor para una profesional. Lo usa BC Informática en la puesta en marcha.
// Imprime el código (se entrega EN PERSONA, nunca por mensaje) y el SQL para cargar solo su huella en la base.
// Uso: node scripts/codigo-alta.mjs correo@de-la-profesional.com [días de validez, 7 por defecto]
import { webcrypto as crypto } from 'node:crypto'

const email = (process.argv[2] ?? '').trim().toLowerCase()
const dias = Number(process.argv[3] ?? 7)
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !(dias > 0 && dias <= 30)) {
  console.error('Uso: node scripts/codigo-alta.mjs correo@ejemplo.com [días 1-30]')
  process.exit(1)
}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const crudo = [...crypto.getRandomValues(new Uint8Array(12))].map((x) => B32[x & 31]).join('')
const codigo = crudo.match(/.{1,4}/g).join('-')
// Misma huella que src/lib/totp.ts: SHA-256 de 'sc-2fa:' + el código normalizado.
const datos = new TextEncoder().encode('sc-2fa:' + crudo)
const huella = Buffer.from(await crypto.subtle.digest('SHA-256', datos)).toString('hex')
const vence = new Date(Date.now() + dias * 86_400_000).toISOString().replace(/\.\d{3}Z$/, 'Z')

console.log(`\nCódigo de alta para ${email} (vence en ${dias} días):\n\n    ${codigo}\n`)
console.log('Cargalo en la base de la instalación con:\n')
console.log(`npx wrangler d1 execute DB --remote --command "INSERT INTO codigos_alta (huella, email, vence_en) VALUES ('${huella}', '${email}', '${vence}')"\n`)
