// La app real contra una base SQLite en memoria (con el adaptador de D1) y un navegador mínimo que guarda cookies.
import app from '../../src/index'
import type { Bindings } from '../../src/tipos'
import { baseNueva, d1 } from '../base/base'
import { firmar } from '../../src/lib/firma'

export const SECRETO = 's'.repeat(40)
export const TOTP_CLAVE = 't'.repeat(40)
export const CLAVE_PRUEBA = 'demo-clave-1234'
export const EMAIL = 'demo@siroconsultas.test'
export const ORIGEN = 'http://localhost'

export function entorno(cambios: Partial<Bindings> = {}) {
  const db = baseNueva({ conDatos: true })
  // Los feriados cargados por la migración dependen del día en que se corre la prueba: cada prueba pone los suyos.
  db.exec('DELETE FROM feriados')
  const env: Bindings = {
    DB: d1(db), ARCHIVOS: {} as R2Bucket, RESPALDOS: {} as R2Bucket,
    MODO_PRUEBA: '1', MARCA: 'Demo', MODULOS: 'agenda,documentos,cobros,estadisticas', CORREOS_PERMITIDOS: EMAIL,
    SESION_SECRETO: SECRETO, TOTP_CLAVE, CLAVE_PRUEBA, ...cambios,
  }
  return { db, env, navegador: navegador(env) }
}

export function navegador(env: Bindings) {
  const cookies = new Map<string, string>()
  const pedir = async (ruta: string, init: RequestInit & { form?: Record<string, string> } = {}) => {
    const headers = new Headers(init.headers)
    if (cookies.size) headers.set('Cookie', [...cookies].map(([k, v]) => `${k}=${v}`).join('; '))
    let body = init.body
    if (init.form) {
      body = new URLSearchParams(init.form).toString()
      headers.set('Content-Type', 'application/x-www-form-urlencoded')
      if (!headers.has('Origin')) headers.set('Origin', ORIGEN)
    }
    const res = await app.request(ORIGEN + ruta, { ...init, method: init.form ? 'POST' : init.method ?? 'GET', headers, body }, env)
    for (const c of res.headers.getSetCookie()) {
      const [par, ...atributos] = c.split(';')
      const i = par.indexOf('=')
      const nombre = par.slice(0, i), valor = par.slice(i + 1)
      const borra = !valor || atributos.some((a) => /max-age=0\b/i.test(a.trim()))
      if (borra) cookies.delete(nombre); else cookies.set(nombre, valor)
    }
    return res
  }
  return { pedir, cookies }
}

/** Primer paso cumplido (como si Google hubiera respondido bien): la cookie corta de pre-sesión. */
export async function preSesion(nav: ReturnType<typeof navegador>, email = EMAIL) {
  nav.cookies.set('__Host-sc-pre', await firmar(`${Date.now() + 600_000}|${email}`, SECRETO))
}
