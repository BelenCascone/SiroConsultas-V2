// Turnos: huecos libres, controles antes de guardar y repetición. Todo en horario de Argentina (fechas «AAAA-MM-DD», horas «HH:MM»).
// Hay una sola profesional: un turno ocupa su tiempo en todos los consultorios a la vez.
import { esFecha, esHora, sumarDias } from './fechas'

export const PASO_MIN = 30
/** Estados que ocupan el tiempo de la profesional. */
export const OCUPAN = ['confirmado', 'solicitado', 'atendido'] as const
export const MAX_REPETICIONES = 52

export const aMinutos = (hora: string) => Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3, 5))
export const aHora = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
/** 1 = lunes … 7 = domingo, como en la tabla de horarios. */
export const diaDeSemana = (iso: string) => new Date(iso + 'T00:00:00Z').getUTCDay() || 7

type Franja = { desde: number; hasta: number }
type Intervalo = Franja & { quien?: string }

export type DatosAgenda = {
  horarios: { consultorio_id: number; dia: number; desde: string; hasta: string }[]
  turnos: { id: number; fecha: string; hora: string; duracion_min: number; paciente: string }[]
  propuestas: { fecha: string; hora: string; duracion_min: number }[]
  bloqueos: { desde: string; hasta: string; hora_desde: string | null; hora_hasta: string | null; consultorio_id: number | null; motivo: string | null; detalle: string | null }[]
  feriados: { fecha: string; nombre: string; atiende: number | null }[]
}

/** Lo que hace falta de la base para calcular los días de un rango. */
export async function cargarAgenda(db: D1Database, desde: string, hasta: string, ahoraISO: string): Promise<DatosAgenda> {
  const [horarios, turnos, propuestas, bloqueos, feriados] = await Promise.all([
    db.prepare('SELECT h.consultorio_id, h.dia, h.desde, h.hasta FROM horarios h JOIN consultorios c ON c.id = h.consultorio_id WHERE c.activo = 1').all(),
    db.prepare(
      `SELECT t.id, t.fecha, t.hora, t.duracion_min, p.nombre || ' ' || p.apellido paciente FROM turnos t JOIN pacientes p ON p.id = t.paciente_id
        WHERE t.fecha BETWEEN ?1 AND ?2 AND t.estado IN ('confirmado', 'solicitado', 'atendido')`).bind(desde, hasta).all(),
    db.prepare("SELECT fecha, hora, duracion_min FROM propuestas WHERE estado = 'reservada' AND vence_en > ?3 AND fecha BETWEEN ?1 AND ?2").bind(desde, hasta, ahoraISO).all(),
    db.prepare('SELECT desde, hasta, hora_desde, hora_hasta, consultorio_id, motivo, detalle FROM bloqueos WHERE quitado_en IS NULL AND desde <= ?2 AND hasta >= ?1').bind(desde, hasta).all(),
    db.prepare('SELECT fecha, nombre, atiende FROM feriados WHERE fecha BETWEEN ?1 AND ?2').bind(desde, hasta).all(),
  ])
  return {
    horarios: horarios.results as DatosAgenda['horarios'], turnos: turnos.results as DatosAgenda['turnos'],
    propuestas: propuestas.results as DatosAgenda['propuestas'], bloqueos: bloqueos.results as DatosAgenda['bloqueos'],
    feriados: feriados.results as DatosAgenda['feriados'],
  }
}

export type Dia = {
  fecha: string
  franjas: Franja[]           // horario de atención del consultorio ese día
  ocupados: Intervalo[]       // turnos y horarios reservados
  cerrado: { tipo: 'feriado' | 'bloqueo'; texto: string } | null  // todo el día fuera de la agenda
  parciales: Intervalo[]      // bloqueos de algunas horas
}

export const MOTIVOS_BLOQUEO: Record<string, string> = { congreso: 'Congreso', vacaciones: 'Vacaciones', personal: 'Personal', otro: 'Otro' }

