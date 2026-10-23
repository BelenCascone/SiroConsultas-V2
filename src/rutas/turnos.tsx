// P2 · Dar turno en tres pasos (paciente → día y hora → revisar y guardar) y las acciones sobre un turno:
// mover, cancelar, no vino, atender y avisarle por WhatsApp. Maquetas: docs/pantallas/DarTurno.dc.html y Agenda.dc.html.
import { Hono } from 'hono'
import type { Child } from 'hono/jsx'
import type { C, Env } from '../tipos'
import { leerInstalacion, habilitado } from '../lib/instalacion'
import { ahoraAR, ahoraISO, esFecha, esHora, sumarDias } from '../lib/fechas'
import { registrar } from '../lib/sesion'
import { buscarPacientes, validarAlta, enlaceWhatsapp, iniciales, fechaCorta, type Errores } from '../lib/pacientes'
import {
  cargarAgenda, huecosDelDia, franjasDelDia, bloqueoEn, feriadoSinAtencion, buscarChoques, hayChoques, textosChoques, fechasSerie,
  fechaConDia, fechaDia, diaCorto, minutos, mensajeTurno, MAX_REPETICIONES, type Choques,
} from '../lib/agenda'
import { Pagina } from '../ui/pagina'
import { Aviso, Boton, Campo, Pasos, Tarjeta, pesos } from '../ui/componentes'
import { Lupa, Mas, Volver } from '../ui/iconos'
import { datosProfesional, avisosSinLeer } from './inicio'

export const turnos = new Hono<Env>()

/** Solo rutas internas: nunca se vuelve a otro sitio. */
export const volverSeguro = (v: string | undefined | null, porDefecto = '/') => (v && /^\/(?!\/)[\w\-/?=&%.,+]*$/.test(v) ? v : porDefecto)

async function pagina(c: C, titulo: string, hijos: Child, status: 200 | 404 | 409 | 422 = 200) {
  const [prof, avisos] = await Promise.all([datosProfesional(c), avisosSinLeer(c)])
  return c.html(
    <Pagina titulo={titulo} seccion="agenda" inst={leerInstalacion(c.env)} email={c.get('email')!} nombre={prof.nombre} avisos={avisos}>
      {hijos}
    </Pagina>, status)
}

type PacienteCorto = { id: number; nombre: string; apellido: string; celular: string; recordatorios_baja: number; baja_en: string | null; cobertura: string | null; obra_social_id: number | null }
type Prestacion = { id: number; nombre: string; duracion_min: number; importe: number }
type ConsultorioCorto = { id: number; nombre: string; modalidad: string }

const leerPaciente = (c: C, id: number) =>
  c.env.DB.prepare('SELECT id, nombre, apellido, celular, recordatorios_baja, baja_en, cobertura, obra_social_id FROM pacientes WHERE id = ?').bind(id).first<PacienteCorto>()
const prestacionesActivas = async (c: C) =>
  (await c.env.DB.prepare('SELECT id, nombre, duracion_min, importe FROM prestaciones WHERE activa = 1 ORDER BY orden, id').all<Prestacion>()).results ?? []
const consultoriosActivos = async (c: C) =>
  (await c.env.DB.prepare('SELECT id, nombre, modalidad FROM consultorios WHERE activo = 1 ORDER BY orden, nombre').all<ConsultorioCorto>()).results ?? []

/** Estado del flujo, todo en la dirección: se puede volver atrás, recargar y compartir el enlace sin perder nada. */
type Flujo = { paciente?: number; consultorio?: number; fecha?: string; hora?: string; prestacion?: number; dia?: string; volver: string; abrir?: boolean }
function leerFlujo(c: C): Flujo {
  const q = (k: string) => c.req.query(k) ?? undefined
  const n = (k: string) => (/^\d+$/.test(q(k) ?? '') ? Number(q(k)) : undefined)
  return {
    paciente: n('paciente'), consultorio: n('consultorio'), prestacion: n('prestacion'),
    fecha: esFecha(q('fecha') ?? '') ? q('fecha') : undefined, hora: esHora(q('hora') ?? '') ? q('hora') : undefined,
    dia: esFecha(q('dia') ?? '') ? q('dia') : undefined, volver: volverSeguro(q('volver')), abrir: q('abrir') === '1',
  }
}
function enlaceFlujo(f: Flujo, cambios: Partial<Record<keyof Flujo, string | number | undefined>> = {}) {
  const u = new URLSearchParams()
  const todo = { ...f, ...cambios } as Record<string, unknown>
  for (const k of ['paciente', 'consultorio', 'prestacion', 'fecha', 'hora', 'dia', 'volver', 'abrir']) {
    const v = todo[k]
    if (v === undefined || v === '' || v === false || (k === 'volver' && v === '/')) continue
    u.set(k, v === true ? '1' : String(v))
  }
  return `/turnos/nuevo?${u.toString()}`
}

const HiddenFlujo = ({ f, sin = [] }: { f: Flujo; sin?: string[] }) => (
  <>{(['paciente', 'consultorio', 'prestacion', 'fecha', 'hora', 'dia', 'volver'] as const).filter((k) => !sin.includes(k) && f[k] !== undefined && f[k] !== '/')
    .map((k) => <input type="hidden" name={k} value={String(f[k])} />)}</>
)

