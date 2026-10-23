// Pacientes: validación del alta rápida y de la edición, lista con búsqueda, filtros, marcas y orden.
// El DNI es el identificador único (docs/ANALISIS_FUNCIONAL.md, flujo 15).

export const MOTIVOS_BAJA = [
  { valor: 'ya_no_viene', texto: 'Ya no viene' },
  { valor: 'se_mudo', texto: 'Se mudó' },
  { valor: 'fallecio', texto: 'Falleció' },
  { valor: 'duplicada', texto: 'Ficha duplicada' },
  { valor: 'otro', texto: 'Otro' },
] as const

export const textoMotivo = (m: string | null) => MOTIVOS_BAJA.find((x) => x.valor === m)?.texto ?? 'Otro'

// ---------- Validación ----------
export type Errores = Record<string, string>
const limpio = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '')

/** «30.111.222» o «30 111 222» → «30111222». Vacío si tiene otra cosa que números, puntos o espacios. */
export function normalizarDni(v: unknown) {
  const s = limpio(v)
  return /^[\d.\s-]+$/.test(s) ? s.replace(/\D/g, '') : s ? '#' : ''
}

const esCorreo = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)

export type DatosAlta = { dni: string; nombre: string; apellido: string; celular: string; correo: string | null }

/** Alta rápida: DNI, nombre, apellido, celular y correo opcional. */
export function validarAlta(f: Record<string, unknown>): { datos: DatosAlta; errores: Errores } {
  const datos: DatosAlta = {
    dni: normalizarDni(f.dni),
    nombre: limpio(f.nombre),
    apellido: limpio(f.apellido),
    celular: limpio(f.celular),
    correo: limpio(f.correo).toLowerCase() || null,
  }
  const errores: Errores = {}
  if (!datos.dni) errores.dni = 'Falta el DNI.'
  else if (!/^\d{6,10}$/.test(datos.dni)) errores.dni = 'El DNI va con números solamente (entre 6 y 10).'
  if (!datos.nombre) errores.nombre = 'Falta el nombre.'
  else if (datos.nombre.length > 80) errores.nombre = 'El nombre es demasiado largo.'
  if (!datos.apellido) errores.apellido = 'Falta el apellido.'
  else if (datos.apellido.length > 80) errores.apellido = 'El apellido es demasiado largo.'
  const digitos = datos.celular.replace(/\D/g, '')
  if (!datos.celular) errores.celular = 'Falta el celular.'
  else if (digitos.length < 6 || datos.celular.length > 30 || /[^\d\s()+-]/.test(datos.celular)) errores.celular = 'Revisá el celular: van números, con o sin espacios y guiones.'
  if (datos.correo && (!esCorreo(datos.correo) || datos.correo.length > 200)) errores.correo = 'Revisá el correo.'
  return { datos, errores }
}

export type DatosFicha = DatosAlta & {
  fecha_nacimiento: string | null
  domicilio: string | null
  ocupacion: string | null
  cobertura: 'particular' | 'obra_social' | null
  obra_social_id: number | null
  numero_afiliado: string | null
  consultorio_id: number | null
  recordatorios_baja: 0 | 1
}

/** Edición: todos los datos. «cobertura» llega como «particular», «os:<id>» o vacío (sin completar). */
export function validarFicha(f: Record<string, unknown>, hoy: string): { datos: DatosFicha; errores: Errores } {
  const { datos: alta, errores } = validarAlta(f)
  const nac = limpio(f.fecha_nacimiento)
  const cob = limpio(f.cobertura)
  const osId = /^os:\d+$/.test(cob) ? Number(cob.slice(3)) : null
  const cons = limpio(f.consultorio_id)
  const datos: DatosFicha = {
    ...alta,
    fecha_nacimiento: nac || null,
    domicilio: limpio(f.domicilio) || null,
    ocupacion: limpio(f.ocupacion) || null,
    cobertura: cob === 'particular' ? 'particular' : osId ? 'obra_social' : null,
    obra_social_id: osId,
    numero_afiliado: osId ? limpio(f.numero_afiliado) || null : null,
    consultorio_id: /^\d+$/.test(cons) ? Number(cons) : null,
    recordatorios_baja: f.recordatorios === '1' ? 0 : 1,
  }
  if (nac && (!/^\d{4}-\d{2}-\d{2}$/.test(nac) || nac > hoy || nac < '1900-01-01')) errores.fecha_nacimiento = 'Revisá la fecha de nacimiento.'
  if (datos.domicilio && datos.domicilio.length > 200) errores.domicilio = 'El domicilio es demasiado largo.'
  if (datos.ocupacion && datos.ocupacion.length > 120) errores.ocupacion = 'La ocupación es demasiado larga.'
  if (cob && !datos.cobertura) errores.cobertura = 'Elegí la cobertura.'
  if (datos.numero_afiliado && datos.numero_afiliado.length > 60) errores.numero_afiliado = 'El número de afiliado es demasiado largo.'
  return { datos, errores }
}