/** El día de un consultorio: su horario, lo ocupado y si está cerrado. */
export function diaDe(d: DatosAgenda, consultorioId: number, fecha: string): Dia {
  const dia = diaDeSemana(fecha)
  const franjas = d.horarios.filter((h) => h.consultorio_id === consultorioId && h.dia === dia).map((h) => ({ desde: aMinutos(h.desde), hasta: aMinutos(h.hasta) }))
    .sort((a, b) => a.desde - b.desde)
  const ocupados: Intervalo[] = [
    ...d.turnos.filter((t) => t.fecha === fecha).map((t) => ({ desde: aMinutos(t.hora), hasta: aMinutos(t.hora) + t.duracion_min, quien: t.paciente })),
    ...d.propuestas.filter((t) => t.fecha === fecha).map((t) => ({ desde: aMinutos(t.hora), hasta: aMinutos(t.hora) + t.duracion_min, quien: 'un horario propuesto' })),
  ]
  const feriado = d.feriados.find((f) => f.fecha === fecha && f.atiende !== 1)
  let cerrado: Dia['cerrado'] = feriado ? { tipo: 'feriado', texto: feriado.nombre } : null
  const parciales: Intervalo[] = []
  for (const b of d.bloqueos) {
    if (fecha < b.desde || fecha > b.hasta || (b.consultorio_id !== null && b.consultorio_id !== consultorioId)) continue
    const motivo = (b.motivo && MOTIVOS_BLOQUEO[b.motivo]) || 'Bloqueado'
    if (b.hora_desde === null || b.hora_hasta === null) cerrado ??= { tipo: 'bloqueo', texto: b.detalle ? `${motivo} · ${b.detalle}` : motivo }
    else parciales.push({ desde: aMinutos(b.hora_desde), hasta: aMinutos(b.hora_hasta), quien: motivo })
  }
  return { fecha, franjas, ocupados, cerrado, parciales }
}

const pisa = (a: Franja, b: Franja) => a.desde < b.hasta && b.desde < a.hasta

/** Huecos libres de un día: cada 30 minutos dentro del horario, sin pisar turnos ni bloqueos y, hoy, solo hacia adelante. */
export function huecos(dia: Dia, duracion: number, hoy: string, ahoraMin: number) {
  if (dia.cerrado || dia.fecha < hoy) return []
  const salida: string[] = []
  for (const f of dia.franjas) {
    for (let ini = f.desde; ini + duracion <= f.hasta; ini += PASO_MIN) {
      const tramo = { desde: ini, hasta: ini + duracion }
      if (dia.fecha === hoy && ini <= ahoraMin) continue
      if ([...dia.ocupados, ...dia.parciales].some((o) => pisa(o, tramo))) continue
      salida.push(aHora(ini))
    }
  }
  return salida
}

export type Control = { errores: string[]; avisos: { tipo: 'superpone' | 'fuera_horario'; texto: string }[] }

/** Lo que pasa si se da un turno ahí: errores que lo impiden y avisos que la profesional puede aceptar. */
export function controlar(dia: Dia, hora: string, duracion: number, hoy: string, ahoraMin: number): Control {
  const r: Control = { errores: [], avisos: [] }
  const tramo = { desde: aMinutos(hora), hasta: aMinutos(hora) + duracion }
  if (dia.fecha < hoy || (dia.fecha === hoy && tramo.desde <= ahoraMin)) r.errores.push('Ese horario ya pasó.')
  if (dia.cerrado) r.errores.push(dia.cerrado.tipo === 'feriado' ? `Ese día es feriado (${dia.cerrado.texto}) y figura sin atención.` : `Esa fecha está bloqueada (${dia.cerrado.texto}).`)
  const parcial = dia.parciales.find((p) => pisa(p, tramo))
  if (parcial) r.errores.push(`Ese horario está bloqueado (${parcial.quien}).`)
  const otro = dia.ocupados.find((o) => pisa(o, tramo))
  if (otro) r.avisos.push({ tipo: 'superpone', texto: `Se superpone con el turno de ${otro.quien} (${aHora(otro.desde)} a ${aHora(otro.hasta)}).` })
  if (!dia.franjas.some((f) => tramo.desde >= f.desde && tramo.hasta <= f.hasta)) r.avisos.push({ tipo: 'fuera_horario', texto: 'Ese horario está fuera de tu horario de atención en este consultorio.' })
  return r
}