// ---------- Dar turno ----------
turnos.get('/turnos/nuevo', async (c) => {
  const f = leerFlujo(c)
  const ahora = ahoraAR()
  const [paciente, prestaciones, consultorios] = await Promise.all([
    f.paciente ? leerPaciente(c, f.paciente) : null, prestacionesActivas(c), consultoriosActivos(c),
  ])
  if (f.paciente && !paciente) return c.notFound()
  if (paciente?.baja_en) {
    return pagina(c, 'Dar turno', <Aviso tipo="error">{paciente.nombre} {paciente.apellido} está dado de baja: no se le dan turnos hasta reactivarlo. <a href={`/pacientes/${paciente.id}`}>Ver su ficha</a></Aviso>, 409)
  }
  if (!consultorios.length) {
    return pagina(c, 'Dar turno', <Aviso tipo="ambar">Para dar turnos primero cargá un consultorio con sus horarios. <a href="/configuracion/consultorios">Ir a Configuración</a></Aviso>)
  }
  // La prestación viene por defecto: la de su último turno o, si nunca vino, la primera de la lista.
  const ultima = paciente && !f.prestacion
    ? await c.env.DB.prepare(`SELECT prestacion_id FROM turnos WHERE paciente_id = ? AND prestacion_id IS NOT NULL AND estado <> 'cancelado' ORDER BY fecha DESC, hora DESC LIMIT 1`).bind(paciente.id).first<{ prestacion_id: number }>()
    : null
  const prestacion = prestaciones.find((p) => p.id === (f.prestacion ?? ultima?.prestacion_id)) ?? prestaciones[0] ?? null
  const paso = !paciente ? 0 : !(f.fecha && f.hora) ? 1 : 2
  const resumen: { texto: string; href: string }[] = []
  if (paciente) resumen.push({ texto: `${paciente.nombre} ${paciente.apellido}`, href: enlaceFlujo(f, { paciente: undefined }) })
  if (f.fecha && f.hora) resumen.push({ texto: `${fechaDia(f.fecha)} · ${f.hora}`, href: enlaceFlujo(f, { fecha: undefined, hora: undefined, dia: f.fecha }) })
  if (prestacion && paso >= 1) resumen.push({ texto: prestacion.nombre, href: enlaceFlujo(f, { fecha: undefined, hora: undefined, dia: f.fecha }) })

  return pagina(c, 'Dar turno', <div class="angosto columna">
    <a class="volver" href={f.volver}><Volver />{f.volver === '/' ? 'Volver a Hoy' : 'Volver'}</a>
    <section class="encabezado">
      <h1>Dar turno</h1>
      <Pasos pasos={['Paciente', 'Día y hora', 'Guardar']} actual={paso} />
    </section>
    {resumen.length > 0 && (
      <nav class="fila" aria-label="Lo que elegiste">
        {resumen.map((r) => <a class="pastilla elegida" href={r.href} title="Cambiar">{r.texto}<span class="oculto-visual"> (cambiar)</span></a>)}
      </nav>
    )}
    {paso === 0 && <PasoPaciente c={c} f={f} />}
    {paso === 1 && paciente && <PasoCuando c={c} f={f} prestaciones={prestaciones} prestacion={prestacion} consultorios={consultorios} ahora={ahora} />}
    {paso === 2 && paciente && <PasoRevisar c={c} f={f} paciente={paciente} prestacion={prestacion} consultorios={consultorios} ahora={ahora} />}
  </div>)
})

async function PasoPaciente({ c, f }: { c: C; f: Flujo }) {
  const q = (c.req.query('q') ?? '').slice(0, 80).trim()
  const nuevo = c.req.query('nuevo') === '1'
  const { fecha: hoy } = ahoraAR()
  const lista = q
    ? (await buscarPacientes(c.env.DB, q, hoy)).filter((p) => !p.baja).slice(0, 8)
    : ((await c.env.DB.prepare(
      `SELECT p.id, p.nombre, p.apellido, MAX(t.fecha) ultimo, (SELECT COUNT(*) FROM turnos t2 WHERE t2.paciente_id = p.id AND t2.estado = 'ausente') faltas
         FROM turnos t JOIN pacientes p ON p.id = t.paciente_id WHERE t.estado = 'atendido' AND p.baja_en IS NULL
        GROUP BY p.id ORDER BY ultimo DESC LIMIT 6`
    ).all<{ id: number; nombre: string; apellido: string; ultimo: string | null; faltas: number }>()).results ?? [])
  return (
    <Tarjeta titulo="¿Para quién es?">
      <form class="buscador chico-buscador" method="get" action="/turnos/nuevo" role="search">
        <Lupa />
        <label for="busca-t" class="oculto-visual">Buscar paciente</label>
        <input id="busca-t" name="q" type="search" value={q} placeholder="Nombre, apellido, DNI o celular" autofocus={!nuevo} />
        <HiddenFlujo f={f} sin={['paciente']} />
      </form>
      {!nuevo && <>
        <span class="etiqueta">{q ? 'Encontrados' : 'Últimos que vinieron'}</span>
        {lista.length === 0 && <p class="suave">{q ? `No encontramos pacientes con «${q}».` : 'Todavía no vino nadie.'}</p>}
        <ul class="lista elegir-paciente">
          {lista.map((p) => (
            <li>
              <a class="fila-elegir" href={enlaceFlujo(f, { paciente: p.id })}>
                <span class="avatar-chico" aria-hidden="true">{iniciales(p.nombre, p.apellido)}</span>
                <span class="columna-chica">
                  <strong>{p.nombre} {p.apellido}</strong>
                  <span class="chico suave">{'ultimo' in p && p.ultimo ? `Vino el ${fechaCorta(p.ultimo)}` : 'Nunca vino'}</span>
                </span>
                {p.faltas > 0 && <span class="estado gris">{p.faltas === 1 ? '1 falta' : `${p.faltas} faltas`}</span>}
              </a>
            </li>
          ))}
        </ul>
        <Boton href={`${enlaceFlujo(f, { paciente: undefined })}&nuevo=1`} variante="borde"><Mas />Paciente nuevo</Boton>
      </>}
      {nuevo && <FormAltaTurno f={f} />}
    </Tarjeta>
  )
}

