// P5 · «Por correo»: comprobantes, documentos y estudios salen por el correo de la instalación, con el archivo original adjunto.
// Antes de adjuntar se controla la huella: si no coincide, no se manda nada.
import { Hono } from 'hono'
import type { Child } from 'hono/jsx'
import type { Bindings, C, Env } from '../tipos'
import { leerInstalacion } from '../lib/instalacion'
import { sha256, nombreSeguro } from '../lib/documentos'
import { importeTexto, numeroTexto } from '../lib/comprobantes'
import { ErrorCorreo, SIN_CORREO, esCorreo, mandarCorreo, modoCorreo, registrarEnvio, type Adjunto, type QueEnvio } from '../lib/correo'
import { Pagina } from '../ui/pagina'
import { Aviso, Boton, Tarjeta } from '../ui/componentes'

export const envios = new Hono<Env>()

/** Solo rutas propias: «/algo», nunca «//otro-sitio». */
export const volverSeguro = (v: unknown, defecto: string) => (typeof v === 'string' && /^\/(?![/\\])[^\s]*$/.test(v) && v.length <= 300 ? v : defecto)

/** El botón «Por correo» de cada pantalla: manda, o explica por qué no se puede. */
export function PorCorreo({ env, accion, correo, volver, oculto }: { env: Bindings; accion: string; correo: string | null; volver: string; oculto?: Child }) {
  if (!esCorreo(correo)) return <p class="ayuda">No tiene correo en su ficha. Cargalo en la ficha para mandárselo por correo.</p>
  const modo = modoCorreo(env)
  return <form class="columna-chica" method="post" action={accion}>
    <input type="hidden" name="volver" value={volver} />{oculto}
    <Boton type="submit" variante="claro" disabled={!modo}>Por correo</Boton>
    <span class="ayuda">{modo ? `Le llega a ${correo}${modo === 'demo' ? ' (en la demo no sale de verdad)' : ''}.` : SIN_CORREO}</span>
  </form>
}

export async function resultado(c: C, r: { ok: boolean; texto: string; volver: string; etiqueta?: string }) {
  const prof = await c.env.DB.prepare('SELECT nombre FROM profesional WHERE id = 1').first<{ nombre: string | null }>()
  const demo = r.ok && modoCorreo(c.env) === 'demo'
  return c.html(<Pagina titulo={r.ok ? 'Enviado' : 'No se pudo mandar'} seccion="otra" inst={leerInstalacion(c.env)} email={c.get('email')!} nombre={prof?.nombre}>
    <div class="angosto columna">
      <Tarjeta titulo={r.ok ? 'Listo' : 'No se pudo mandar'}>
        <Aviso tipo={r.ok ? 'ok' : 'error'}>{r.texto}</Aviso>
        {demo && <p class="ayuda">Es la demo: no salió ningún correo de verdad.</p>}
        <div class="fila"><Boton href={r.volver} variante="oscuro">{r.etiqueta ?? 'Volver'}</Boton></div>
      </Tarjeta>
    </div>
  </Pagina>, r.ok ? 200 : 422)
}

export async function archivoVerificado(env: Bindings, clave: string | null, huella: string | null) {
  if (!clave || !huella) return null
  const obj = await env.ARCHIVOS.get(clave)
  if (!obj) return null
  const b = new Uint8Array(await obj.arrayBuffer())
  return (await sha256(b)) === huella ? b : null
}

type Destinatario = { paciente_id: number; nombre: string; apellido: string; correo: string | null; baja_en: string | null }
const destinatario = (db: D1Database, id: number) =>
  db.prepare('SELECT id paciente_id, nombre, apellido, correo, baja_en FROM pacientes WHERE id = ?').bind(id).first<Destinatario>()

/** Manda, registra el envío y arma la pantalla del resultado. */
export async function mandarAlPaciente(c: C, p: Destinatario, que: QueEnvio, objetoId: number | null, asunto: string, texto: string, adjuntos: Adjunto[], volver: string, cosa: string) {
  if (!esCorreo(p.correo)) return resultado(c, { ok: false, texto: 'No tiene correo en su ficha.', volver })
  const prof = await c.env.DB.prepare('SELECT nombre, especialidad, correo FROM profesional WHERE id = 1').first<{ nombre: string | null; especialidad: string | null; correo: string | null }>()
  const firma = [prof?.nombre, prof?.especialidad].filter(Boolean).join('\n')
  try {
    await mandarCorreo(c.env, { para: p.correo, responderA: esCorreo(prof?.correo) ? prof!.correo : null, asunto, texto: firma ? `${texto}\n\n${firma}` : texto, adjuntos }, prof?.nombre ?? '')
  } catch (e) {
    if (!(e instanceof ErrorCorreo)) throw e
    await registrarEnvio(c.env.DB, que, objetoId, p.paciente_id, p.correo, 'fallido').run()
    return resultado(c, { ok: false, texto: e.message, volver })
  }
  await c.env.DB.batch([
    registrarEnvio(c.env.DB, que, objetoId, p.paciente_id, p.correo),
    c.env.DB.prepare('INSERT INTO auditoria (evento, detalle, usuario) VALUES (?, ?, ?)').bind('correo_enviado', `${que}:${objetoId ?? '-'}`, c.get('email')!),
  ])
  return resultado(c, { ok: true, texto: `Le mandamos ${cosa} a ${p.nombre} ${p.apellido} (${p.correo}).`, volver })
}

