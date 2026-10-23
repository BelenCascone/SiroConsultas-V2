// Fechas de la agenda: «AAAA-MM-DD» y «HH:MM» en horario de Argentina (UTC−3, sin cambio de hora).

export const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

const AR_MS = -3 * 3600_000
const aUTC = (iso: string) => new Date(iso + 'T00:00:00Z')
const isoDe = (d: Date) => d.toISOString().slice(0, 10)

/** Fecha y hora actuales de Argentina. */
export function ahoraAR(ms = Date.now()) {
  const d = new Date(ms + AR_MS)
  return { fecha: isoDe(d), hora: d.toISOString().slice(11, 16), horaNum: d.getUTCHours() }
}
/** Marca de tiempo UTC en ISO sin milisegundos, igual que la base. */
export const ahoraISO = (ms = Date.now()) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')

export const esFecha = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && isoDe(aUTC(s)) === s
export const esHora = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s)
export const sumarDias = (iso: string, n: number) => { const d = aUTC(iso); d.setUTCDate(d.getUTCDate() + n); return isoDe(d) }

/** «Jueves 23 de octubre» */
export function fechaLarga(iso: string) {
  const d = aUTC(iso)
  const dia = DIAS[d.getUTCDay()]
  return `${dia[0].toUpperCase()}${dia.slice(1)} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]}`
}

/** «Buen día», «Buenas tardes» o «Buenas noches» según la hora de Argentina. */
export function saludo(hora: number) {
  return hora < 13 ? 'Buen día' : hora < 20 ? 'Buenas tardes' : 'Buenas noches'
}