function FormAltaTurno({ f, datos, errores }: { f: Flujo; datos?: Record<string, string | null>; errores?: Errores }) {
  return (
    <form method="post" action="/turnos/nuevo/paciente" class="columna" novalidate>
      <div class="fila entre-todo"><span class="etiqueta">Ficha nueva, con lo mínimo</span><a href={enlaceFlujo(f)}>Cancelar</a></div>
      <div class="campos-2">
        <Campo etiqueta="DNI" nombre="dni" modoTeclado="numeric" valor={datos?.dni ?? undefined} error={errores?.dni} requerido autocompletar="off" autofocus />
        <Campo etiqueta="Celular" nombre="celular" tipo="tel" valor={datos?.celular ?? undefined} error={errores?.celular} requerido autocompletar="off" />
        <Campo etiqueta="Nombre" nombre="nombre" valor={datos?.nombre ?? undefined} error={errores?.nombre} requerido autocompletar="off" />
        <Campo etiqueta="Apellido" nombre="apellido" valor={datos?.apellido ?? undefined} error={errores?.apellido} requerido autocompletar="off" />
      </div>
      <Campo etiqueta="Correo (opcional)" nombre="correo" tipo="email" valor={datos?.correo ?? undefined} error={errores?.correo} ayuda="Si no tiene, dejalo vacío." autocompletar="off" />
      <p class="chico suave">Si el DNI ya existe, seguimos con esa ficha en vez de crear otra. El resto de los datos se completan en su ficha, antes de la primera consulta.</p>
      <HiddenFlujo f={f} sin={['paciente']} />
      <div class="ventana-pie"><Boton type="submit" variante="oscuro">Crear ficha y seguir</Boton></div>
    </form>
  )
}

turnos.post('/turnos/nuevo/paciente', async (c) => {
  const form = await c.req.parseBody()
  const g = (k: string) => (typeof form[k] === 'string' ? (form[k] as string) : undefined)
  const f: Flujo = {
    consultorio: /^\d+$/.test(g('consultorio') ?? '') ? Number(g('consultorio')) : undefined,
    prestacion: /^\d+$/.test(g('prestacion') ?? '') ? Number(g('prestacion')) : undefined,
    fecha: esFecha(g('fecha') ?? '') ? g('fecha') : undefined, hora: esHora(g('hora') ?? '') ? g('hora') : undefined,
    dia: esFecha(g('dia') ?? '') ? g('dia') : undefined, volver: volverSeguro(g('volver')),
  }
  const { datos, errores } = validarAlta(form)
  if (Object.keys(errores).length) {
    return pagina(c, 'Dar turno', <div class="angosto columna"><Tarjeta titulo="¿Para quién es?"><FormAltaTurno f={f} datos={datos} errores={errores} /></Tarjeta></div>, 422)
  }
  const existe = await c.env.DB.prepare('SELECT id, baja_en FROM pacientes WHERE dni = ?').bind(datos.dni).first<{ id: number; baja_en: string | null }>()
  if (existe) return c.redirect(enlaceFlujo(f, { paciente: existe.id }))
  const r = await c.env.DB.prepare('INSERT INTO pacientes (dni, nombre, apellido, celular, correo) VALUES (?, ?, ?, ?, ?) RETURNING id')
    .bind(datos.dni, datos.nombre, datos.apellido, datos.celular, datos.correo).first<{ id: number }>()
  await registrar(c, 'paciente_alta', `paciente:${r!.id} · al dar turno`, c.get('email'))
  return c.redirect(enlaceFlujo(f, { paciente: r!.id }))
})

const DIAS_A_MOSTRAR = 14

