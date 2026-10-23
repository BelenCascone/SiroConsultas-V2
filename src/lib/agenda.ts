// P2 · Agenda: horarios de atención, huecos libres, choques (superposición, fuera de horario, bloqueos y feriados),
// turnos que se repiten y el estado que se ve en la grilla. Fechas y horas de Argentina («AAAA-MM-DD», «HH:MM»).
import { sumarDias } from './fechas'

// ---------- Fechas y horas ----------
const aUTC = (iso: string) => new Date(iso + 'T00:00:00Z')
/** 1 = lunes … 7 = domingo (como la tabla horarios). */
export const diaSemana = (iso: string) => ((aUTC(iso).getUTCDay() + 6) % 7) + 1
export const lunesDe = (iso: string) => sumarDias(iso, 1 - diaSemana(iso))
export const primeroDelMes = (iso: string) => iso.slice(0, 8) + '01'
export function sumarMeses(iso: string, n: number) {
  const d = aUTC(primeroDelMes(iso))
  d.setUTCMonth(d.getUTCMonth() + n)
  return d.toISOString().slice(0, 10)
}
export const finDelMes = (iso: string) => sumarDias(sumarMeses(iso, 1), -1)
export const minutos = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))
export const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

const DIAS_CORTO = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const DIAS_LARGO = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
/** «Lun 27/10» */
export const fechaDia = (iso: string) => `${DIAS_CORTO[diaSemana(iso) - 1]} ${Number(iso.slice(8))}/${Number(iso.slice(5, 7))}`
/** «lunes 27 de octubre» */
export const fechaConDia = (iso: string) => `${DIAS_LARGO[diaSemana(iso) - 1]} ${Number(iso.slice(8))} de ${MESES[Number(iso.slice(5, 7)) - 1]}`
export const nombreMes = (iso: string) => `${MESES[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`
export const diaCorto = (iso: string) => DIAS_CORTO[diaSemana(iso) - 1]

// ---------- Datos de la agenda ----------
export type Consultorio = { id: number; nombre: string; modalidad: string; activo: number }
export type Franja = { consultorio_id: number; dia: number; desde: string; hasta: string }
export type TurnoAgenda = {
  id: number; paciente_id: number; nombre: string; apellido: string; celular: string; consultorio_id: number; consultorio: string
  fecha: string; hora: string; duracion_min: number; prestacion: string | null; estado: string; confirmacion: string | null
  cancelado_por: string | null; modalidad: string; serie_id: number | null; veces: number; saldo: number; con_cobro: number
}
export type Bloqueo = { id: number; desde: string; hasta: string; hora_desde: string | null; hora_hasta: string | null; consultorio_id: number | null; motivo: string | null; detalle: string | null }
export type Feriado = { fecha: string; nombre: string; atiende: number | null }

export type DatosAgenda = {
  consultorios: Consultorio[]
  franjas: Franja[]
  turnos: TurnoAgenda[]
  bloqueos: Bloqueo[]
  feriados: Map<string, Feriado>
  pedidos: Map<string, number>
}

