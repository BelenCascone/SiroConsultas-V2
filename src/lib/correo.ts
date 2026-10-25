// P5 · Correo saliente de la instalación: SMTP directo con los sockets de Workers, sin dependencias.
// Los datos del servidor van como secretos (SMTP_HOST, SMTP_PUERTO, SMTP_USUARIO, SMTP_CLAVE, SMTP_REMITENTE).
// En la demo sin servidor configurado no sale nada: se simula el envío.
import type { Bindings } from '../tipos'

export type Adjunto = { nombre: string; tipo: string; datos: Uint8Array }
export type Correo = { para: string; copia?: string | null; responderA?: string | null; asunto: string; texto: string; adjuntos?: Adjunto[] }
export type CorreoArmado = Correo & { de: string; nombreDe: string }
export type Transporte = (m: CorreoArmado) => Promise<void>
export type Modo = 'smtp' | 'demo'

export class ErrorCorreo extends Error {}

export const esCorreo = (s: string | null | undefined): s is string =>
  !!s && s.length <= 200 && /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/.test(s)

// Las pruebas cambian el transporte para ver lo que saldría sin conectarse a nada.
let transportePrueba: Transporte | null = null
export function usarTransporte(t: Transporte | null) { transportePrueba = t }

/** Cómo sale el correo en esta instalación, o null si todavía no está configurado. */
export function modoCorreo(env: Bindings): Modo | null {
  if (transportePrueba) return 'smtp'
  if (env.SMTP_HOST && env.SMTP_USUARIO && env.SMTP_CLAVE) return 'smtp'
  return env.MODO_PRUEBA === '1' ? 'demo' : null
}

export const SIN_CORREO = 'El correo saliente todavía no está configurado en tu instalación. Lo configura BC Informática.'

/** Manda un correo. Si falla, lanza ErrorCorreo con un texto para mostrar; el detalle técnico queda en el registro. */
export async function mandarCorreo(env: Bindings, m: Correo, nombreDe: string): Promise<Modo> {
  const modo = modoCorreo(env)
  if (!modo) throw new ErrorCorreo(SIN_CORREO)
  for (const d of [m.para, m.copia, m.responderA]) if (d != null && !esCorreo(d)) throw new ErrorCorreo('Revisá el correo del destinatario.')
  const de = direccion(env.SMTP_REMITENTE || env.SMTP_USUARIO || 'demo@siroconsultas.test')
  const armado: CorreoArmado = { ...m, de, nombreDe: nombreDe.replace(/[\r\n]/g, ' ').trim() || 'SiroConsultas' }
  if (modo === 'demo') {
    console.log(`[demo] correo a ${m.para}${m.copia ? ` (copia a ${m.copia})` : ''}: ${m.asunto}`)
    return modo
  }
  try {
    await (transportePrueba ?? ((x: CorreoArmado) => smtp(env, x)))(armado)
  } catch (e) {
    console.error('Falló el envío de correo', e)
    throw new ErrorCorreo('No pudimos mandar el correo. Probá de nuevo en un rato; si se repite, avisale a BC Informática.')
  }
  return modo
}

const direccion = (s: string) => (s.match(/<([^>]+)>/)?.[1] ?? s).trim()

