// Verificación de tokens de identidad de Google (OpenID Connect, flujo id_token).
// No hay secreto de cliente: la confianza viene de la firma de Google (JWKS) + audiencia + nonce.

const ISSUERS = ['https://accounts.google.com', 'accounts.google.com']
export type JwkSet = { keys: (JsonWebKey & { kid?: string })[] }

let cache: { t: number; jwks: JwkSet } | null = null
export async function jwksDeGoogle(): Promise<JwkSet> {
  if (cache && Date.now() - cache.t < 3600_000) return cache.jwks
  const r = await fetch('https://www.googleapis.com/oauth2/v3/certs')
  if (!r.ok) throw new Error('No se pudieron obtener las claves de Google')
  const jwks = (await r.json()) as JwkSet
  cache = { t: Date.now(), jwks }
  return jwks
}

const b64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0))
const txt = (s: string) => new TextDecoder().decode(b64u(s))

export type Resultado = { ok: true; email: string; sub: string } | { ok: false; motivo: 'firma' | 'claims' | 'no_autorizada' }

export async function verificarTokenGoogle(
  token: string,
  opts: { clientId: string; nonce: string; permitidos: string[]; jwks: JwkSet; ahora?: number }
): Promise<Resultado> {
  try {
    const [h, p, s] = token.split('.')
    if (!h || !p || !s) return { ok: false, motivo: 'firma' }
    const cab = JSON.parse(txt(h))
    if (cab.alg !== 'RS256') return { ok: false, motivo: 'firma' }
    const jwk = opts.jwks.keys.find((k) => k.kid === cab.kid)
    if (!jwk) return { ok: false, motivo: 'firma' }
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
    const firmaOk = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64u(s), new TextEncoder().encode(`${h}.${p}`))
    if (!firmaOk) return { ok: false, motivo: 'firma' }
    const c = JSON.parse(txt(p))
    const ahora = Math.floor((opts.ahora ?? Date.now()) / 1000)
    if (!ISSUERS.includes(c.iss) || c.aud !== opts.clientId || typeof c.exp !== 'number' || c.exp < ahora || c.nonce !== opts.nonce) return { ok: false, motivo: 'claims' }
    if (c.email_verified !== true || typeof c.email !== 'string') return { ok: false, motivo: 'claims' }
    const email = c.email.trim().toLowerCase()
    if (!opts.permitidos.includes(email)) return { ok: false, motivo: 'no_autorizada' }
    if (typeof c.sub !== 'string' || !c.sub) return { ok: false, motivo: 'claims' }
    return { ok: true, email, sub: c.sub }
  } catch {
    return { ok: false, motivo: 'firma' }
  }
}