/** Todo lo que la agenda necesita para mostrar del día «desde» al «hasta» (incluidos). Los turnos cancelados no se cargan. */
export async function cargarAgenda(db: D1Database, desde: string, hasta: string): Promise<DatosAgenda> {
  const [consultorios, franjas, turnos, bloqueos, feriados, pedidos] = await Promise.all([
    db.prepare('SELECT id, nombre, modalidad, activo FROM consultorios ORDER BY orden, nombre').all<Consultorio>(),
    db.prepare('SELECT h.consultorio_id, h.dia, h.desde, h.hasta FROM horarios h JOIN consultorios c ON c.id = h.consultorio_id WHERE c.activo = 1 ORDER BY h.desde').all<Franja>(),
    db.prepare(
      `SELECT t.id, t.paciente_id, p.nombre, p.apellido, p.celular, t.consultorio_id, c.nombre consultorio, t.fecha, t.hora, t.duracion_min,
              pr.nombre prestacion, t.estado, t.confirmacion, t.cancelado_por, t.modalidad, t.serie_id,
              (SELECT COUNT(*) FROM turnos t2 WHERE t2.paciente_id = t.paciente_id AND t2.estado = 'atendido' AND (t2.fecha < t.fecha OR (t2.fecha = t.fecha AND t2.hora < t.hora))) veces,
              COALESCE((SELECT SUM(vc.saldo) FROM v_cobros vc WHERE vc.turno_id = t.id), 0) saldo,
              EXISTS (SELECT 1 FROM cobros cb WHERE cb.turno_id = t.id AND cb.anulado_en IS NULL) con_cobro
         FROM turnos t JOIN pacientes p ON p.id = t.paciente_id JOIN consultorios c ON c.id = t.consultorio_id
         LEFT JOIN prestaciones pr ON pr.id = t.prestacion_id
        WHERE t.fecha BETWEEN ? AND ? AND t.estado <> 'cancelado' ORDER BY t.fecha, t.hora`
    ).bind(desde, hasta).all<TurnoAgenda>(),
    db.prepare('SELECT id, desde, hasta, hora_desde, hora_hasta, consultorio_id, motivo, detalle FROM bloqueos WHERE quitado_en IS NULL AND desde <= ? AND hasta >= ?')
      .bind(hasta, desde).all<Bloqueo>(),
    db.prepare('SELECT fecha, nombre, atiende FROM feriados WHERE fecha BETWEEN ? AND ?').bind(desde, hasta).all<Feriado>(),
    db.prepare(`SELECT fecha, COUNT(*) n FROM pedidos WHERE estado = 'pendiente' AND fecha BETWEEN ? AND ? GROUP BY fecha`).bind(desde, hasta).all<{ fecha: string; n: number }>(),
  ])
  return {
    consultorios: consultorios.results ?? [],
    franjas: franjas.results ?? [],
    turnos: turnos.results ?? [],
    bloqueos: bloqueos.results ?? [],
    feriados: new Map((feriados.results ?? []).map((f) => [f.fecha, f])),
    pedidos: new Map((pedidos.results ?? []).map((p) => [p.fecha, p.n])),
  }
}

/** Franjas de atención de ese día (de un consultorio o de todos). */
export const franjasDelDia = (franjas: Franja[], fecha: string, consultorio: number | null) =>
  franjas.filter((f) => f.dia === diaSemana(fecha) && (consultorio === null || f.consultorio_id === consultorio))

/** Bloqueo que tapa ese momento (o todo el día si no se pasa hora). */
export function bloqueoEn(bloqueos: Bloqueo[], fecha: string, consultorio: number | null, desde?: number, hasta?: number) {
  return bloqueos.find((b) => b.desde <= fecha && b.hasta >= fecha
    && (b.consultorio_id === null || consultorio === null || b.consultorio_id === consultorio)
    && (b.hora_desde === null || desde === undefined || (minutos(b.hora_desde) < (hasta ?? desde + 1) && minutos(b.hora_hasta!) > desde))) ?? null
}

/** Feriado en el que la profesional no atiende (si no dijo nada, no atiende). */
export const feriadoSinAtencion = (feriados: Map<string, Feriado>, fecha: string) => {
  const f = feriados.get(fecha)
  return f && f.atiende !== 1 ? f : null
}

const pisa = (a: number, aDur: number, b: number, bDur: number) => a < b + bDur && b < a + aDur

/** Huecos libres de un día: dentro del horario, sin turno (de ningún consultorio: la profesional es una sola),
 *  sin bloqueo ni feriado sin atención y, si es hoy, desde la hora actual. Pasos de «paso» minutos. */
