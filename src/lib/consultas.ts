// X2 · Clínica: validación, identidad del borrador y operaciones con control de versión.
import { firmar, verificar } from './firma'
import { ahoraAR, ahoraISO, esFecha } from './fechas'

export class ErrorConsulta extends Error {
  constructor(message: string, public estado: 400 | 404 | 409 | 422 = 422) { super(message) }
}
export const ANTECEDENTES = [
  ['personales', 'Enfermedades', 4000], ['alergias', 'Alergias', 2000],
  ['medicacion', 'Medicación que toma', 2000], ['familiares', 'Familiares', 4000],
] as const
export const MEDICIONES = [
  ['presion', 'Presión', 'mmHg'], ['frecuencia_cardiaca', 'Pulso', 'lpm'], ['temperatura', 'Temperatura', '°C'],
  ['peso', 'Peso', 'kg'], ['talla', 'Talla', 'm'], ['saturacion', 'Saturación', '%'],
  ['glucemia', 'Glucemia', 'mg/dL'], ['perimetro_cintura', 'Perímetro de cintura', 'cm'],
] as const
export type TipoMedicion = typeof MEDICIONES[number][0]
export type Antecedentes = Record<typeof ANTECEDENTES[number][0], string>
export type DatosClinicos = { antecedentes: Antecedentes; signos: Partial<Record<TipoMedicion, string>> }
export type PacienteConsulta = {
  id: number; dni: string; nombre: string; apellido: string; celular: string; correo: string | null
  fecha_nacimiento: string | null; domicilio: string | null; ocupacion: string | null; cobertura: string | null
  obra_social_id: number | null; numero_afiliado: string | null; obra_social: string | null; baja_en: string | null
}
export type Consulta = {
  id: number; paciente_id: number; turno_id: number | null; consultorio_id: number | null
  tipo: 'primera' | 'control'; estado: 'borrador' | 'finalizada' | 'descartada'; version: number
  motivo: string | null; antecedentes_texto: string | null; examen: string | null; plan: string | null
  proximo_control: string | null; foto: string | null; finalizada_en: string | null; creado_en: string
  descarte_motivo: string | null
}
export type ContextoConsulta = { id: number; paciente: number; turno: number | null }
export const idNuevo = () => {
  const b = crypto.getRandomValues(new Uint8Array(6))
  return b.reduce((n, v) => n * 256 + v, 0) + 1
}
export function numero(valor: unknown, cero = false): number {
  if (typeof valor !== 'string' || !/^\d+$/.test(valor) || !Number.isSafeInteger(Number(valor)) || Number(valor) < (cero ? 0 : 1)) throw new ErrorConsulta('Revisá el identificador o la versión.', 400)
  return Number(valor)
}
export function texto(form: FormData, clave: string, max: number, requerido = false) {
  const v = form.get(clave)
  if (v !== null && typeof v !== 'string') throw new ErrorConsulta('Revisá los datos del formulario.')
  const s = (v ?? '').trim()
  if (s.length > max || (requerido && !s)) throw new ErrorConsulta(`Revisá ${clave.replaceAll('_', ' ')}${requerido && !s ? ': falta completar este dato' : ': el texto es demasiado largo'}.`)
  return s
}
export const fechaValida = (v: string) => { try { return esFecha(v) } catch { return false } }
export const fichaIncompleta = (p: PacienteConsulta) => !p.fecha_nacimiento || !p.domicilio || !p.ocupacion || !p.cobertura || (p.cobertura === 'obra_social' && !p.obra_social_id)
export const leerPaciente = (db: D1Database, id: number) => db.prepare('SELECT p.*, o.nombre obra_social FROM pacientes p LEFT JOIN obras_sociales o ON o.id = p.obra_social_id WHERE p.id = ?').bind(id).first<PacienteConsulta>()
export const leerConsulta = (db: D1Database, id: number) => db.prepare('SELECT * FROM consultas WHERE id = ?').bind(id).first<Consulta>()
export const antecedentesVacios = (): Antecedentes => ({ personales: '', alergias: '', medicacion: '', familiares: '' })
export function datosDeConsulta(consulta: Consulta | null): DatosClinicos {
  try {
    const v = JSON.parse(consulta?.antecedentes_texto ?? '{}')
    return { antecedentes: { ...antecedentesVacios(), ...v.antecedentes }, signos: v.signos ?? {} }
  } catch { return { antecedentes: { ...antecedentesVacios(), personales: consulta?.antecedentes_texto ?? '' }, signos: {} } }
}
export async function contextoFirmado(contexto: ContextoConsulta, secreto: string) { return firmar(JSON.stringify(contexto), secreto) }
export async function leerContexto(form: FormData, secreto: string): Promise<ContextoConsulta> {
  const verificado = await verificar(texto(form, 'contexto', 1000, true), secreto)
  let v: ContextoConsulta
  try { v = JSON.parse(verificado ?? '') } catch { throw new ErrorConsulta('Volvé a abrir la consulta desde la ficha.', 400) }
  if (!Number.isSafeInteger(v.id) || !Number.isSafeInteger(v.paciente) || v.id < 1 || v.paciente < 1 || (v.turno !== null && (!Number.isSafeInteger(v.turno) || v.turno < 1))) throw new ErrorConsulta('Revisá la consulta.', 400)
  return v
}
export function validarMedicion(tipo: string, valor: string) {
  if (!MEDICIONES.some(m => m[0] === tipo) || valor.length > 40) throw new ErrorConsulta('Revisá la medición.')
  if (tipo === 'presion') {
    if (!/^\d{2,3}\s*\/\s*\d{2,3}$/.test(valor)) throw new ErrorConsulta('La presión se escribe, por ejemplo, 120/80.')
  } else if (!/^\d{1,4}([.,]\d{1,2})?$/.test(valor) || Number(valor.replace(',', '.')) <= 0 || (tipo === 'saturacion' && Number(valor.replace(',', '.')) > 100)) throw new ErrorConsulta('Revisá la medición: ingresá un valor positivo, con hasta dos decimales.')
}
export function leerDatos(form: FormData) {
  const motivo = texto(form, 'motivo', 8000), examen = texto(form, 'examen', 8000), plan = texto(form, 'plan', 8000)
  const proximo = texto(form, 'proximo_control', 10)
  if (proximo && (!fechaValida(proximo) || proximo < ahoraAR().fecha || proximo > '2999-12-31')) throw new ErrorConsulta('Elegí una fecha válida para el próximo control, desde hoy.')
  const antecedentes = antecedentesVacios()
  for (const [clave, , max] of ANTECEDENTES) antecedentes[clave] = texto(form, clave, max)
  const signos: DatosClinicos['signos'] = {}
  for (const [tipo] of MEDICIONES) {
    const valor = texto(form, `signo_${tipo}`, 40)
    if (valor) { validarMedicion(tipo, valor); signos[tipo] = valor }
  }
  const clinicos = JSON.stringify({ antecedentes, signos })
  if (clinicos.length > 8000) throw new ErrorConsulta('Los antecedentes y signos son demasiado largos para una consulta.')
  return { motivo, examen, plan, proximo, clinicos }
}
export async function pacienteActivo(db: D1Database, id: number, completo = true) {
  const p = await leerPaciente(db, id)
  if (!p) throw new ErrorConsulta('No encontramos al paciente.', 404)
  if (p.baja_en) throw new ErrorConsulta('Paciente dado de baja: la historia es de solo lectura.', 409)
  if (completo && fichaIncompleta(p)) throw new ErrorConsulta('Completá la ficha antes de empezar la consulta.', 409)
  return p
}
export const ACTIVO = `EXISTS (SELECT 1 FROM pacientes p WHERE p.id = consultas.paciente_id AND p.baja_en IS NULL)`
const COMPLETO = `EXISTS (SELECT 1 FROM pacientes p WHERE p.id = ? AND p.baja_en IS NULL AND p.fecha_nacimiento IS NOT NULL AND p.domicilio IS NOT NULL AND p.ocupacion IS NOT NULL AND p.cobertura IS NOT NULL)`
export async function guardarBorrador(db: D1Database, contexto: ContextoConsulta, version: number, form: FormData) {
  await pacienteActivo(db, contexto.paciente)
  const d = leerDatos(form)
  const anterior = await leerConsulta(db, contexto.id)
  if (anterior && (anterior.paciente_id !== contexto.paciente || anterior.turno_id !== contexto.turno)) throw new ErrorConsulta('La consulta no coincide con esta ficha.', 409)
  const consultorio = contexto.turno !== null ? (await db.prepare('SELECT consultorio_id FROM turnos WHERE id = ?').bind(contexto.turno).first<{ consultorio_id: number }>())?.consultorio_id ?? null : texto(form, 'consultorio_id', 16)
  if (contexto.turno === null && consultorio && !await db.prepare('SELECT id FROM consultorios WHERE id = ? AND (activo = 1 OR id = ?)').bind(numero(consultorio), anterior?.consultorio_id ?? -1).first()) throw new ErrorConsulta('Elegí un consultorio activo.')
  if (version === 0) {
    if (contexto.turno !== null) {
      const t = await db.prepare('SELECT estado, paciente_id FROM turnos WHERE id = ?').bind(contexto.turno).first<{ estado: string; paciente_id: number }>()
      if (!t || t.paciente_id !== contexto.paciente || t.estado !== 'atendido') throw new ErrorConsulta('Marcá el turno como atendido antes de empezar.', 409)
    }
    const r = await db.prepare(`INSERT INTO consultas (id, paciente_id, turno_id, consultorio_id, tipo, motivo, antecedentes_texto, examen, plan, proximo_control)
      SELECT ?, ?, ?, ?, COALESCE((SELECT atencion FROM turnos WHERE id = ? AND atencion IN ('primera', 'control')), CASE WHEN EXISTS (SELECT 1 FROM consultas WHERE paciente_id = ? AND estado = 'finalizada') THEN 'control' ELSE 'primera' END), ?, ?, ?, ?, ?
      WHERE ${COMPLETO} AND NOT EXISTS (SELECT 1 FROM consultas WHERE id = ? OR (turno_id = ?) OR (paciente_id = ? AND turno_id IS NULL AND estado = 'borrador' AND ? IS NULL))
      ON CONFLICT DO NOTHING`).bind(contexto.id, contexto.paciente, contexto.turno, consultorio || null, contexto.turno, contexto.paciente, d.motivo || null, d.clinicos, d.examen || null, d.plan || null, d.proximo || null,
      contexto.paciente, contexto.id, contexto.turno, contexto.paciente, contexto.turno).run()
    if (!r.meta.changes) throw new ErrorConsulta('Ya se guardó un borrador en otra pestaña. Tus cambios no se sobrescribieron; abrí la consulta guardada desde la historia.', 409)
    return { id: contexto.id, version: 1 }
  }
  const r = await db.prepare(`UPDATE consultas SET consultorio_id = ?, motivo = ?, antecedentes_texto = ?, examen = ?, plan = ?, proximo_control = ?, version = version + 1, actualizado_en = ?
    WHERE id = ? AND paciente_id = ? AND turno_id IS ? AND estado = 'borrador' AND version = ? AND ${ACTIVO}`)
    .bind(consultorio || null, d.motivo || null, d.clinicos, d.examen || null, d.plan || null, d.proximo || null, ahoraISO(), contexto.id, contexto.paciente, contexto.turno, version).run()
  if (!r.meta.changes) throw new ErrorConsulta('Esta consulta cambió en otra pestaña o ya se cerró. Tus cambios siguen en esta pantalla; no se sobrescribió lo guardado.', 409)
  return { id: contexto.id, version: version + 1 }
}