/** Fechas de una serie: la primera y las siguientes cada N semanas hasta la fecha final (sin pasar de un año ni de 52 turnos). */
export function fechasDeSerie(primera: string, cadaSemanas: number, hasta: string) {
  const fechas = [primera]
  const tope = sumarDias(primera, 366)
  for (let f = sumarDias(primera, cadaSemanas * 7); f <= hasta && f <= tope && fechas.length < MAX_REPETICIONES; f = sumarDias(f, cadaSemanas * 7)) fechas.push(f)
  return fechas
}

export type DatosTurno = {
  paciente_id: number; consultorio_id: number; prestacion_id: number; fecha: string; hora: string
  repetir: { cada: number; hasta: string } | null; avisar: boolean; forzar: boolean
}

/** Valida lo que llega del formulario de guardar. Devuelve el primer problema, si lo hay. */
export function leerTurno(f: Record<string, unknown>): { datos?: DatosTurno; error?: string } {
  const num = (v: unknown) => (typeof v === 'string' && /^\d{1,9}$/.test(v) ? Number(v) : 0)
  const fecha = typeof f.fecha === 'string' ? f.fecha : '', hora = typeof f.hora === 'string' ? f.hora : ''
  const datos: DatosTurno = {
    paciente_id: num(f.paciente), consultorio_id: num(f.consultorio), prestacion_id: num(f.prestacion), fecha, hora,
    repetir: null, avisar: f.avisar === '1', forzar: f.forzar === '1',
  }
  if (!datos.paciente_id || !datos.consultorio_id || !datos.prestacion_id || !esFecha(fecha) || !esHora(hora)) return { error: 'Faltan datos del turno: elegí de nuevo el día y la hora.' }
  if (f.repetir === '1') {
    const cada = num(f.cada), hasta = typeof f.hasta === 'string' ? f.hasta : ''
    if (cada < 1 || cada > 12) return { error: 'Repetir: elegí cada cuántas semanas (de 1 a 12).' }
    if (!esFecha(hasta) || hasta <= fecha) return { error: 'Repetir: la fecha final tiene que ser posterior al primer turno.' }
    datos.repetir = { cada, hasta }
  }
  return { datos }
}

export type NuevoTurno = {
  paciente_id: number; consultorio_id: number; fecha: string; hora: string; duracion_min: number; prestacion_id: number
  cobertura: 'particular' | 'obra_social'; obra_social_id: number | null; modalidad: 'presencial' | 'videollamada'
  atencion: 'primera' | 'control'; serie_id: number | null
}

/** Guarda el turno. Sin «forzar», la base misma se asegura de que nadie lo haya ocupado un segundo antes: devuelve null si ya está ocupado. */
export async function crearTurno(db: D1Database, t: NuevoTurno, forzar: boolean) {
  const inicio = aMinutos(t.hora)
  const minutos = '(CAST(substr(x.hora, 1, 2) AS INTEGER) * 60 + CAST(substr(x.hora, 4, 2) AS INTEGER))'
  const libre = forzar ? '' : `WHERE NOT EXISTS (SELECT 1 FROM turnos x WHERE x.fecha = ? AND x.estado IN ('confirmado', 'solicitado', 'atendido')
        AND ${minutos} < ? AND ? < ${minutos} + x.duracion_min)`
  const args: (string | number | null)[] = [t.paciente_id, t.consultorio_id, t.fecha, t.hora, t.duracion_min, t.prestacion_id, t.cobertura, t.obra_social_id, t.modalidad, t.atencion, t.serie_id]
  if (!forzar) args.push(t.fecha, inicio + t.duracion_min, inicio)
  const r = await db.prepare(
    `INSERT INTO turnos (paciente_id, consultorio_id, fecha, hora, duracion_min, prestacion_id, cobertura, obra_social_id, modalidad, atencion, serie_id)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? ${libre} RETURNING id`).bind(...args).first<{ id: number }>()
  return r?.id ?? null
}
