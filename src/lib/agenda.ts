// Agenda: rangos de cada vista, turnos del rango, estado que se muestra y límites del tablero.
import { ahoraISO, sumarDias } from './fechas'
import { aMinutos, cargarAgenda, controlar, diaDe, diaDeSemana, PASO_MIN } from './turnos'

export const VISTAS = ['dia', 'semana', 'mes'] as const
export type Vista = (typeof VISTAS)[number]

export const lunesDe = (iso: string) => sumarDias(iso, 1 - diaDeSemana(iso))
const inicioMes = (iso: string) => iso.slice(0, 8) + '01'
const finMes = (iso: string) => {
  const d = new Date(inicioMes(iso) + 'T00:00:00Z')
  d.setUTCMonth(d.getUTCMonth() + 1)
  d.setUTCDate(0)
  return d.toISOString().slice(0, 10)
}

/** Primer y último día que muestra cada vista (el mes, completo por semanas de lunes a domingo). */
export function rangoDe(vista: Vista, fecha: string) {
  if (vista === 'dia') return { desde: fecha, hasta: fecha }
  if (vista === 'semana') return { desde: lunesDe(fecha), hasta: sumarDias(lunesDe(fecha), 6) }
  return { desde: lunesDe(inicioMes(fecha)), hasta: sumarDias(lunesDe(finMes(fecha)), 6) }
}

/** La fecha de la vista anterior (-1) o siguiente (+1). */
export function vecina(vista: Vista, fecha: string, paso: 1 | -1) {
  if (vista === 'dia') return sumarDias(fecha, paso)
  if (vista === 'semana') return sumarDias(fecha, 7 * paso)
  const d = new Date(inicioMes(fecha) + 'T00:00:00Z')
  d.setUTCMonth(d.getUTCMonth() + paso)
  return d.toISOString().slice(0, 10)
}

export type TurnoAgenda = {
  id: number; fecha: string; hora: string; duracion_min: number; estado: string; confirmacion: string | null
  consultorio_id: number; consultorio: string; modalidad: string; paciente_id: number; nombre: string; apellido: string; prestacion: string | null
}

export async function turnosDelRango(db: D1Database, desde: string, hasta: string) {
  const r = await db.prepare(
    `SELECT t.id, t.fecha, t.hora, t.duracion_min, t.estado, t.confirmacion, t.consultorio_id, co.nombre consultorio, t.modalidad,
            t.paciente_id, p.nombre, p.apellido, pr.nombre prestacion
       FROM turnos t JOIN pacientes p ON p.id = t.paciente_id JOIN consultorios co ON co.id = t.consultorio_id
       LEFT JOIN prestaciones pr ON pr.id = t.prestacion_id
      WHERE t.fecha BETWEEN ? AND ? AND t.estado <> 'cancelado' ORDER BY t.fecha, t.hora`).bind(desde, hasta).all<TurnoAgenda>()
  return r.results ?? []
}

export type Mostrado = { clave: string; texto: string }

/** Cómo se ve un turno: estado real, o si todavía no respondió, si está pasando ahora o quedó sin resolver. */
export function estadoMostrado(t: Pick<TurnoAgenda, 'fecha' | 'hora' | 'duracion_min' | 'estado' | 'confirmacion'>, hoy: string, ahoraMin: number): Mostrado {
  if (t.estado === 'atendido') return { clave: 'atendido', texto: 'Atendido' }
  if (t.estado === 'ausente') return { clave: 'ausente', texto: 'No vino' }
  if (t.estado === 'cancelado') return { clave: 'cancelado', texto: 'Cancelado' }
  if (t.estado === 'solicitado') return { clave: 'solicitado', texto: 'Pedido online' }
  const ini = aMinutos(t.hora)
  if (t.fecha === hoy && ahoraMin >= ini && ahoraMin < ini + t.duracion_min) return { clave: 'ahora', texto: 'Ahora' }
  if (t.fecha < hoy || (t.fecha === hoy && ahoraMin >= ini + t.duracion_min)) return { clave: 'pendiente', texto: 'Sin resolver' }
  if (t.confirmacion === 'voy') return { clave: 'confirmo', texto: 'Confirmó' }
  if (t.confirmacion === 'no_puedo') return { clave: 'no_puede', texto: 'No puede venir' }
  return { clave: 'sin_respuesta', texto: 'Sin respuesta' }
}

/** «Tomás F.» */
export const nombreCorto = (t: { nombre: string; apellido: string }) => `${t.nombre.split(' ')[0]} ${t.apellido[0]}.`

/** Desde y hasta del tablero, en minutos: de 8 a 20 como mínimo y más si hay horarios o turnos fuera de ese rango. */
export function limitesDelTablero(franjas: { desde: number; hasta: number }[], turnos: { hora: string; duracion_min: number }[]) {
  let ini = 8 * 60, fin = 20 * 60
  for (const f of franjas) { ini = Math.min(ini, f.desde); fin = Math.max(fin, f.hasta) }
  for (const t of turnos) { ini = Math.min(ini, aMinutos(t.hora)); fin = Math.max(fin, aMinutos(t.hora) + t.duracion_min) }
  ini = Math.floor(ini / 60) * 60
  fin = Math.min(24 * 60, Math.ceil(fin / 60) * 60)
  return { ini, fin, filas: (fin - ini) / PASO_MIN }
}

