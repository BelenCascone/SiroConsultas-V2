// Agenda: rangos de cada vista, turnos del rango, estado que se muestra y límites del tablero.
import { sumarDias } from './fechas'
import { aMinutos, diaDeSemana, PASO_MIN } from './turnos'

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
