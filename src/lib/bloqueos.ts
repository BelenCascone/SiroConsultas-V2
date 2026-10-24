// Bloqueos de agenda: validar lo que llega del formulario, qué turnos caen adentro y a dónde moverlos.
// Un bloqueo no cancela turnos solo: la profesional resuelve cada uno (mover o cancelar y avisar).
import { DIAS, esFecha, esHora, sumarDias } from './fechas'
import { aMinutos, diaDe, huecos, MOTIVOS_BLOQUEO, type DatosAgenda } from './turnos'

export type DatosBloqueo = {
  desde: string; hasta: string; hora_desde: string | null; hora_hasta: string | null; consultorio_id: number | null; motivo: string | null
}

export const MAX_DIAS_BLOQUEO = 366
export const CUANTOS_HORARIOS = 3

const numero = (v: unknown) => (typeof v === 'string' && /^\d{1,9}$/.test(v) ? Number(v) : 0)

/** Valida el formulario de «Bloquear la agenda». Devuelve el primer problema, si lo hay. */
export function leerBloqueo(f: Record<string, unknown>, hoy: string): { datos?: DatosBloqueo; error?: string } {
  const texto = (k: string) => (typeof f[k] === 'string' ? (f[k] as string) : '')
  const desde = texto('desde'), hasta = texto('hasta')
  if (!esFecha(desde) || !esFecha(hasta)) return { error: 'Elegí desde qué día y hasta qué día.' }
  if (hasta < desde) return { error: 'El «hasta» no puede ser antes del «desde».' }
  if (hasta < hoy) return { error: 'Esas fechas ya pasaron.' }
  if (sumarDias(desde, MAX_DIAS_BLOQUEO) < hasta) return { error: 'Un bloqueo puede durar hasta un año. Hacé uno nuevo para lo que sigue.' }
  let hora_desde: string | null = null, hora_hasta: string | null = null
  if (texto('alcance') === 'franja') {
    hora_desde = texto('hora_desde'); hora_hasta = texto('hora_hasta')
    if (!esHora(hora_desde) || !esHora(hora_hasta)) return { error: 'Elegí desde qué hora y hasta qué hora.' }
    if (hora_desde >= hora_hasta) return { error: 'La hora de fin tiene que ser después de la de inicio.' }
  }
  const consultorio_id = texto('consultorio') === 'todos' || !texto('consultorio') ? null : numero(f.consultorio)
  if (consultorio_id === 0) return { error: 'Ese consultorio no existe.' }
  const motivo = texto('motivo')
  if (motivo && !(motivo in MOTIVOS_BLOQUEO)) return { error: 'Ese motivo no existe.' }
  return { datos: { desde, hasta, hora_desde, hora_hasta, consultorio_id, motivo: motivo || null } }
}

export type TurnoEnBloqueo = {
  id: number; fecha: string; hora: string; duracion_min: number; consultorio_id: number; consultorio: string
  nombre: string; apellido: string; celular: string; prestacion: string | null; atencion: string
}

/** Turnos confirmados que quedan dentro de un bloqueo y todavía no pasaron. */
export async function turnosEnBloqueo(db: D1Database, b: DatosBloqueo, hoy: string, ahoraMin: number): Promise<TurnoEnBloqueo[]> {
  const r = await db.prepare(
    `SELECT t.id, t.fecha, t.hora, t.duracion_min, t.consultorio_id, co.nombre consultorio, p.nombre, p.apellido, p.celular, pr.nombre prestacion, t.atencion
       FROM turnos t JOIN pacientes p ON p.id = t.paciente_id JOIN consultorios co ON co.id = t.consultorio_id
       LEFT JOIN prestaciones pr ON pr.id = t.prestacion_id
      WHERE t.estado = 'confirmado' AND t.fecha BETWEEN ? AND ? AND t.fecha >= ? AND (? IS NULL OR t.consultorio_id = ?)
      ORDER BY t.fecha, t.hora`).bind(b.desde, b.hasta, hoy, b.consultorio_id, b.consultorio_id).all<TurnoEnBloqueo>()
  return (r.results ?? []).filter((t) => {
    const ini = aMinutos(t.hora), fin = ini + t.duracion_min
    if (t.fecha === hoy && fin <= ahoraMin) return false
    return !b.hora_desde || !b.hora_hasta || (ini < aMinutos(b.hora_hasta) && aMinutos(b.hora_desde) < fin)
  })
}

export const MOTIVO_TEXTO = (m: string | null) => (m && MOTIVOS_BLOQUEO[m]) || null

/** «lun 10/11» */
export const diaCorto = (f: string) => `${DIAS[new Date(f + 'T00:00:00Z').getUTCDay()].slice(0, 3)} ${Number(f.slice(8))}/${Number(f.slice(5, 7))}`
/** «10/11» o «10 al 14/11» o «30/10 al 3/11» */
export function rangoCorto(desde: string, hasta: string) {
  const d = Number(desde.slice(8)), m = Number(desde.slice(5, 7)), d2 = Number(hasta.slice(8)), m2 = Number(hasta.slice(5, 7))
  if (desde === hasta) return `${d}/${m}`
  return m === m2 ? `${d} al ${d2}/${m2}` : `${d}/${m} al ${d2}/${m2}`
}
/** «lun 10/11 · 9:00» */
export const cuandoCorto = (fecha: string, hora: string) => `${diaCorto(fecha)} · ${Number(hora.slice(0, 2))}:${hora.slice(3)}`

export type Horario = { fecha: string; hora: string }

/**
 * Los primeros huecos libres para mover un turno, cerca de la hora de siempre: un horario por día, de los primeros días con lugar.
 * `datos` ya trae el bloqueo (no se ofrece nada adentro) y no debe incluir al propio turno.
 */
export function sugerirHorarios(
  datos: DatosAgenda, consultorioId: number, duracion: number, desdeFecha: string, horaDeSiempre: string, hoy: string, ahoraMin: number,
  cuantos = CUANTOS_HORARIOS, dias = 60, desdeMin = 0,
): Horario[] {
  const querida = aMinutos(horaDeSiempre)
  const salida: Horario[] = []
  for (let i = 0; i <= dias && salida.length < cuantos; i++) {
    const fecha = sumarDias(desdeFecha < hoy ? hoy : desdeFecha, i)
    const libres = huecos(diaDe(datos, consultorioId, fecha), duracion, hoy, ahoraMin).filter(h => fecha !== desdeFecha || aMinutos(h) >= desdeMin)
    if (!libres.length) continue
    const mejor = libres.reduce((a, b) => (Math.abs(aMinutos(b) - querida) < Math.abs(aMinutos(a) - querida) ? b : a))
    salida.push({ fecha, hora: mejor })
  }
  return salida
}

/** «Hola Ana, tuvimos que mover tu turno del … Elegí uno: 1) … 2) … 3) …» */
export function mensajeParaElegir(nombre: string, cuando: string, opciones: string[], firma: string) {
  return `Hola ${nombre}, tuvimos que mover tu turno del ${cuando}. ¿Cuál de estos horarios te queda mejor? ${opciones.map((o, i) => `${i + 1}) ${o}`).join(' · ')}. Respondeme con el número.${firma} ¡Gracias!`
}
