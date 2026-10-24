// Hoy: lo que hay que mirar ahora (el turno que sigue), lo que quedó sin resolver y los controles por agendar.
import { DIAS, sumarDias } from './fechas'
import { lunesDe } from './agenda'
import { aMinutos } from './turnos'
import { TURNOS_PENDIENTES_EN_BLOQUEO, turnosEnBloqueo, cuandoCorto, diaCorto, rangoCorto } from './bloqueos'

export type TurnoHoy = {
  id: number; fecha: string; hora: string; duracion_min: number; estado: string; confirmacion: string | null; paciente_id: number
  nombre: string; apellido: string; prestacion: string | null; consultorio: string; modalidad: string; cobertura: string; obra_social: string | null
  incompleta: number; primera: number; consulta_id: number | null; consulta_estado: string | null
}

export async function turnosDeHoy(db: D1Database, hoy: string) {
  const r = await db.prepare(
    `SELECT t.id, t.fecha, t.hora, t.duracion_min, t.estado, t.confirmacion, t.paciente_id, p.nombre, p.apellido, pr.nombre prestacion,
            co.nombre consultorio, t.modalidad, t.cobertura, os.nombre obra_social,
            (p.fecha_nacimiento IS NULL OR p.domicilio IS NULL OR p.ocupacion IS NULL OR p.cobertura IS NULL) incompleta,
            NOT EXISTS (SELECT 1 FROM turnos t2 WHERE t2.paciente_id = t.paciente_id AND t2.estado = 'atendido' AND t2.id <> t.id) primera,
            c.id consulta_id, c.estado consulta_estado
       FROM turnos t JOIN pacientes p ON p.id = t.paciente_id JOIN consultorios co ON co.id = t.consultorio_id
       LEFT JOIN prestaciones pr ON pr.id = t.prestacion_id LEFT JOIN obras_sociales os ON os.id = t.obra_social_id
       LEFT JOIN consultas c ON c.turno_id = t.id
      WHERE t.fecha = ? AND t.estado <> 'cancelado' ORDER BY t.hora, t.id`).bind(hoy).all<TurnoHoy>()
  return r.results ?? []
}

/** «12 minutos», «1 h 20 min» */
export function duracionTxt(min: number) {
  if (min < 60) return min === 1 ? '1 minuto' : `${min} minutos`
  const h = Math.floor(min / 60), m = min % 60
  return m ? `${h} h ${m} min` : `${h} h`
}

export type Ahora =
  | { tipo: 'consulta'; turno: TurnoHoy }
  | { tipo: 'curso' | 'proximo' | 'sin_resolver'; turno: TurnoHoy; cuando: string }
  | null

/** El turno de la tarjeta «Ahora»: la consulta abierta, el que está pasando, el que sigue o el que quedó sin resolver. */
export function elegirAhora(turnos: TurnoHoy[], ahoraMin: number): Ahora {
  const enConsulta = turnos.find((t) => t.estado === 'atendido' && (t.consulta_id === null || t.consulta_estado === 'borrador'))
  if (enConsulta) return { tipo: 'consulta', turno: enConsulta }
  const abiertos = turnos.filter((t) => t.estado === 'confirmado')
  const ini = (t: TurnoHoy) => aMinutos(t.hora)
  const curso = abiertos.find((t) => ini(t) <= ahoraMin && ahoraMin < ini(t) + t.duracion_min)
  if (curso) return { tipo: 'curso', turno: curso, cuando: `Empezó hace ${duracionTxt(ahoraMin - ini(curso))}`.replace('hace 0 minutos', 'recién') }
  const proximo = abiertos.find((t) => ini(t) > ahoraMin)
  if (proximo) return { tipo: 'proximo', turno: proximo, cuando: `En ${duracionTxt(ini(proximo) - ahoraMin)}` }
  const tarde = abiertos.find((t) => ini(t) + t.duracion_min <= ahoraMin)
  if (tarde) return { tipo: 'sin_resolver', turno: tarde, cuando: `Era a las ${tarde.hora}` }
  return null
}

export type Pendiente = { texto: string; href: string; tono: 'pedido' | 'ausente' | 'debe' | 'primera' }

const cuandoSeDice = (fecha: string, hoy: string) => fecha === hoy ? 'hoy' : fecha === sumarDias(hoy, 1) ? 'mañana' : `el ${diaCorto(fecha)}`
const corto = (p: { nombre: string; apellido: string }) => `${p.nombre.split(' ')[0]} ${p.apellido[0]}.`
const turnoUrl = (t: { fecha: string; id: number }) => `/agenda?vista=dia&fecha=${t.fecha}&turno=${t.id}`

