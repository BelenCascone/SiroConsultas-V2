// Sesiones: el token va solo en la cookie; en la base queda su huella. Se cierran solas a las 12 horas.
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import type { Context } from 'hono'
import type { Env } from '../tipos'
import { firmar, verificar, sha256, tokenAleatorio, huellaIp } from './firma'
import { ahoraISO } from './fechas'

export const COOKIE_SESION = '__Host-sc'
export const COOKIE_PRE = '__Host-sc-pre'
const HORAS_SESION = 12
const MIN_PRE = 10

type Ctx = Context<Env>
const opcionesCookie = (maxAge: number) => ({ httpOnly: true, secure: true, sameSite: 'Lax' as const, path: '/', maxAge })
const ip = (c: Ctx) => c.req.header('cf-connecting-ip') ?? null

export async function registrar(c: Ctx, evento: string, detalle: string | null = null, usuario: string | null = null) {
  await c.env.DB.prepare('INSERT INTO auditoria (evento, detalle, usuario, ip_huella) VALUES (?, ?, ?, ?)')
    .bind(evento, detalle, usuario, await huellaIp(ip(c), c.env.SESION_SECRETO)).run()
}

/** Primer paso cumplido (Google): queda una cookie corta hasta pasar el segundo código. */
export async function iniciarPreSesion(c: Ctx, email: string) {
  const vence = Date.now() + MIN_PRE * 60_000
  setCookie(c, COOKIE_PRE, await firmar(`${vence}|${email}`, c.env.SESION_SECRETO), opcionesCookie(MIN_PRE * 60))
}

export async function leerPreSesion(c: Ctx): Promise<string | null> {
  const crudo = getCookie(c, COOKIE_PRE)
  const valor = crudo ? await verificar(crudo, c.env.SESION_SECRETO) : null
  if (!valor) return null
  const [vence, ...resto] = valor.split('|')
  return Number(vence) >= Date.now() && resto.length ? resto.join('|') : null
}

export async function abrirSesion(c: Ctx, email: string) {
  const token = tokenAleatorio()
  const vence = ahoraISO(Date.now() + HORAS_SESION * 3600_000)
  await c.env.DB.prepare('INSERT INTO sesiones (id, email, vence_en, ip_huella) VALUES (?, ?, ?, ?)')
    .bind(await sha256(token), email, vence, await huellaIp(ip(c), c.env.SESION_SECRETO)).run()
  deleteCookie(c, COOKIE_PRE, { path: '/', secure: true })
  setCookie(c, COOKIE_SESION, token, opcionesCookie(HORAS_SESION * 3600))
  await registrar(c, 'ingreso', null, email)
}

/** Email de la sesión vigente, o null. */
export async function leerSesion(c: Ctx): Promise<string | null> {
  const token = getCookie(c, COOKIE_SESION)
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null
  const fila = await c.env.DB.prepare('SELECT email FROM sesiones WHERE id = ? AND cerrada_en IS NULL AND vence_en > ?')
    .bind(await sha256(token), ahoraISO()).first<{ email: string }>()
  return fila?.email ?? null
}

export async function cerrarSesion(c: Ctx) {
  const token = getCookie(c, COOKIE_SESION)
  if (token && /^[0-9a-f]{64}$/.test(token)) {
    await c.env.DB.prepare('UPDATE sesiones SET cerrada_en = ? WHERE id = ? AND cerrada_en IS NULL').bind(ahoraISO(), await sha256(token)).run()
  }
  deleteCookie(c, COOKIE_SESION, { path: '/', secure: true })
  deleteCookie(c, COOKIE_PRE, { path: '/', secure: true })
}

/** Frena abusos: cuenta intentos por clave en una ventana de N minutos. Devuelve true si se pasó del límite. */
export async function excedido(c: Ctx, clave: string, limite: number, minutos: number) {
  const ventana = String(Math.floor(Date.now() / (minutos * 60_000)))
  const fila = await c.env.DB.prepare(
    'INSERT INTO intentos (clave, ventana, cuenta) VALUES (?, ?, 1) ON CONFLICT (clave, ventana) DO UPDATE SET cuenta = cuenta + 1 RETURNING cuenta'
  ).bind(clave, ventana).first<{ cuenta: number }>()
  return (fila?.cuenta ?? 0) > limite
}

export const huellaDeIp = (c: Ctx) => huellaIp(ip(c), c.env.SESION_SECRETO)