// ---------- Mensaje (MIME) ----------
export function base64(b: Uint8Array) {
  let s = ''
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return btoa(s)
}
const enLineas = (s: string) => s.replace(/.{1,76}/g, '$&\r\n')
const utf8 = (s: string) => new TextEncoder().encode(s)
const encabezado = (s: string) => /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${base64(utf8(s))}?=`
const nombreArchivo = (s: string) => s.replace(/["\\\r\n]/g, '_')

export function armarMensaje(m: CorreoArmado, ahora = new Date(), id: string = crypto.randomUUID()) {
  const limite = `sc-${id}`
  const dominio = m.de.split('@')[1] ?? 'siroconsultas'
  const cabeza = [
    `From: ${encabezado(m.nombreDe)} <${m.de}>`,
    `To: ${m.para}`,
    ...(m.copia ? [`Cc: ${m.copia}`] : []),
    ...(m.responderA ? [`Reply-To: ${m.responderA}`] : []),
    `Subject: ${encabezado(m.asunto.replace(/[\r\n]+/g, ' '))}`,
    `Date: ${ahora.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${id}@${dominio}>`,
    'MIME-Version: 1.0',
  ]
  const texto = ['Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', enLineas(base64(utf8(m.texto.replace(/\r?\n/g, '\r\n'))))]
  if (!m.adjuntos?.length) return [...cabeza, ...texto].join('\r\n')
  const partes = [texto.join('\r\n'), ...m.adjuntos.map((a) => [
    `Content-Type: ${a.tipo}; name="${nombreArchivo(a.nombre)}"`,
    `Content-Disposition: attachment; filename="${nombreArchivo(a.nombre)}"`,
    'Content-Transfer-Encoding: base64', '', enLineas(base64(a.datos)),
  ].join('\r\n'))]
  return [...cabeza, `Content-Type: multipart/mixed; boundary="${limite}"`, '', ...partes.map((p) => `--${limite}\r\n${p}`), `--${limite}--`, ''].join('\r\n')
}

// ---------- Conversación SMTP ----------
export type Canal = { leer(): Promise<string>; escribir(s: string): Promise<void>; tls(): Promise<void> }
type Respuesta = { codigo: number; texto: string }

async function respuesta(canal: Canal): Promise<Respuesta> {
  const lineas: string[] = []
  for (;;) {
    const l = await canal.leer()
    lineas.push(l)
    if (!/^\d{3}-/.test(l)) break
  }
  const ultima = lineas[lineas.length - 1]
  return { codigo: Number(ultima.slice(0, 3)), texto: lineas.join('\n') }
}
async function orden(canal: Canal, linea: string | null, esperado: number[], paso: string) {
  if (linea !== null) await canal.escribir(linea + '\r\n')
  const r = await respuesta(canal)
  if (!esperado.includes(r.codigo)) throw new Error(`SMTP ${paso}: ${r.texto.slice(0, 300)}`)
  return r
}

/** Todo el diálogo con el servidor. `cifrado` dice si la conexión ya nació con TLS (puerto 465). */
export async function conversar(canal: Canal, m: CorreoArmado, usuario: string, clave: string, cifrado: boolean) {
  await orden(canal, null, [220], 'saludo')
  let ehlo = await orden(canal, 'EHLO siroconsultas', [250], 'EHLO')
  if (!cifrado) {
    // Nunca se mandan la clave ni los datos sin cifrar.
    if (!/[- ]STARTTLS\b/i.test(ehlo.texto)) throw new Error('SMTP: el servidor no ofrece STARTTLS')
    await orden(canal, 'STARTTLS', [220], 'STARTTLS')
    await canal.tls()
    ehlo = await orden(canal, 'EHLO siroconsultas', [250], 'EHLO')
  }
  const auth = ehlo.texto.match(/[- ]AUTH[ =]([^\n]*)/i)?.[1].toUpperCase() ?? ''
  if (/\bPLAIN\b/.test(auth) || !/\bLOGIN\b/.test(auth)) {
    await orden(canal, `AUTH PLAIN ${base64(utf8(`\0${usuario}\0${clave}`))}`, [235], 'AUTH')
  } else {
    await orden(canal, 'AUTH LOGIN', [334], 'AUTH')
    await orden(canal, base64(utf8(usuario)), [334], 'AUTH')
    await orden(canal, base64(utf8(clave)), [235], 'AUTH')
  }
  await orden(canal, `MAIL FROM:<${m.de}>`, [250], 'MAIL FROM')
  for (const d of [m.para, m.copia].filter((x): x is string => !!x)) await orden(canal, `RCPT TO:<${d}>`, [250, 251], 'RCPT TO')
  await orden(canal, 'DATA', [354], 'DATA')
  const cuerpo = armarMensaje(m).split('\r\n').map((l) => (l.startsWith('.') ? '.' + l : l)).join('\r\n')
  await orden(canal, cuerpo + '\r\n.', [250], 'fin de DATA')
  await canal.escribir('QUIT\r\n').catch(() => {})
}

async function smtp(env: Bindings, m: CorreoArmado) {
  const { connect } = await import('cloudflare:sockets')
  const puerto = Number(env.SMTP_PUERTO || 587)
  const cifrado = puerto === 465
  let socket = connect({ hostname: env.SMTP_HOST!, port: puerto }, { secureTransport: cifrado ? 'on' : 'starttls', allowHalfOpen: false })
  let lector = socket.readable.getReader(), escritor = socket.writable.getWriter()
  const dec = new TextDecoder(), enc = new TextEncoder()
  let resto = ''
  const canal: Canal = {
    async leer() {
      for (;;) {
        const i = resto.indexOf('\n')
        if (i >= 0) { const l = resto.slice(0, i).replace(/\r$/, ''); resto = resto.slice(i + 1); return l }
        const { value, done } = await lector.read()
        if (done) throw new Error('SMTP: el servidor cortó la conexión')
        resto += dec.decode(value, { stream: true })
      }
    },
    async escribir(s) { await escritor.write(enc.encode(s)) },
    async tls() {
      lector.releaseLock(); escritor.releaseLock()
      socket = socket.startTls()
      lector = socket.readable.getReader(); escritor = socket.writable.getWriter(); resto = ''
    },
  }
  let reloj: ReturnType<typeof setTimeout> | undefined
  const tiempo = new Promise<never>((_, no) => { reloj = setTimeout(() => no(new Error('SMTP: se agotó el tiempo')), 25_000) })
  try {
    await Promise.race([conversar(canal, m, env.SMTP_USUARIO!, env.SMTP_CLAVE!, cifrado), tiempo])
  } finally {
    clearTimeout(reloj)
    await socket.close().catch(() => {})
  }
}

// ---------- Registro de envíos al paciente ----------
export type QueEnvio = 'comprobante' | 'documento' | 'datos_pago' | 'recordatorio' | 'aviso_turno' | 'propuesta'
export const registrarEnvio = (db: D1Database, que: QueEnvio, objetoId: number | null, pacienteId: number | null, destino: string, estado: 'enviado' | 'fallido' = 'enviado') =>
  db.prepare("INSERT INTO envios (que, objeto_id, paciente_id, canal, destino, estado) VALUES (?, ?, ?, 'correo', ?, ?)").bind(que, objetoId, pacienteId, destino, estado)
