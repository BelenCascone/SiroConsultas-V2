// Firmas HMAC para cookies cortas y huellas que no guardan el dato original (IP, tokens).
const enc = new TextEncoder()

/** Largo mínimo del secreto de firma. Sin secreto (o con uno corto) no se firma ni se verifica nada: falla cerrado. */
export const SECRETO_MIN = 32

const clave = async (secreto: string) => {
  if (!secreto || secreto.length < SECRETO_MIN) throw new Error(`SESION_SECRETO ausente o menor a ${SECRETO_MIN} caracteres`)
  return crypto.subtle.importKey('raw', enc.encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
}
export const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')

async function hmac(valor: string, secreto: string) {
  return hex(await crypto.subtle.sign('HMAC', await clave(secreto), enc.encode(valor)))
}

/** Comparación en tiempo constante. */
export function iguales(a: string, b: string) {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

export async function firmar(valor: string, secreto: string) {
  return `${valor}.${await hmac(valor, secreto)}`
}

export async function verificar(token: string, secreto: string): Promise<string | null> {
  const i = token.lastIndexOf('.')
  if (i < 0) return null
  const valor = token.slice(0, i)
  return iguales(token.slice(i + 1), await hmac(valor, secreto)) ? valor : null
}

/** Huella de una IP para contar intentos sin guardarla. */
export async function huellaIp(ip: string | null | undefined, secreto: string) {
  return (await hmac('ip:' + (ip || 'sin-ip'), secreto)).slice(0, 32)
}

export async function sha256(texto: string) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(texto)))
}

export function tokenAleatorio(bytes = 32) {
  return hex(crypto.getRandomValues(new Uint8Array(bytes)))
}