async function PasoCuando({ c, f, prestaciones, prestacion, consultorios, ahora }: {
  c: C; f: Flujo; prestaciones: Prestacion[]; prestacion: Prestacion | null; consultorios: ConsultorioCorto[]; ahora: { fecha: string; hora: string }
}) {
  const inicio = f.dia && f.dia >= ahora.fecha ? f.dia : ahora.fecha
  const desde = f.dia && f.dia > sumarDias(ahora.fecha, DIAS_A_MOSTRAR - 1) ? f.dia : ahora.fecha
  const hasta = sumarDias(desde, DIAS_A_MOSTRAR - 1)
  const d = await cargarAgenda(c.env.DB, desde, hasta)
  const consultorio = consultorios.some((x) => x.id === f.consultorio) ? f.consultorio! : null
  const duracion = prestacion?.duracion_min ?? 30
  const dias = Array.from({ length: DIAS_A_MOSTRAR }, (_, i) => sumarDias(desde, i))
    .filter((dia) => franjasDelDia(d.franjas, dia, consultorio).length > 0)
  // Sin día elegido: el primero que tiene huecos libres.
  const elegido = f.dia && dias.includes(inicio) ? inicio : dias.find((dia) => huecosDelDia(d, dia, consultorio, ahora, 30, duracion).length > 0) ?? dias[0]
  const bloqueo = elegido ? bloqueoEn(d.bloqueos, elegido, consultorio) : null
  const feriado = elegido ? feriadoSinAtencion(d.feriados, elegido) : null
  const cerrado = !!(bloqueo && bloqueo.hora_desde === null) || !!feriado
  // «Abrir ese día»: se ofrecen igual los horarios del día bloqueado o feriado (es su agenda).
  const huecos = elegido
    ? f.abrir && cerrado
      ? huecosDelDia({ ...d, bloqueos: [], feriados: new Map() }, elegido, consultorio, ahora, 30, duracion)
      : huecosDelDia(d, elegido, consultorio, ahora, 30, duracion)
    : []
  const manana = huecos.filter((h) => h.hora < '13:00')
  const tarde = huecos.filter((h) => h.hora >= '13:00')
  const Huecos = ({ titulo, lista }: { titulo: string; lista: typeof huecos }) => lista.length === 0 ? null : (
    <div class="columna-chica">
      <span class="etiqueta">{titulo}</span>
      <div class="fila">{lista.map((h) => (
        <a class="pastilla hueco" href={enlaceFlujo(f, { fecha: elegido, hora: h.hora, consultorio: h.consultorio_id, dia: undefined, abrir: undefined })}>{h.hora}</a>
      ))}</div>
    </div>
  )
  return (
    <Tarjeta titulo="¿Cuándo?">
      <form method="get" action="/turnos/nuevo" class="fila filtros-turno">
        <HiddenFlujo f={f} sin={['prestacion', 'consultorio', 'fecha', 'hora']} />
        <div class="campo">
          <label for="c-prestacion">Prestación</label>
          <select id="c-prestacion" name="prestacion" class="entrada" data-enviar="">
            {prestaciones.map((p) => <option value={p.id} selected={p.id === prestacion?.id}>{p.nombre} · {p.duracion_min} min</option>)}
          </select>
        </div>
        {consultorios.length > 1 && (
          <div class="campo">
            <label for="c-consultorio">Consultorio</label>
            <select id="c-consultorio" name="consultorio" class="entrada" data-enviar="">
              <option value="">Todos</option>
              {consultorios.map((x) => <option value={x.id} selected={x.id === consultorio}>{x.nombre}</option>)}
            </select>
          </div>
        )}
        <button type="submit" class="boton borde sin-js">Ver horarios</button>
      </form>
      {dias.length === 0 ? <Aviso tipo="ambar">No hay días de atención en estas dos semanas. Revisá los horarios en Configuración.</Aviso> : <>
        <nav class="fila dias" aria-label="Días">
          {dias.map((dia) => {
            const raya = !!feriadoSinAtencion(d.feriados, dia) || !!(bloqueoEn(d.bloqueos, dia, consultorio)?.hora_desde === null && bloqueoEn(d.bloqueos, dia, consultorio))
            return (
              <a class={`dia-pastilla${raya ? ' rayado' : ''}`} href={enlaceFlujo(f, { dia, abrir: undefined })} aria-current={dia === elegido ? 'true' : undefined}>
                <span>{diaCorto(dia)}</span><strong>{Number(dia.slice(8))}</strong>
              </a>
            )
          })}
        </nav>
        {cerrado && !f.abrir && (
          <Aviso tipo="ambar">
            {feriado ? `El ${fechaConDia(elegido!)} es feriado (${feriado.nombre}) y no atendés.` : `El ${fechaConDia(elegido!)} bloqueaste la agenda${bloqueo?.motivo ? ` (${bloqueo.motivo})` : ''}.`}
            {' '}Si igual querés dar turno, <a href={enlaceFlujo(f, { dia: elegido, abrir: 1 })}>abrí ese día</a>.
          </Aviso>
        )}
        {(!cerrado || f.abrir) && huecos.length === 0 && <p class="suave">No quedan horarios libres ese día.</p>}
        {(!cerrado || f.abrir) && <><Huecos titulo="Mañana" lista={manana} /><Huecos titulo="Tarde" lista={tarde} /></>}
        <details class="desplegable">
          <summary>Otro horario</summary>
          <form method="get" action="/turnos/nuevo" class="fila">
            <HiddenFlujo f={f} sin={['fecha', 'hora', 'dia']} />
            <Campo etiqueta="Día" nombre="fecha" tipo="date" valor={elegido} requerido />
            <Campo etiqueta="Hora" nombre="hora" tipo="time" requerido />
            <Boton type="submit" variante="borde">Seguir</Boton>
          </form>
          <p class="chico suave">Si choca con otro turno o queda fuera de tu horario, te avisamos antes de guardar.</p>
        </details>
      </>}
    </Tarjeta>
  )
}

