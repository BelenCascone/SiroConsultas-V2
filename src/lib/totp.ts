// Segundo factor: TOTP (RFC 6238, HMAC-SHA1, 30 s, 6 dígitos). Sin dependencias.
const enc = new TextEncoder()
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
type Bytes = Uint8Array<ArrayBuffer>
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b))
const deB64 = (s: string): Bytes => Uint8Array.from(atob(s), (x) => x.charCodeAt(0))
const hexDe = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')

export function base32(b: Uint8Array): string {
  let bits = 0, v = 0, o = ''
  for (const x of b) { v = (v << 8) | x; bits += 8; while (bits >= 5) { o += B32[(v >>> (bits - 5)) & 31]; bits -= 5 } }
  if (bits > 0) o += B32[(v << (5 - bits)) & 31]
  return o
}
export function deBase32(s: string): Bytes {
  let bits = 0, v = 0
  const o: number[] = []
  for (const ch of s.replace(/[\s=-]/g, '').toUpperCase()) {
    const i = B32.indexOf(ch)
    if (i < 0) throw new Error('base32')
    v = (v << 5) | i; bits += 5
    if (bits >= 8) { o.push((v >>> (bits - 8)) & 255); bits -= 8 }
  }
  return Uint8Array.from(o)
}

export async function codigoTotp(secreto: Bytes, paso: number, digitos = 6): Promise<string> {
  const msg = new Uint8Array(8)
  new DataView(msg.buffer).setUint32(4, paso >>> 0)
  new DataView(msg.buffer).setUint32(0, Math.floor(paso / 2 ** 32))
  const k = await crypto.subtle.importKey('raw', secreto, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', k, msg))
  const o = h[19] & 15
  const n = (((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 10 ** digitos
  return String(n).padStart(digitos, '0')
}

/** Devuelve el paso que coincide (ventana ±1) y es posterior al último usado, o null. */
export async function verificarTotp(secreto: Bytes, codigo: string, ahoraMs: number, ultimoPaso: number): Promise<number | null> {
  if (!/^\d{6}$/.test(codigo)) return null
  const actual = Math.floor(ahoraMs / 30_000)
  let hallado: number | null = null
  for (const d of [-1, 0, 1]) { // se recorren los tres siempre (tiempo constante)
    const p = actual + d
    const ok = (await codigoTotp(secreto, p)) === codigo
    if (ok && p > ultimoPaso && hallado === null) hallado = p
  }
  return hallado
}

export const nuevoSecreto = (): Bytes => crypto.getRandomValues(new Uint8Array(20))
export const uriOtpauth = (email: string, secreto: Uint8Array) =>
  `otpauth://totp/${encodeURIComponent('SiroConsultas')}:${encodeURIComponent(email)}?secret=${base32(secreto)}&issuer=${encodeURIComponent('SiroConsultas')}&algorithm=SHA1&digits=6&period=30`

// El secreto se guarda cifrado (AES-256-GCM) con una clave derivada de TOTP_KEY, que vive solo como secreto del Worker.
const claveAes = async (k: string) => crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', enc.encode(k)), 'AES-GCM', false, ['encrypt', 'decrypt'])
export async function cifrarSecreto(secreto: Bytes, totpKey: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await claveAes(totpKey), secreto))
  return b64(iv) + '.' + b64(ct)
}
export async function descifrarSecreto(guardado: string, totpKey: string): Promise<Bytes> {
  const [iv, ct] = guardado.split('.')
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deB64(iv) }, await claveAes(totpKey), deB64(ct)))
}

// Códigos de alta y de recuperación: aleatorios de alta entropía; en la base solo queda su huella.
export const normalizarCodigo = (s: string) => s.toUpperCase().replace(/[^A-Z2-7]/g, '')
export async function huella(codigo: string): Promise<string> {
  return hexDe(await crypto.subtle.digest('SHA-256', enc.encode('sc-2fa:' + normalizarCodigo(codigo))))
}
export function codigoAleatorio(largo: number): string {
  const b = crypto.getRandomValues(new Uint8Array(largo))
  const s = [...b].map((x) => B32[x & 31]).join('')
  return s.match(/.{1,4}/g)!.join('-')
}