export async function finalizarConsulta(db: D1Database, consulta: Consulta, version: number, email: string) {
  await pacienteActivo(db, consulta.paciente_id)
  if (!consulta.motivo?.trim() || !consulta.plan?.trim()) throw new ErrorConsulta('Completá el motivo y el plan antes de firmar.')
  const datos = datosDeConsulta(consulta)
  const en = ahoraISO(), operacion = crypto.randomUUID()
  const fotoSql = `json_object('paciente', json((SELECT json_object('id', p.id, 'dni', p.dni, 'nombre', p.nombre, 'apellido', p.apellido, 'celular', p.celular, 'correo', p.correo,
    'fecha_nacimiento', p.fecha_nacimiento, 'domicilio', p.domicilio, 'ocupacion', p.ocupacion, 'cobertura', p.cobertura, 'obra_social_id', p.obra_social_id,
    'obra_social', o.nombre, 'numero_afiliado', p.numero_afiliado) FROM pacientes p LEFT JOIN obras_sociales o ON o.id = p.obra_social_id WHERE p.id = consultas.paciente_id)),
    'grupo_sanguineo', (SELECT grupo_sanguineo FROM antecedentes WHERE paciente_id = consultas.paciente_id ORDER BY id DESC LIMIT 1), 'antecedentes', json(?), 'signos', json(?), 'profesional', json((SELECT json_object('nombre', nombre, 'matricula', matricula, 'especialidad', especialidad) FROM profesional WHERE id = 1)), 'firmada_por', ?, 'operacion', ?)`
  const sentencias: D1PreparedStatement[] = [db.prepare(`UPDATE consultas SET estado = 'finalizada', finalizada_en = ?, foto = ${fotoSql}, version = version + 1, actualizado_en = ?
    WHERE id = ? AND estado = 'borrador' AND version = ? AND ${ACTIVO}`).bind(en, JSON.stringify(datos.antecedentes), JSON.stringify(datos.signos), email, operacion, en, consulta.id, version)]
  // Los efectos leen la foto inmutable del ganador del CAS, nunca los valores de una pestaña que perdió.
  // El identificador de operación impide efectos secundarios si el CAS no ganó.
  for (const [tipo, , unidad] of MEDICIONES) sentencias.push(db.prepare(`INSERT INTO mediciones (paciente_id, consulta_id, tipo, valor, unidad, fecha)
    SELECT paciente_id, id, ?, json_extract(foto, ?), ?, date(finalizada_en, '-3 hours') FROM consultas
    WHERE id = ? AND estado = 'finalizada' AND version = ? AND json_extract(foto, '$.operacion') = ? AND json_extract(foto, ?) IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM mediciones m WHERE m.consulta_id = consultas.id AND m.tipo = ?)`)
    .bind(tipo, `$.signos.${tipo}`, unidad, consulta.id, version + 1, operacion, `$.signos.${tipo}`, tipo))
  sentencias.push(db.prepare(`INSERT INTO antecedentes (paciente_id, ninguno, personales, alergias, medicacion, familiares, grupo_sanguineo)
    SELECT paciente_id, CASE WHEN json_extract(foto, '$.antecedentes.personales') = 'Ninguno' AND json_extract(foto, '$.antecedentes.alergias') = 'Ninguno'
      AND json_extract(foto, '$.antecedentes.medicacion') = 'Ninguno' AND json_extract(foto, '$.antecedentes.familiares') = 'Ninguno' THEN 1 ELSE 0 END,
      json_extract(foto, '$.antecedentes.personales'), json_extract(foto, '$.antecedentes.alergias'), json_extract(foto, '$.antecedentes.medicacion'), json_extract(foto, '$.antecedentes.familiares'), json_extract(foto, '$.grupo_sanguineo')
    FROM consultas WHERE id = ? AND estado = 'finalizada' AND version = ? AND json_extract(foto, '$.operacion') = ?
    AND NOT EXISTS (SELECT 1 FROM antecedentes a WHERE a.id = (SELECT MAX(a2.id) FROM antecedentes a2 WHERE a2.paciente_id = consultas.paciente_id)
      AND a.personales IS json_extract(foto, '$.antecedentes.personales') AND a.alergias IS json_extract(foto, '$.antecedentes.alergias')
      AND a.medicacion IS json_extract(foto, '$.antecedentes.medicacion') AND a.familiares IS json_extract(foto, '$.antecedentes.familiares'))`)
    .bind(consulta.id, version + 1, operacion))
  const r = await db.batch(sentencias)
  if (!r[0].meta.changes) throw new ErrorConsulta('La consulta cambió o ya se firmó. Revisá la versión guardada antes de continuar.', 409)
}
export async function huella(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('')
}
export function fechaTexto(iso: string | null) {
  if (!iso) return '—'
  const fecha = iso.includes('T') ? ahoraAR(Date.parse(iso)).fecha : iso
  return `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}/${fecha.slice(0, 4)}`
}
/** Meses calendario, conservando el día cuando existe (31/1 → 28/2). */
export function controlEnMeses(fecha: string, meses: number) {
  const d = new Date(fecha + 'T00:00:00Z'), dia = d.getUTCDate()
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + meses)
  const ultimo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(dia, ultimo))
  return d.toISOString().slice(0, 10)
}