/** Cómo se pinta cada estado mostrado (componente Estado). */
export const CLAVE_ESTADO: Record<string, string> = {
  atendido: 'atendido', ausente: 'ausente', cancelado: 'cancelado', solicitado: 'solicitado', ahora: 'primera', confirmo: 'confirmado',
  no_puede: 'debe', pendiente: 'debe', sin_respuesta: 'sin_respuesta',
}

/**
 * Mueve un turno confirmado a otro hueco. Mira el día de destino y, si alguien lo ocupó en el medio, la base no deja pisarlo.
 * Devuelve el mensaje de lo que impide el movimiento (o `{}` si se movió).
 */
export async function moverTurno(
  db: D1Database, t: { id: number; fecha: string; hora: string; duracion_min: number; estado: string },
  destino: { consultorio_id: number; fecha: string; hora: string }, hoy: string, ahoraMin: number, propuestaId: number | null = null,
): Promise<{ error?: string }> {
  if (t.estado !== 'confirmado') return { error: 'No se pudo mover el turno.' }
  const lugar = await db.prepare('SELECT id, modalidad FROM consultorios WHERE id = ? AND activo = 1').bind(destino.consultorio_id).first<{ id: number; modalidad: string }>()
  if (!lugar) return { error: 'Ese consultorio ya no está disponible.' }
  const instante = ahoraISO()
  if (propuestaId !== null && !await db.prepare("SELECT id FROM propuestas WHERE id=? AND turno_id=? AND consultorio_id=? AND fecha=? AND hora=? AND estado='reservada' AND vence_en>?").bind(propuestaId,t.id,destino.consultorio_id,destino.fecha,destino.hora,instante).first()) return {error:'Esos horarios ya vencieron.'}
  const datos = await cargarAgenda(db, destino.fecha, destino.fecha, instante)
  const disponibles = { ...datos, turnos: datos.turnos.filter((x) => x.id !== t.id), propuestas: datos.propuestas.filter(p => propuestaId === null || p.turno_id !== t.id) }
  const control = controlar(diaDe(disponibles, destino.consultorio_id, destino.fecha), destino.hora, t.duracion_min, hoy, ahoraMin)
  if (control.errores.length || control.avisos.length) return { error: [...control.errores, ...control.avisos.map((a) => a.texto)].join(' ') }
  const minutos = '(CAST(substr(x.hora, 1, 2) AS INTEGER) * 60 + CAST(substr(x.hora, 4, 2) AS INTEGER))'
  const ini = aMinutos(destino.hora)
  // El movimiento y la liberación de reservas van juntos. Nunca se abre un hueco entre ambos pasos.
  const cambio = db.prepare(
    `UPDATE turnos SET consultorio_id = ?, fecha = ?, hora = ?, modalidad = ?, confirmacion = NULL, confirmacion_cambios = 0, confirmacion_en = NULL,
            recordatorio_whatsapp_en = NULL, recordatorio_correo_en = NULL, actualizado_en = ?
      WHERE id = ? AND estado = 'confirmado' AND NOT EXISTS (SELECT 1 FROM turnos x WHERE x.id <> turnos.id AND x.fecha = ? AND x.estado IN ('confirmado', 'solicitado', 'atendido')
        AND ${minutos} < ? AND ? < ${minutos} + x.duracion_min)
      AND NOT EXISTS (SELECT 1 FROM propuestas x WHERE x.fecha=? AND x.estado='reservada' AND x.vence_en>?
        AND (? IS NULL OR x.turno_id IS NOT ?) AND ${minutos} < ? AND ? < ${minutos} + x.duracion_min)
      AND (? IS NULL OR EXISTS (SELECT 1 FROM propuestas p WHERE p.id=? AND p.turno_id=turnos.id AND p.estado='reservada' AND p.vence_en>?))`)
    .bind(destino.consultorio_id, destino.fecha, destino.hora, lugar.modalidad, instante, t.id, destino.fecha, ini + t.duracion_min, ini,
      destino.fecha,instante,propuestaId,t.id,ini+t.duracion_min,ini,propuestaId,propuestaId,instante)
  const liberar = db.prepare(`UPDATE propuestas SET estado=CASE WHEN id=? THEN 'elegida' ELSE 'liberada' END
    WHERE turno_id=? AND estado='reservada' AND EXISTS (SELECT 1 FROM turnos t WHERE t.id=? AND t.estado='confirmado'
      AND t.consultorio_id=? AND t.fecha=? AND t.hora=? AND t.actualizado_en=?)`)
    .bind(propuestaId,t.id,t.id,destino.consultorio_id,destino.fecha,destino.hora,instante)
  const [r] = await db.batch([cambio,liberar])
  if (!r.meta.changes) return { error: 'Ese horario se ocupó recién o la propuesta venció. Elegí otro.' }
  return {}
}
