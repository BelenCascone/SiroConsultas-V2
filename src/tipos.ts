import type { Context } from 'hono'

/** Lo que la instalación le da al Worker: base, archivos, variables y secretos. */
export type Bindings = {
  DB: D1Database
  ARCHIVOS: R2Bucket
  RESPALDOS: R2Bucket
  // Variables (wrangler.jsonc)
  MODO_PRUEBA?: string
  MARCA?: string
  MODULOS?: string
  CORREOS_PERMITIDOS?: string
  GOOGLE_CLIENT_ID?: string
  // Secretos (wrangler secret put …)
  SESION_SECRETO: string
  TOTP_CLAVE?: string
  CLAVE_PRUEBA?: string
}

export type Variables = {
  email?: string
  prueba?: boolean
}

export type Env = { Bindings: Bindings; Variables: Variables }
export type C = Context<Env>
