// P5 · Recordatorio de turno: el mensaje (WhatsApp con un toque o correo automático 48 h antes).
// Solo lleva nombre, día, hora y lugar: nunca motivo ni datos clínicos.
import type { Bindings } from '../tipos'
import { DIAS, ahoraAR, ahoraISO } from './fechas'
import { ErrorCorreo, esCorreo, mandarCorreo, modoCorreo, registrarEnvio } from './correo'

export const MENSAJE_ORIGINAL = 'Hola {nombre}, te recordamos tu turno el {dia} a las {hora}.\n{lugar}\n¿Nos confirmás que venís? Si no podés, avisanos así reprogramamos. ¡Gracias!'
export const MAX_MENSAJE = 600
export const HORAS_ANTES = 48
const POR_TANDA = 40

export type DatosRecordatorio = { nombre: string; fecha: string; hora: string; modalidad: string; consultorio: string; direccion: string | null; enlace_video: string | null }

/** «viernes 24/10» */
export const diaRecordatorio = (iso: string) => `${DIAS[new Date(iso + 'T00:00:00Z').getUTCDay()]} ${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}`

export function lugar(d: Pick<DatosRecordatorio, 'modalidad' | 'consultorio' | 'direccion' | 'enlace_video'>) {
  if (d.modalidad === 'videollamada') return d.enlace_video ? `Por videollamada: ${d.enlace_video}` : 'Por videollamada. Te mandamos el enlace antes del turno.'
  const nombre = /^consultorio\b/i.test(d.consultorio) ? d.consultorio : `Consultorio ${d.consultorio}`
  return d.direccion ? `${nombre} · ${d.direccion}` : nombre
}

export function textoRecordatorio(plantilla: string | null | undefined, d: DatosRecordatorio) {
  const valores: Record<string, string> = { nombre: d.nombre, dia: diaRecordatorio(d.fecha), hora: d.hora, lugar: lugar(d) }
  return (plantilla?.trim() || MENSAJE_ORIGINAL).replace(/\{(nombre|dia|hora|lugar)\}/g, (_, k: string) => valores[k])
}

/** Valida el mensaje que escribe la profesional. Devuelve el error o null. */
export function revisarMensaje(m: string) {
  if (!m.trim()) return 'Escribí el mensaje del recordatorio.'
  if (m.length > MAX_MENSAJE) return `El mensaje puede tener hasta ${MAX_MENSAJE} letras.`
  const otras = [...m.matchAll(/\{([^}]*)\}/g)].map((x) => x[1]).filter((x) => !['nombre', 'dia', 'hora', 'lugar'].includes(x))
  if (otras.length) return `No conocemos {${otras[0]}}. Podés usar {nombre}, {dia}, {hora} y {lugar}.`
  if (!m.includes('{dia}') || !m.includes('{hora}')) return 'El mensaje tiene que llevar {dia} y {hora}.'
  return null
}

type Pendiente = DatosRecordatorio & { id: number; paciente_id: number; apellido: string; correo: string }
type Perfil = { nombre: string | null; especialidad: string | null; correo: string | null; recordatorio_mensaje: string | null; recordatorio_correo_activo: number }

/** Turnos confirmados que empiezan dentro de las próximas 48 h y todavía no recibieron el correo. */
export async function pendientesDeRecordatorio(db: D1Database, ms = Date.now()) {
  const ahora = ahoraAR(ms), hasta = ahoraAR(ms + HORAS_ANTES * 3600_000)
  return (await db.prepare(
    `SELECT t.id, t.paciente_id, t.fecha, t.hora, t.modalidad, t.enlace_video, co.nombre consultorio, co.direccion, p.nombre, p.apellido, p.correo
       FROM turnos t JOIN pacientes p ON p.id = t.paciente_id JOIN consultorios co ON co.id = t.consultorio_id
      WHERE t.estado = 'confirmado' AND t.recordatorio_correo_en IS NULL
        AND p.correo IS NOT NULL AND p.recordatorios_baja = 0 AND p.baja_en IS NULL
        AND t.fecha || ' ' || t.hora > ? AND t.fecha || ' ' || t.hora <= ?
      ORDER BY t.fecha, t.hora LIMIT ?`,
  ).bind(`${ahora.fecha} ${ahora.hora}`, `${hasta.fecha} ${hasta.hora}`, POR_TANDA).all<Pendiente>()).results
}

export function correoRecordatorio(prof: Perfil, t: Pendiente) {
  const firma = [prof.nombre, prof.especialidad].filter(Boolean).join('\n')
  return {
    para: t.correo,
    responderA: esCorreo(prof.correo) ? prof.correo : null,
    asunto: `Recordatorio de tu turno del ${diaRecordatorio(t.fecha)} a las ${t.hora}`,
    texto: `${textoRecordatorio(prof.recordatorio_mensaje, t)}\n\n${firma ? firma + '\n\n' : ''}Para confirmar o avisar que no podés venir, respondé este correo.`,
  }
}

/** Lo que corre la tarea programada cada hora. Devuelve cuántos salieron y cuántos fallaron. */
export async function mandarRecordatorios(env: Bindings, ms = Date.now()) {
  const db = env.DB
  const prof = await db.prepare('SELECT nombre, especialidad, correo, recordatorio_mensaje, recordatorio_correo_activo FROM profesional WHERE id = 1').first<Perfil>()
  const r = { enviados: 0, fallidos: 0 }
  if (!prof?.recordatorio_correo_activo || modoCorreo(env) !== 'smtp') return r
  for (const t of await pendientesDeRecordatorio(db, ms)) {
    if (!esCorreo(t.correo)) continue
    // Se marca antes de mandar: si dos tandas se pisan, el turno sale una sola vez.
    const marca = await db.prepare("UPDATE turnos SET recordatorio_correo_en = ? WHERE id = ? AND recordatorio_correo_en IS NULL AND estado = 'confirmado'").bind(ahoraISO(ms), t.id).run()
    if (!marca.meta.changes) continue
    try {
      await mandarCorreo(env, correoRecordatorio(prof, t), prof.nombre ?? '')
      await registrarEnvio(db, 'recordatorio', t.id, t.paciente_id, t.correo).run()
      r.enviados++
    } catch (e) {
      if (!(e instanceof ErrorCorreo)) throw e
      // No se reintenta solo, para no mandarle varios: la profesional lo ve en la campanita y le avisa por WhatsApp.
      await db.batch([
        registrarEnvio(db, 'recordatorio', t.id, t.paciente_id, t.correo, 'fallido'),
        db.prepare("INSERT INTO notificaciones (tipo, texto, enlace) VALUES ('correo_rechazado', ?, ?)")
          .bind(`No pudimos mandarle el recordatorio por correo a ${t.nombre} ${t.apellido} (turno del ${diaRecordatorio(t.fecha)} a las ${t.hora}). Avisale por WhatsApp.`, `/agenda?vista=dia&fecha=${t.fecha}&turno=${t.id}`),
      ])
      r.fallidos++
    }
  }
  return r
}