export function huecosDelDia(d: DatosAgenda, fecha: string, consultorio: number | null, ahora: { fecha: string; hora: string }, paso = 30, duracion = paso) {
  if (fecha < ahora.fecha || feriadoSinAtencion(d.feriados, fecha)) return []
  const ocupados = d.turnos.filter((t) => t.fecha === fecha && t.estado !== 'cancelado').map((t) => [minutos(t.hora), t.duracion_min] as const)
  const vistos = new Set<string>()
  const huecos: { hora: string; consultorio_id: number }[] = []
  for (const f of franjasDelDia(d.franjas, fecha, consultorio)) {
    for (let m = minutos(f.desde); m + duracion <= minutos(f.hasta); m += paso) {
      const hora = hhmm(m)
      if (vistos.has(hora)) continue
      if (fecha === ahora.fecha && hora <= ahora.hora) continue
      if (ocupados.some(([o, dur]) => pisa(m, duracion, o, dur))) continue
      if (bloqueoEn(d.bloqueos, fecha, f.consultorio_id, m, m + duracion)) continue
      vistos.add(hora)
      huecos.push({ hora, consultorio_id: f.consultorio_id })
    }
  }
  return huecos.sort((a, b) => a.hora.localeCompare(b.hora))
}

/** Minutos de atención de un día (para la barra de ocupación del mes). */
export const minutosDeAtencion = (franjas: Franja[], fecha: string, consultorio: number | null) =>
  franjasDelDia(franjas, fecha, consultorio).reduce((s, f) => s + minutos(f.hasta) - minutos(f.desde), 0)

// ---------- Choques al dar o mover un turno ----------
export type Choques = {
  superpuestos: { id: number; nombre: string; hora: string }[]
  fueraDeHorario: boolean
  bloqueo: Bloqueo | null
  feriado: Feriado | null
  pasado: boolean
}
export const hayChoques = (c: Choques) => c.superpuestos.length > 0 || c.fueraDeHorario || !!c.bloqueo || !!c.feriado || c.pasado

/** Lo que la profesional tiene que confirmar antes de guardar: avisa y deja seguir (es su agenda). */
export async function buscarChoques(db: D1Database, t: { fecha: string; hora: string; duracion: number; consultorio_id: number; excluir?: number[] }, ahora: { fecha: string; hora: string }): Promise<Choques> {
  const d = await cargarAgenda(db, t.fecha, t.fecha)
  const m = minutos(t.hora)
  const excluir = new Set(t.excluir ?? [])
  const superpuestos = d.turnos
    .filter((x) => x.fecha === t.fecha && !excluir.has(x.id) && pisa(m, t.duracion, minutos(x.hora), x.duracion_min))
    .map((x) => ({ id: x.id, nombre: `${x.nombre} ${x.apellido}`, hora: x.hora }))
  const dentro = franjasDelDia(d.franjas, t.fecha, t.consultorio_id).some((f) => minutos(f.desde) <= m && m + t.duracion <= minutos(f.hasta))
  return {
    superpuestos,
    fueraDeHorario: !dentro,
    bloqueo: bloqueoEn(d.bloqueos, t.fecha, t.consultorio_id, m, m + t.duracion),
    feriado: feriadoSinAtencion(d.feriados, t.fecha),
    pasado: t.fecha < ahora.fecha || (t.fecha === ahora.fecha && t.hora < ahora.hora),
  }
}

export function textosChoques(c: Choques, fecha: string) {
  const t: string[] = []
  if (c.pasado) t.push('Ese horario ya pasó.')
  for (const s of c.superpuestos) t.push(`Se superpone con el turno de ${s.nombre} a las ${s.hora}.`)
  if (c.fueraDeHorario) t.push('Queda fuera de tu horario en ese consultorio.')
  if (c.bloqueo) t.push(`El ${fechaConDia(fecha)} bloqueaste la agenda${c.bloqueo.motivo ? ` (${c.bloqueo.motivo})` : ''}.`)
  if (c.feriado) t.push(`El ${fechaConDia(fecha)} es feriado (${c.feriado.nombre}) y no atendés.`)
  return t
}

// ---------- Turnos que se repiten ----------
export const MAX_REPETICIONES = 52