async function PasoRevisar({ c, f, paciente, prestacion, consultorios, ahora, choques }: {
  c: C; f: Flujo; paciente: PacienteCorto; prestacion: Prestacion | null; consultorios: ConsultorioCorto[]; ahora: { fecha: string; hora: string }
  choques?: { fecha: string; textos: string[] }[]
}) {
  const consultorio = consultorios.find((x) => x.id === f.consultorio) ?? (await elegirConsultorio(c, f.fecha!, f.hora!, prestacion?.duracion_min ?? 30, consultorios))
  const duracion = prestacion?.duracion_min ?? 30
  const avisos = choques ?? [{ fecha: f.fecha!, textos: textosChoques(await buscarChoques(c.env.DB, { fecha: f.fecha!, hora: f.hora!, duracion, consultorio_id: consultorio.id }, ahora), f.fecha!) }]
  const hayAvisos = avisos.some((a) => a.textos.length > 0)
  const importe = prestacion ? (paciente.cobertura === 'obra_social' ? 'Copago al cobrar' : prestacion.importe === 0 ? 'Sin cargo' : pesos(prestacion.importe)) : '—'
  const cobros = habilitado(leerInstalacion(c.env), 'cobros')
  const tarjetas: [string, string][] = [
    ['Paciente', `${paciente.nombre} ${paciente.apellido}`],
    ['Cuándo', `${fechaDia(f.fecha!)} · ${f.hora} · ${consultorio.nombre}`],
    ['Prestación', prestacion ? `${prestacion.nombre} · ${duracion} min` : 'Sin prestación'],
    ...(cobros ? [['Importe', importe] as [string, string]] : []),
  ]
  return (
    <Tarjeta titulo="Revisá y guardá">
      <div class="resumen-turno">{tarjetas.map(([k, v]) => <div class="dato-tarjeta"><span class="chico suave">{k}</span><strong>{v}</strong></div>)}</div>
      <form method="post" action="/turnos" class="columna">
        <HiddenFlujo f={{ ...f, consultorio: consultorio.id, prestacion: prestacion?.id }} sin={['dia']} />
        <details class="desplegable repetir" open={c.req.query('repetir') === '1'}>
          <summary>Repetir</summary>
          <div class="campos-2">
            <div class="campo">
              <label for="c-cada">Cada cuántas semanas</label>
              <select id="c-cada" name="cada" class="entrada">{[1, 2, 3, 4, 6, 8].map((n) => <option value={n}>{n === 1 ? 'Todas las semanas' : `Cada ${n} semanas`}</option>)}</select>
            </div>
            <Campo etiqueta="Hasta" nombre="hasta" tipo="date" ayuda={`Hasta ${MAX_REPETICIONES} turnos. Vacío: no se repite.`} />
          </div>
        </details>
        <div class="interruptor">
          <label for="i-avisar"><span class="etiqueta">Avisarle</span><span class="chico suave"><br />Te dejamos el mensaje listo para mandarle por WhatsApp.</span></label>
          <input id="i-avisar" type="checkbox" role="switch" name="avisar" value="1" checked={!paciente.recordatorios_baja} />
        </div>
        {hayAvisos && (
          <div class="aviso ambar columna-chica" role="alert">
            <strong>Antes de guardar:</strong>
            {avisos.filter((a) => a.textos.length).map((a) => (
              <span>{avisos.length > 1 ? `${fechaDia(a.fecha)}: ` : ''}{a.textos.join(' ')}</span>
            ))}
            <label class="fila"><input type="checkbox" name="forzar" value="1" required /> Es mi agenda: dar el turno igual</label>
          </div>
        )}
        <div class="ventana-pie">
          <Boton href={enlaceFlujo(f, { fecha: undefined, hora: undefined, dia: f.fecha })} variante="texto">Elegir otro horario</Boton>
          <Boton type="submit" variante="destacado">Guardar turno</Boton>
        </div>
      </form>
    </Tarjeta>
  )
}

/** Con «Todos» se usa el consultorio que atiende a esa hora (o el primero). */
async function elegirConsultorio(c: C, fecha: string, hora: string, duracion: number, consultorios: ConsultorioCorto[]) {
  const d = await cargarAgenda(c.env.DB, fecha, fecha)
  const m = minutos(hora)
  const franja = franjasDelDia(d.franjas, fecha, null).find((x) => minutos(x.desde) <= m && m + duracion <= minutos(x.hasta))
  return consultorios.find((x) => x.id === franja?.consultorio_id) ?? consultorios[0]
}