// ---------- Formatos ----------
export const fechaCorta = (iso: string | null) => (iso ? `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}` : '—')
export const fechaNumeros = (iso: string | null) => (iso ? `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}/${iso.slice(0, 4)}` : '—')

export function edad(nacimiento: string | null, hoy: string) {
  if (!nacimiento) return null
  let anios = Number(hoy.slice(0, 4)) - Number(nacimiento.slice(0, 4))
  if (hoy.slice(5) < nacimiento.slice(5)) anios--
  return anios
}

/** «12.345.678» para mostrar. */
export const dniConPuntos = (dni: string) => dni.replace(/\B(?=(\d{3})+(?!\d))/g, '.')

/** Enlace para escribirle por WhatsApp. Un celular argentino de 10 números (código de área + número) lleva el 549 adelante. */
export function enlaceWhatsapp(celular: string, texto?: string) {
  let n = celular.replace(/\D/g, '')
  if (n.length === 10) n = '549' + n
  return `https://wa.me/${n}${texto ? `?text=${encodeURIComponent(texto)}` : ''}`
}

export const iniciales = (nombre: string, apellido: string) => `${nombre[0] ?? ''}${apellido[0] ?? ''}`.toUpperCase()

// ---------- Lista ----------
export const FILTROS = [
  { id: 'todos', texto: 'Todos' },
  { id: 'deben', texto: 'Te deben' },
  { id: 'control', texto: 'Control vencido' },
  { id: 'sin_turno', texto: 'Sin próximo turno' },
  { id: 'primera', texto: 'Primera consulta' },
  { id: 'incompleta', texto: 'Ficha incompleta' },
  { id: 'baja', texto: 'Dados de baja' },
] as const
export type Filtro = (typeof FILTROS)[number]['id']
export const ORDENES = ['nombre', 'ultimo', 'proximo'] as const
export type Orden = (typeof ORDENES)[number]

export type FilaPaciente = {
  id: number; dni: string; nombre: string; apellido: string; celular: string; baja: number; incompleta: number
  saldo: number; veces: number; faltas: number; ultimo: string | null; proximo: string | null; control: string | null; control_vencido: number
}

const ACENTOS: [string, string][] = [['á', 'a'], ['é', 'e'], ['í', 'i'], ['ó', 'o'], ['ú', 'u'], ['ü', 'u'], ['ñ', 'n'],
  ['Á', 'a'], ['É', 'e'], ['Í', 'i'], ['Ó', 'o'], ['Ú', 'u'], ['Ü', 'u'], ['Ñ', 'n']]
/** Expresión SQL que pasa una columna a minúsculas y sin tildes (SQLite solo baja de mayúscula lo que no tiene tilde). */
const sinTildesSql = (col: string) => ACENTOS.reduce((e, [a, b]) => `replace(${e}, '${a}', '${b}')`, `lower(${col})`)
export const sinTildes = (s: string) => ACENTOS.reduce((e, [a, b]) => e.split(a).join(b), s.toLowerCase())

const sqlLista = (donde: string) => `
    WITH base AS (
      SELECT p.id, p.dni, p.nombre, p.apellido, p.celular, (p.baja_en IS NOT NULL) baja,
        (p.fecha_nacimiento IS NULL OR p.domicilio IS NULL OR p.ocupacion IS NULL OR p.cobertura IS NULL) incompleta,
        COALESCE((SELECT SUM(saldo) FROM v_cobros vc WHERE vc.paciente_id = p.id), 0) saldo,
        (SELECT COUNT(*) FROM turnos t WHERE t.paciente_id = p.id AND t.estado = 'atendido') veces,
        (SELECT COUNT(*) FROM turnos t WHERE t.paciente_id = p.id AND t.estado = 'ausente') faltas,
        (SELECT MAX(t.fecha) FROM turnos t WHERE t.paciente_id = p.id AND t.estado IN ('atendido', 'ausente')) ultimo,
        (SELECT t.fecha || ' ' || t.hora FROM turnos t WHERE t.paciente_id = p.id AND t.estado IN ('confirmado', 'solicitado') AND t.fecha >= ?1
           ORDER BY t.fecha, t.hora LIMIT 1) proximo,
        (SELECT c.proximo_control FROM consultas c WHERE c.paciente_id = p.id AND c.estado = 'finalizada' AND c.proximo_control IS NOT NULL
           ORDER BY c.finalizada_en DESC LIMIT 1) control
      FROM pacientes p
      ${donde}
    )
    SELECT id, dni, nombre, apellido, celular, baja, incompleta, saldo, veces, faltas, ultimo, proximo, control,
      (control IS NOT NULL AND control < ?1 AND proximo IS NULL) control_vencido
    FROM base`