/** Las pastillas «Para resolver»: pedidos online, quien no puede ir, turnos sin resolver, bloqueos con turnos y feriados sin decidir. */
export async function paraResolver(db: D1Database, hoy: string, ahoraMin: number): Promise<Pendiente[]> {
  const salida: Pendiente[] = []
  type T = { id: number; fecha: string; hora: string; nombre: string; apellido: string }
  const [pedidos, noPuede, sinResolver, bloqueos, feriados] = await Promise.all([
    db.prepare(`SELECT t.id, t.fecha, t.hora, p.nombre, p.apellido FROM turnos t JOIN pacientes p ON p.id = t.paciente_id
                 WHERE t.estado = 'solicitado' AND t.fecha >= ? ORDER BY t.fecha, t.hora`).bind(hoy).all<T>(),
    db.prepare(`SELECT t.id, t.fecha, t.hora, p.nombre, p.apellido FROM turnos t JOIN pacientes p ON p.id = t.paciente_id
                 WHERE t.estado = 'confirmado' AND t.confirmacion = 'no_puedo' AND t.fecha >= ? ORDER BY t.fecha, t.hora LIMIT 3`).bind(hoy).all<T>(),
    db.prepare(`SELECT t.id, t.fecha, t.hora, t.duracion_min FROM turnos t WHERE t.estado = 'confirmado' AND t.fecha <= ? ORDER BY t.fecha, t.hora`).bind(hoy)
      .all<{ id: number; fecha: string; hora: string; duracion_min: number }>(),
    db.prepare(`SELECT id, desde, hasta, hora_desde, hora_hasta, consultorio_id, motivo FROM bloqueos b WHERE quitado_en IS NULL AND (hasta >= ? OR ${TURNOS_PENDIENTES_EN_BLOQUEO}) ORDER BY desde LIMIT 10`).bind(hoy)
      .all<{ id: number; desde: string; hasta: string; hora_desde: string | null; hora_hasta: string | null; consultorio_id: number | null; motivo: string | null }>(),
    db.prepare('SELECT fecha FROM feriados WHERE atiende IS NULL AND fecha BETWEEN ? AND ? ORDER BY fecha LIMIT 2').bind(hoy, sumarDias(hoy, 30)).all<{ fecha: string }>(),
  ])
  const ped = pedidos.results ?? []
  if (ped.length === 1) salida.push({ texto: `${corto(ped[0])} pidió turno · ${cuandoCorto(ped[0].fecha, ped[0].hora)}`, href: turnoUrl(ped[0]), tono: 'pedido' })
  else if (ped.length > 1) salida.push({ texto: `${ped.length} pedidos de turno online`, href: turnoUrl(ped[0]), tono: 'pedido' })
  for (const t of noPuede.results ?? []) salida.push({ texto: `${corto(t)} no puede ir ${cuandoSeDice(t.fecha, hoy)}`, href: turnoUrl(t), tono: 'ausente' })
  const pasados = (sinResolver.results ?? []).filter((t) => t.fecha < hoy || aMinutos(t.hora) + t.duracion_min <= ahoraMin)
  if (pasados.length) salida.push({ texto: pasados.length === 1 ? '1 turno sin resolver' : `${pasados.length} turnos sin resolver`, href: `/agenda?vista=dia&fecha=${pasados[0].fecha}`, tono: 'debe' })
  for (const b of bloqueos.results ?? []) {
    const n = (await turnosEnBloqueo(db, b)).length
    if (n) salida.push({ texto: `Bloqueo del ${rangoCorto(b.desde, b.hasta)}: ${n === 1 ? 'falta resolver 1 turno' : `faltan resolver ${n} turnos`}`, href: `/bloqueos/${b.id}`, tono: 'debe' })
  }
  for (const f of feriados.results ?? []) {
    const d = DIAS[new Date(f.fecha + 'T00:00:00Z').getUTCDay()]
    salida.push({ texto: `${d[0].toUpperCase()}${d.slice(1)} ${Number(f.fecha.slice(8))}/${Number(f.fecha.slice(5, 7))} es feriado: ¿atendés?`, href: '/bloqueos/nuevo#feriados', tono: 'primera' })
  }
  return salida
}

export type Control = { paciente_id: number; nombre: string; apellido: string; control: string }

/** Pacientes con próximo control indicado que todavía no tienen turno (los vencidos primero). */
export async function controlesPorAgendar(db: D1Database, hoy: string) {
  const r = await db.prepare(
    `WITH base AS (
       SELECT p.id paciente_id, p.nombre, p.apellido,
              (SELECT c.proximo_control FROM consultas c WHERE c.paciente_id = p.id AND c.estado = 'finalizada'
                ORDER BY c.finalizada_en DESC, c.id DESC LIMIT 1) control
         FROM pacientes p
        WHERE p.baja_en IS NULL AND NOT EXISTS (SELECT 1 FROM turnos t WHERE t.paciente_id = p.id AND t.estado IN ('confirmado', 'solicitado') AND t.fecha >= ?)
     ) SELECT paciente_id, nombre, apellido, control FROM base WHERE control IS NOT NULL ORDER BY control, apellido`).bind(hoy).all<Control>()
  return r.results ?? []
}

/** «Venció el 15/10» o «Semana del 3/11» */
export function cuandoControl(control: string, hoy: string) {
  if (control < hoy) return { texto: `Venció el ${Number(control.slice(8))}/${Number(control.slice(5, 7))}`, vencido: true }
  const l = lunesDe(control)
  return { texto: `Semana del ${Number(l.slice(8))}/${Number(l.slice(5, 7))}`, vencido: false }
}