turnos.post('/turnos', async (c) => {
  const form = await c.req.parseBody()
  const g = (k: string) => (typeof form[k] === 'string' ? (form[k] as string) : '')
  const ahora = ahoraAR()
  const f: Flujo = {
    paciente: Number(g('paciente')) || undefined, consultorio: Number(g('consultorio')) || undefined, prestacion: Number(g('prestacion')) || undefined,
    fecha: esFecha(g('fecha')) ? g('fecha') : undefined, hora: esHora(g('hora')) ? g('hora') : undefined, volver: volverSeguro(g('volver')),
  }
  const [paciente, prestaciones, consultorios] = await Promise.all([f.paciente ? leerPaciente(c, f.paciente) : null, prestacionesActivas(c), consultoriosActivos(c)])
  const consultorio = consultorios.find((x) => x.id === f.consultorio)
  const prestacion = f.prestacion ? prestaciones.find((p) => p.id === f.prestacion) ?? null : null
  if (!paciente || !consultorio || !f.fecha || !f.hora || (f.prestacion && !prestacion)) return c.redirect(enlaceFlujo(f))
  if (paciente.baja_en) return c.redirect(enlaceFlujo(f))
  const duracion = prestacion?.duracion_min ?? 30
  // Repetir: cada N semanas hasta una fecha. Cada turno queda suelto, unido por la serie.
  const cada = [1, 2, 3, 4, 6, 8].includes(Number(g('cada'))) ? Number(g('cada')) : 1
  const hasta = esFecha(g('hasta')) && g('hasta') > f.fecha ? g('hasta') : null
  const fechas = hasta ? fechasSerie(f.fecha, cada, hasta) : [f.fecha]
  const choques: { fecha: string; textos: string[]; c: Choques }[] = []
  for (const fecha of fechas) {
    const ch = await buscarChoques(c.env.DB, { fecha, hora: f.hora, duracion, consultorio_id: consultorio.id }, ahora)
    choques.push({ fecha, textos: textosChoques(ch, fecha), c: ch })
  }
  if (choques.some((x) => hayChoques(x.c)) && g('forzar') !== '1') {
    return pagina(c, 'Dar turno', <div class="angosto columna">
      <h1>Dar turno</h1>
      <PasoRevisar c={c} f={f} paciente={paciente} prestacion={prestacion} consultorios={consultorios} ahora={ahora} choques={choques} />
    </div>, 409)
  }
  // Tipo de atención para las estadísticas: primera si nunca vino; si no, control.
  const vino = await c.env.DB.prepare(`SELECT COUNT(*) n FROM turnos WHERE paciente_id = ? AND estado = 'atendido'`).bind(paciente.id).first<{ n: number }>()
  const atencion = vino?.n ? 'control' : 'primera'
  const cobertura = paciente.cobertura === 'obra_social' && paciente.obra_social_id ? 'obra_social' : 'particular'
  let serie: number | null = null
  if (fechas.length > 1) {
    serie = (await c.env.DB.prepare('INSERT INTO series (cada_semanas, hasta) VALUES (?, ?) RETURNING id').bind(cada, hasta).first<{ id: number }>())!.id
  }
  const insertar = (fecha: string, i: number) => c.env.DB.prepare(
    `INSERT INTO turnos (paciente_id, consultorio_id, fecha, hora, duracion_min, prestacion_id, cobertura, obra_social_id, modalidad, atencion, serie_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
  ).bind(paciente.id, consultorio.id, fecha, f.hora, duracion, prestacion?.id ?? null, cobertura, cobertura === 'obra_social' ? paciente.obra_social_id : null,
    consultorio.modalidad, i === 0 ? atencion : 'control', serie)
  const creados = await c.env.DB.batch(fechas.map(insertar))
  const ids = creados.map((r) => ((r as D1Result<{ id: number }>).results?.[0]?.id)).filter(Boolean) as number[]
  await registrar(c, 'turno_dado', `paciente:${paciente.id} · ${ids.length} turno${ids.length === 1 ? '' : 's'}`, c.get('email'))
  const u = new URLSearchParams({ ids: ids.join(','), ...(g('avisar') === '1' && { avisar: '1' }), ...(f.volver !== '/' && { volver: f.volver }) })
  return c.redirect(`/turnos/listo?${u}`)
})

turnos.get('/turnos/listo', async (c) => {
  const ids = (c.req.query('ids') ?? '').split(',').filter((x) => /^\d+$/.test(x)).map(Number).slice(0, MAX_REPETICIONES)
  if (!ids.length) return c.redirect('/agenda')
  const lista = (await c.env.DB.prepare(
    `SELECT t.id, t.fecha, t.hora, t.paciente_id, p.nombre, p.apellido, co.nombre consultorio FROM turnos t JOIN pacientes p ON p.id = t.paciente_id
       JOIN consultorios co ON co.id = t.consultorio_id WHERE t.id IN (${ids.map(() => '?').join(',')}) ORDER BY t.fecha`
  ).bind(...ids).all<{ id: number; fecha: string; hora: string; paciente_id: number; nombre: string; apellido: string; consultorio: string }>()).results ?? []
  if (!lista.length) return c.notFound()
  const t = lista[0]
  const volver = volverSeguro(c.req.query('volver'))
  return pagina(c, 'Turno confirmado', <div class="angosto columna">
    <Tarjeta etiqueta="Turno confirmado">
      <h1 class="titulo-ficha">{lista.length === 1 ? 'Turno confirmado' : `${lista.length} turnos confirmados`}</h1>
      <p>{t.nombre} {t.apellido} · {fechaConDia(t.fecha)} a las {t.hora} · {t.consultorio}{lista.length > 1 ? `, y ${lista.length - 1} más hasta el ${fechaCorta(lista[lista.length - 1].fecha)}` : ''}.</p>
      {c.req.query('avisar') === '1' && (
        <form method="post" action={`/turnos/${t.id}/avisar`}>
          <input type="hidden" name="tipo" value="nuevo" />
          <Boton type="submit" variante="destacado">Avisarle por WhatsApp</Boton>
        </form>
      )}
      <div class="fila">
        <Boton href={volver} variante="oscuro">{volver === '/' ? 'Volver a Hoy' : 'Volver'}</Boton>
        <Boton href={`/turnos/nuevo${volver !== '/' ? `?volver=${encodeURIComponent(volver)}` : ''}`} variante="borde">Dar otro turno</Boton>
        <Boton href={`/agenda?vista=dia&fecha=${t.fecha}&turno=${t.id}`} variante="texto">Verlo en la agenda</Boton>
      </div>
    </Tarjeta>
  </div>)
})

// ---------- Acciones sobre un turno ----------
type TurnoFila = { id: number; paciente_id: number; nombre: string; apellido: string; celular: string; recordatorios_baja: number; fecha: string; hora: string; duracion_min: number; consultorio_id: number; consultorio: string; estado: string; serie_id: number | null }
const leerTurno = (c: C, id: number) => c.env.DB.prepare(
  `SELECT t.id, t.paciente_id, p.nombre, p.apellido, p.celular, p.recordatorios_baja, t.fecha, t.hora, t.duracion_min, t.consultorio_id, co.nombre consultorio, t.estado, t.serie_id
     FROM turnos t JOIN pacientes p ON p.id = t.paciente_id JOIN consultorios co ON co.id = t.consultorio_id WHERE t.id = ?`
).bind(id).first<TurnoFila>()

const abierto = (estado: string) => estado === 'confirmado' || estado === 'solicitado'
const enAgenda = (t: { fecha: string; id: number }, extra = '') => `/agenda?vista=dia&fecha=${t.fecha}&turno=${t.id}${extra}`

/** Abre WhatsApp con el mensaje listo y deja registrado el envío. */
turnos.post('/turnos/:id{[0-9]+}/avisar', async (c) => {
  const t = await leerTurno(c, Number(c.req.param('id')))
  if (!t) return c.notFound()
  const pedido = c.req.query('tipo') ?? (await c.req.parseBody()).tipo
  const tipo = (['nuevo', 'movido', 'cancelado', 'recordatorio'] as const).find((x) => x === pedido) ?? 'nuevo'
  const plantilla = tipo === 'recordatorio' ? (await c.env.DB.prepare('SELECT recordatorio_mensaje FROM profesional WHERE id = 1').first<{ recordatorio_mensaje: string | null }>())?.recordatorio_mensaje : null
  const texto = mensajeTurno(tipo, { nombre: t.nombre, fecha: t.fecha, hora: t.hora, lugar: t.consultorio }, plantilla)
  await c.env.DB.prepare(`INSERT INTO envios (que, objeto_id, paciente_id, canal, destino) VALUES (?, ?, ?, 'whatsapp', ?)`)
    .bind(tipo === 'recordatorio' ? 'recordatorio' : 'aviso_turno', t.id, t.paciente_id, t.celular).run()
  if (tipo === 'recordatorio' && abierto(t.estado)) {
    await c.env.DB.prepare('UPDATE turnos SET recordatorio_whatsapp_en = ?, actualizado_en = ? WHERE id = ?').bind(ahoraISO(), ahoraISO(), t.id).run()
  }
  return c.redirect(enlaceWhatsapp(t.celular, texto))
})

/** Cancelar: quién canceló (la profesional o el paciente) y, si es de una serie, solo este o este y los siguientes. */
turnos.post('/turnos/:id{[0-9]+}/cancelar', async (c) => {
  const t = await leerTurno(c, Number(c.req.param('id')))
  if (!t) return c.notFound()
  if (!abierto(t.estado)) return c.redirect(enAgenda(t, '&aviso=cerrado'))
  const f = await c.req.parseBody()
  const quien = f.quien === 'paciente' ? 'paciente' : 'profesional'
  const siguientes = f.alcance === 'siguientes' && t.serie_id
  const en = ahoraISO()
  const r = await c.env.DB.prepare(
    `UPDATE turnos SET estado = 'cancelado', cancelado_por = ?, cerrado_en = ?, actualizado_en = ?, solicitado_vence_en = NULL
      WHERE estado IN ('confirmado', 'solicitado') AND ${siguientes ? 'serie_id = ? AND (fecha > ? OR (fecha = ? AND hora >= ?))' : 'id = ?'}`
  ).bind(quien, en, en, ...(siguientes ? [t.serie_id, t.fecha, t.fecha, t.hora] : [t.id])).run()
  await registrar(c, 'turno_cancelado', `turno:${t.id} · ${quien}${siguientes ? ` · ${r.meta.changes} de la serie` : ''}`, c.get('email'))
  return c.redirect(`/agenda?vista=dia&fecha=${t.fecha}&aviso=cancelado&turno=${t.id}`)
})

/** No vino (ausente) y Atender: cierran el turno; no se deshacen. */
for (const [accion, estado, evento] of [['ausente', 'ausente', 'turno_ausente'], ['atender', 'atendido', 'turno_atendido']] as const) {
  turnos.post(`/turnos/:id{[0-9]+}/${accion}`, async (c) => {
    const t = await leerTurno(c, Number(c.req.param('id')))
    if (!t) return c.notFound()
    if (!abierto(t.estado)) return c.redirect(enAgenda(t, '&aviso=cerrado'))
    const ahora = ahoraAR()
    if (t.fecha > ahora.fecha) return c.redirect(enAgenda(t, '&aviso=futuro'))
    const en = ahoraISO()
    await c.env.DB.prepare(`UPDATE turnos SET estado = ?, cerrado_en = ?, actualizado_en = ?, solicitado_vence_en = NULL WHERE id = ? AND estado IN ('confirmado', 'solicitado')`)
      .bind(estado, en, en, t.id).run()
    await registrar(c, evento, `turno:${t.id}`, c.get('email'))
    // Atender abre la ficha del paciente en su historia clínica (la consulta se escribe ahí: tarea X2).
    return c.redirect(accion === 'atender' ? `/pacientes/${t.paciente_id}?tab=historia&aviso=atendido` : enAgenda(t, '&aviso=ausente'))
  })
}

/** Mover a otro día u hora (y consultorio). En una serie: solo este o este y los siguientes, corridos lo mismo. */
turnos.post('/turnos/:id{[0-9]+}/mover', async (c) => {
  const t = await leerTurno(c, Number(c.req.param('id')))
  if (!t) return c.notFound()
  if (!abierto(t.estado)) return c.redirect(enAgenda(t, '&aviso=cerrado'))
  const f = await c.req.parseBody()
  const fecha = typeof f.fecha === 'string' && esFecha(f.fecha) ? f.fecha : null
  const hora = typeof f.hora === 'string' && esHora(f.hora) ? f.hora : null
  const consultorio = Number(f.consultorio) || t.consultorio_id
  const existe = await c.env.DB.prepare('SELECT modalidad FROM consultorios WHERE id = ? AND activo = 1').bind(consultorio).first<{ modalidad: string }>()
  if (!fecha || !hora || !existe) return c.redirect(`/agenda?mover=${t.id}&fecha=${t.fecha}`)
  const ahora = ahoraAR()
  const choques = await buscarChoques(c.env.DB, { fecha, hora, duracion: t.duracion_min, consultorio_id: consultorio, excluir: [t.id] }, ahora)
  if (hayChoques(choques) && f.forzar !== '1') {
    const u = new URLSearchParams({ mover: String(t.id), destino: `${fecha}_${hora}_${consultorio}`, fecha, choque: '1', ...(f.alcance === 'siguientes' && { alcance: 'siguientes' }) })
    return c.redirect(`/agenda?${u}`)
  }
  const dias = Math.round((Date.parse(fecha) - Date.parse(t.fecha)) / 86_400_000)
  const en = ahoraISO()
  // Al moverlo, la confirmación del paciente vuelve a empezar.
  const sets = `consultorio_id = ?, modalidad = ?, hora = ?, confirmacion = NULL, confirmacion_cambios = 0, confirmacion_en = NULL, enlace_huella = NULL, actualizado_en = ?`
  const sentencias = [c.env.DB.prepare(`UPDATE turnos SET fecha = ?, ${sets} WHERE id = ?`).bind(fecha, consultorio, existe.modalidad, hora, en, t.id)]
  if (f.alcance === 'siguientes' && t.serie_id) {
    sentencias.push(c.env.DB.prepare(
      `UPDATE turnos SET fecha = date(fecha, ? || ' days'), ${sets}
        WHERE serie_id = ? AND id <> ? AND estado IN ('confirmado', 'solicitado') AND (fecha > ? OR (fecha = ? AND hora > ?))`
    ).bind(String(dias), consultorio, existe.modalidad, hora, en, t.serie_id, t.id, t.fecha, t.fecha, t.hora))
  }
  await c.env.DB.batch(sentencias)
  await registrar(c, 'turno_movido', `turno:${t.id}`, c.get('email'))
  return c.redirect(`/agenda?vista=dia&fecha=${fecha}&aviso=movido&turno=${t.id}`)
})