/** Fechas de la serie: la primera y las siguientes cada N semanas hasta la fecha final (incluida). */
export function fechasSerie(fecha: string, cadaSemanas: number, hasta: string) {
  const fechas = [fecha]
  for (let f = sumarDias(fecha, cadaSemanas * 7); f <= hasta && fechas.length < MAX_REPETICIONES; f = sumarDias(f, cadaSemanas * 7)) fechas.push(f)
  return fechas
}

// ---------- Estado que se ve en la grilla ----------
export type EstadoVisual = 'ahora' | 'confirmo' | 'sin_confirmar' | 'no_puede' | 'pedido' | 'atendido' | 'para_cobrar' | 'ausente' | 'para_mover' | 'para_resolver'

export const TEXTO_ESTADO: Record<EstadoVisual, string> = {
  ahora: 'Ahora', confirmo: 'Confirmó', sin_confirmar: 'Sin confirmar', no_puede: 'No puede venir', pedido: 'Pedido online',
  atendido: 'Atendido', para_cobrar: 'Atendido, falta cobrar', ausente: 'Ausente', para_mover: 'Para mover', para_resolver: 'Sin registrar',
}
/** Clase de la marca de estado (componente Estado) para cada estado de la grilla. */
export const MARCA_ESTADO: Record<EstadoVisual, string> = {
  ahora: 'confirmado', confirmo: 'confirmado', sin_confirmar: 'sin_respuesta', no_puede: 'ausente', pedido: 'solicitado',
  atendido: 'atendido', para_cobrar: 'debe', ausente: 'ausente', para_mover: 'ausente', para_resolver: 'debe',
}

export function estadoVisual(t: TurnoAgenda, ahora: { fecha: string; hora: string }, bloqueado: boolean, cobros: boolean): EstadoVisual {
  if (t.estado === 'solicitado') return 'pedido'
  if (t.estado === 'atendido') return cobros && (t.saldo > 0 || !t.con_cobro) ? 'para_cobrar' : 'atendido'
  if (t.estado === 'ausente') return 'ausente'
  const fin = minutos(t.hora) + t.duracion_min
  if (t.fecha < ahora.fecha || (t.fecha === ahora.fecha && fin <= minutos(ahora.hora))) return 'para_resolver'
  if (bloqueado) return 'para_mover'
  if (t.fecha === ahora.fecha && minutos(t.hora) <= minutos(ahora.hora) + 15) return 'ahora'
  if (t.confirmacion === 'no_puedo') return 'no_puede'
  if (t.confirmacion === 'voy') return 'confirmo'
  return 'sin_confirmar'
}

/** «Tomás F.» */
export const nombreCorto = (nombre: string, apellido: string) => `${nombre.split(' ')[0]} ${apellido[0] ?? ''}.`

/** Mensaje de WhatsApp para el paciente. Solo nombre, día, hora y lugar: nunca datos clínicos. */
export function mensajeTurno(tipo: 'nuevo' | 'movido' | 'cancelado' | 'recordatorio', t: { nombre: string; fecha: string; hora: string; lugar: string }, plantilla?: string | null) {
  const dia = fechaConDia(t.fecha)
  if (tipo === 'recordatorio' && plantilla) {
    return plantilla.replaceAll('{nombre}', t.nombre).replaceAll('{dia}', dia).replaceAll('{hora}', t.hora).replaceAll('{lugar}', t.lugar)
  }
  const textos = {
    nuevo: `Hola ${t.nombre}, te confirmo tu turno el ${dia} a las ${t.hora} en ${t.lugar}.`,
    movido: `Hola ${t.nombre}, te aviso que tu turno pasó al ${dia} a las ${t.hora} en ${t.lugar}.`,
    cancelado: `Hola ${t.nombre}, te aviso que se canceló tu turno del ${dia} a las ${t.hora}.`,
    recordatorio: `Hola ${t.nombre}, te recuerdo tu turno el ${dia} a las ${t.hora} en ${t.lugar}.`,
  }
  return textos[tipo]
}