// ---------- Comprobante interno ----------
envios.post('/comprobantes/:id{[0-9]+}/correo', async (c) => {
  const id = Number(c.req.param('id')), f = await c.req.parseBody(), volver = volverSeguro(f.volver, `/comprobantes/${id}`)
  const r = await c.env.DB.prepare(
    `SELECT k.id, k.numero, k.importe, k.estado, k.pdf_clave, k.pdf_sha256, c.paciente_id, g.anulado_en
       FROM comprobantes k JOIN pagos g ON g.id = k.pago_id JOIN cobros c ON c.id = g.cobro_id WHERE k.id = ? AND k.tipo = 'interno'`)
    .bind(id).first<{ id: number; numero: number; importe: number; estado: string; pdf_clave: string | null; pdf_sha256: string | null; paciente_id: number; anulado_en: string | null }>()
  if (!r) return c.notFound()
  const p = (await destinatario(c.env.DB, r.paciente_id))!
  if (r.estado !== 'emitido' || r.anulado_en) return resultado(c, { ok: false, texto: 'El comprobante está anulado: no se manda.', volver })
  const pdf = await archivoVerificado(c.env, r.pdf_clave, r.pdf_sha256)
  if (!pdf) return resultado(c, { ok: false, texto: 'No encontramos el PDF original o su huella no coincide. No se mandó nada.', volver })
  const n = numeroTexto(r.numero)
  return mandarAlPaciente(c, p, 'comprobante', r.id, `Comprobante N.º ${n}`,
    `Hola ${p.nombre}, te adjunto el comprobante interno N.º ${n} por ${importeTexto(r.importe)}.`,
    [{ nombre: `comprobante_${n}.pdf`, tipo: 'application/pdf', datos: pdf }], volver, 'el comprobante')
})

// ---------- Documentos y estudios ----------
const TITULOS: Record<string, string> = { certificado: 'Certificado', pedido: 'Pedido de estudios' }
for (const estudio of [false, true]) {
  const base = estudio ? '/documentos/estudios' : '/documentos'
  envios.post(`${base}/:id{[0-9]+}/correo`, async (c) => {
    const id = Number(c.req.param('id')), f = await c.req.parseBody(), volver = volverSeguro(f.volver, `${base}/${id}`)
    const r = estudio
      ? await c.env.DB.prepare('SELECT paciente_id, nombre titulo, clave, sha256 huella, mime, anulado_en FROM archivos WHERE id = ?').bind(id)
        .first<{ paciente_id: number; titulo: string; clave: string; huella: string; mime: string; anulado_en: string | null }>()
      : await c.env.DB.prepare('SELECT paciente_id, tipo titulo, pdf_clave clave, pdf_sha256 huella, \'application/pdf\' mime, anulado_en FROM documentos WHERE id = ?').bind(id)
        .first<{ paciente_id: number; titulo: string; clave: string | null; huella: string | null; mime: string; anulado_en: string | null }>()
    if (!r) return c.notFound()
    const p = (await destinatario(c.env.DB, r.paciente_id))!
    if (r.anulado_en || p.baja_en) return resultado(c, { ok: false, texto: 'Está anulado o la ficha está en solo lectura: no se manda.', volver })
    const titulo = estudio ? r.titulo : TITULOS[r.titulo]
    if (!titulo) return resultado(c, { ok: false, texto: 'Este documento no tiene archivo para mandar.', volver })
    const datos = await archivoVerificado(c.env, r.clave, r.huella)
    if (!datos) return resultado(c, { ok: false, texto: 'No encontramos el archivo original o su huella no coincide. No se mandó nada.', volver })
    const mime = ['application/pdf', 'image/jpeg', 'image/png'].includes(r.mime) ? r.mime : 'application/octet-stream'
    const archivo = estudio ? nombreSeguro(r.titulo) : `${r.titulo}_${id}.pdf`
    return mandarAlPaciente(c, p, 'documento', id, titulo, `Hola ${p.nombre}, te adjunto ${estudio ? `el estudio «${titulo}»` : titulo.toLowerCase()}.`,
      [{ nombre: archivo, tipo: mime, datos }], volver, estudio ? 'el estudio' : titulo === 'Certificado' ? 'el certificado' : 'el pedido de estudios')
  })
}