/** Pacientes que coinciden con la búsqueda (nombre y apellido sin importar tildes, DNI o celular), con sus marcas. */
export async function buscarPacientes(db: D1Database, q: string, hoy: string): Promise<FilaPaciente[]> {
  const texto = sinTildes(q.trim()).replace(/\s+/g, ' ')
  const condiciones: string[] = []
  const args: (string | number)[] = [hoy]
  if (texto) {
    for (const palabra of texto.split(' ')) {
      const numero = /^\d+$/.test(palabra.replace(/[.\-]/g, ''))
      args.push(`%${palabra.replace(/[%_]/g, '')}%`)
      const i = args.length
      if (numero) args.push(`%${palabra.replace(/\D/g, '')}%`)
      condiciones.push(`(${sinTildesSql("p.nombre || ' ' || p.apellido")} LIKE ?${i}` +
        (numero ? ` OR p.dni LIKE ?${i + 1} OR replace(replace(replace(replace(replace(p.celular, ' ', ''), '-', ''), '+', ''), '(', ''), ')', '') LIKE ?${i + 1}` : '') + ')')
    }
  }
  const sql = sqlLista(condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '')
  return (await db.prepare(sql).bind(...args).all<FilaPaciente>()).results ?? []
}

/** Un paciente con sus marcas, saldo, último y próximo turno y próximo control. */
export async function filaDePaciente(db: D1Database, id: number, hoy: string) {
  return db.prepare(sqlLista('WHERE p.id = ?2')).bind(hoy, id).first<FilaPaciente>()
}

const CUMPLE: Record<Filtro, (p: FilaPaciente) => boolean> = {
  todos: (p) => !p.baja,
  deben: (p) => !p.baja && p.saldo > 0,
  control: (p) => !p.baja && !!p.control_vencido,
  sin_turno: (p) => !p.baja && !p.proximo,
  primera: (p) => !p.baja && p.veces === 0,
  incompleta: (p) => !p.baja && !!p.incompleta,
  baja: (p) => !!p.baja,
}

export function contarPorFiltro(filas: FilaPaciente[]) {
  return Object.fromEntries(FILTROS.map((f) => [f.id, filas.filter(CUMPLE[f.id]).length])) as Record<Filtro, number>
}

/** Filtra y ordena. Por nombre: apellido y nombre. Último turno: el más reciente primero. Próximo: el más cercano primero; sin turno, al final. */
export function filtrarYOrdenar(filas: FilaPaciente[], filtro: Filtro, orden: Orden) {
  const nombre = (p: FilaPaciente) => sinTildes(`${p.apellido} ${p.nombre}`)
  const porNombre = (a: FilaPaciente, b: FilaPaciente) => nombre(a).localeCompare(nombre(b), 'es')
  const lista = filas.filter(CUMPLE[filtro])
  if (orden === 'ultimo') return lista.sort((a, b) => (b.ultimo ?? '').localeCompare(a.ultimo ?? '') || porNombre(a, b))
  if (orden === 'proximo') return lista.sort((a, b) => (a.proximo ?? '~').localeCompare(b.proximo ?? '~') || porNombre(a, b))
  return lista.sort(porNombre)
}

/** Marcas que se ven al lado del nombre. */
export function marcas(p: { baja: number; incompleta: number; veces: number; faltas: number; control_vencido: number }) {
  const m: { estado: string; texto: string }[] = []
  if (p.baja) m.push({ estado: 'cancelado', texto: 'Dado de baja' })
  if (!p.baja && p.veces === 0) m.push({ estado: 'primera', texto: 'Primera consulta' })
  if (!p.baja && p.incompleta) m.push({ estado: 'incompleta', texto: 'Ficha incompleta' })
  if (!p.baja && p.control_vencido) m.push({ estado: 'ausente', texto: 'Control vencido' })
  if (p.faltas) m.push({ estado: 'sin_respuesta', texto: p.faltas === 1 ? '1 falta' : `${p.faltas} faltas` })
  return m
}
