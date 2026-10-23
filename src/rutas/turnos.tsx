// P2a · Dar turno: tres pasos (Paciente → Día y hora → Guardar), con alta rápida, huecos libres, avisos de superposición
// y fuera de horario, repetición semanal y aviso por WhatsApp. Maqueta: docs/pantallas/DarTurno.dc.html · docs/DISENO_APROBADO.md, sección 3.
import { Hono } from 'hono'
import type { Child } from 'hono/jsx'
import type { C, Env } from '../tipos'
import { leerInstalacion } from '../lib/instalacion'
import { DIAS, ahoraAR, ahoraISO, esFecha, esHora, fechaLarga, sumarDias } from '../lib/fechas'
import { registrar } from '../lib/sesion'
import { buscarPacientes, dniConPuntos, enlaceWhatsapp, fechaCorta, iniciales, validarAlta, type Errores } from '../lib/pacientes'
import {
  aMinutos, cargarAgenda, controlar, crearTurno, diaDe, fechasDeSerie, huecos, leerTurno,
  type Control, type DatosAgenda, type Dia,
} from '../lib/turnos'
import { Pagina } from '../ui/pagina'
import { Aviso, Boton, Campo, Interruptor, Pasos, Tarjeta, pesos } from '../ui/componentes'
import { Lupa, Mas, Volver } from '../ui/iconos'
import { datosProfesional, avisosSinLeer } from './inicio'

export const turnos = new Hono<Env>()

const DIAS_A_OFRECER = 28
const MAX_PASTILLAS = 14
const MAX_AVISADOS = 60

async function pagina(c: C, titulo: string, hijos: Child, status: 200 | 404 | 409 | 422 = 200) {
  const [prof, avisos] = await Promise.all([datosProfesional(c), avisosSinLeer(c)])
  return c.html(
    <Pagina titulo={titulo} seccion="agenda" inst={leerInstalacion(c.env)} email={c.get('email')!} nombre={prof.nombre} avisos={avisos}>
      {hijos}
    </Pagina>, status)
}

type Q = Record<string, string | undefined>
const url = (q: Q) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(q)) if (v) p.set(k, v)
  return `/turnos/nuevo?${p}`
}
const entero = (v: unknown) => (typeof v === 'string' && /^\d{1,9}$/.test(v) ? Number(v) : 0)

type PacienteTurno = {
  id: number; dni: string; nombre: string; apellido: string; celular: string; cobertura: string | null; obra_social_id: number | null
  obra_social: string | null; consultorio_id: number | null; incompleta: number; veces: number
}
type Consultorio = { id: number; nombre: string; modalidad: 'presencial' | 'videollamada'; direccion: string | null }
type Prestacion = { id: number; nombre: string; duracion_min: number; importe: number }

const leerPacienteTurno = (db: D1Database, id: number) => db.prepare(
  `SELECT p.id, p.dni, p.nombre, p.apellido, p.celular, p.cobertura, p.obra_social_id, os.nombre obra_social, p.consultorio_id,
          (p.fecha_nacimiento IS NULL OR p.domicilio IS NULL OR p.ocupacion IS NULL OR p.cobertura IS NULL) incompleta,
          (SELECT COUNT(*) FROM turnos t WHERE t.paciente_id = p.id AND t.estado = 'atendido') veces
     FROM pacientes p LEFT JOIN obras_sociales os ON os.id = p.obra_social_id WHERE p.id = ? AND p.baja_en IS NULL`).bind(id).first<PacienteTurno>()

/** La prestación que más probablemente corresponde: videoconsulta en videollamada, primera consulta o control. */
function prestacionPorDefecto(lista: Prestacion[], consultorio: Consultorio, primera: boolean) {
  const buscar = (re: RegExp) => lista.find((p) => re.test(p.nombre.normalize('NFD').replace(/\p{M}/gu, '')))
  const elegida = consultorio.modalidad === 'videollamada' ? buscar(/video/i) : primera ? buscar(/primera/i) : buscar(/control/i)
  return elegida ?? lista[0]
}

// ---------- Armado de la pantalla ----------
const Barra = ({ paso, paciente, quien, resto }: { paso: number; paciente?: string; quien?: string; resto?: { texto: string; href: string }[] }) => (
  <>
    <a class="volver" href="/"><Volver />Volver a Hoy</a>
    <h1>Dar turno</h1>
    <Pasos pasos={['Paciente', 'Día y hora', 'Guardar']} actual={paso} />
    {(paciente || resto?.length) && (
      <div class="fila-marcas elegidos">
        {paciente && <a class="pastilla" href={paciente}>{quien} · cambiar</a>}
        {resto?.map((r) => <a class="pastilla" href={r.href}>{r.texto} · cambiar</a>)}
      </div>
    )}
  </>
)

function FormAltaTurno({ datos, errores }: { datos?: Record<string, string | null>; errores?: Errores }) {
  const v = (k: string) => datos?.[k] ?? undefined
  return (
    <Tarjeta titulo="Paciente nuevo" accion={<a href="/turnos/nuevo">Cancelar</a>}>
      <form method="post" action="/turnos/paciente" class="columna" novalidate>
        <div class="campos-2">
          <Campo etiqueta="DNI" nombre="dni" modoTeclado="numeric" valor={v('dni')} error={errores?.dni} requerido autocompletar="off" autofocus />
          <Campo etiqueta="Celular" nombre="celular" tipo="tel" valor={v('celular')} error={errores?.celular} requerido autocompletar="off" />
          <Campo etiqueta="Nombre" nombre="nombre" valor={v('nombre')} error={errores?.nombre} requerido autocompletar="off" />
          <Campo etiqueta="Apellido" nombre="apellido" valor={v('apellido')} error={errores?.apellido} requerido autocompletar="off" />
        </div>
        <Campo etiqueta="Correo (opcional)" nombre="correo" tipo="email" valor={v('correo')} error={errores?.correo} autocompletar="off" />
        <p class="chico suave">Ficha nueva, con lo mínimo. El DNI es único: si ya existe, usamos esa ficha. El resto de los datos se completa antes de la primera consulta.</p>
        <div class="ventana-pie"><Boton type="submit" variante="oscuro">Guardar y seguir</Boton></div>
      </form>
    </Tarjeta>
  )
}

type Candidato = { id: number; nombre: string; apellido: string; dni: string; detalle: string }
function FilaCandidato({ p }: { p: Candidato }) {
  return (
    <li>
      <a class="fila-enlace" href={url({ paciente: String(p.id) })}>
        <span class="avatar-chico" aria-hidden="true">{iniciales(p.nombre, p.apellido)}</span>
        <span class="columna-chica"><strong>{p.nombre} {p.apellido}</strong><span class="suave chico">DNI {dniConPuntos(p.dni)}{p.detalle}</span></span>
      </a>
    </li>
  )
}

async function pasoPaciente(c: C, q: Q, opts: { errores?: Errores; datos?: Record<string, string | null>; mensaje?: string; status?: 200 | 422 }) {
  const { fecha: hoy } = ahoraAR()
  const busqueda = (q.q ?? '').trim().slice(0, 80)
  const [hallados, recientes] = await Promise.all([
    busqueda ? buscarPacientes(c.env.DB, busqueda, hoy) : Promise.resolve([]),
    busqueda ? Promise.resolve({ results: [] }) : c.env.DB.prepare(
      `SELECT p.id, p.nombre, p.apellido, p.dni, MAX(t.fecha) ultimo,
              (SELECT COUNT(*) FROM turnos a WHERE a.paciente_id = p.id AND a.estado = 'ausente') faltas
         FROM pacientes p JOIN turnos t ON t.paciente_id = p.id AND t.estado IN ('atendido', 'ausente')
        WHERE p.baja_en IS NULL GROUP BY p.id ORDER BY MAX(t.fecha) DESC, p.apellido LIMIT 6`).all<{ id: number; nombre: string; apellido: string; dni: string; ultimo: string; faltas: number }>(),
  ])
  const formulario = !!(q.nuevo || opts.errores)
  const filas: Candidato[] = busqueda
    ? hallados.filter((p) => !p.baja).slice(0, 8).map((p) => ({ ...p, detalle: ` · ${p.celular}` }))
    : (recientes.results ?? []).map((p) => ({ ...p, detalle: ` · vino el ${fechaCorta(p.ultimo)}${p.faltas ? ` · ${p.faltas === 1 ? '1 falta' : `${p.faltas} faltas`}` : ''}` }))
  return pagina(c, 'Dar turno', (
    <div class="angosto columna">
      <Barra paso={0} />
      {opts.mensaje && <Aviso tipo={q.aviso === 'existe' ? 'ambar' : 'error'}>{opts.mensaje}</Aviso>}
      {formulario ? <FormAltaTurno datos={opts.datos} errores={opts.errores} /> : (
        <Tarjeta titulo="¿Para quién es?">
          <form class="buscador" method="get" action="/turnos/nuevo" role="search">
            <Lupa />
            <label for="busca-turno" class="oculto-visual">Buscar paciente</label>
            <input id="busca-turno" name="q" type="search" value={busqueda} placeholder="Nombre, DNI o celular" autocomplete="off" />
          </form>
          <h3>{busqueda ? 'Resultados' : 'Últimos que vinieron'}</h3>
          {filas.length ? <ul class="lista">{filas.map((p) => <FilaCandidato p={p} />)}</ul>
            : <p class="suave vacio">{busqueda ? 'No encontramos pacientes con eso.' : 'Todavía no vino nadie. Empezá con un paciente nuevo.'}</p>}
          <div class="ventana-pie entre">
            <Boton href="/turnos/nuevo?nuevo=1" variante="oscuro"><Mas />Paciente nuevo</Boton>
          </div>
        </Tarjeta>
      )}
    </div>
  ), opts.status ?? 200)
}

type Estado = { error?: string; status?: 200 | 409 | 422 }

/** Pantalla de Dar turno. Los pasos salen de lo que ya se eligió: paciente → día y hora → guardar. */
export async function vistaNuevo(c: C, q: Q, estado: Estado = {}) {
  const { fecha: hoy, hora: ahora } = ahoraAR()
  const ahoraMin = aMinutos(ahora)
  const paciente = entero(q.paciente) ? await leerPacienteTurno(c.env.DB, entero(q.paciente)) : null
  if (!paciente) return pasoPaciente(c, q, { mensaje: estado.error ?? (q.paciente ? 'Esa ficha no está disponible: elegí otro paciente.' : q.aviso === 'existe' ? 'Ese DNI ya tenía ficha: elegí al paciente.' : undefined), status: estado.status === 422 ? 422 : 200 })

  const [cons, pres] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, nombre, modalidad, direccion FROM consultorios c WHERE activo = 1 AND EXISTS (SELECT 1 FROM horarios h WHERE h.consultorio_id = c.id) ORDER BY orden, nombre`).all<Consultorio>(),
    c.env.DB.prepare('SELECT id, nombre, duracion_min, importe FROM prestaciones WHERE activa = 1 ORDER BY orden, nombre').all<Prestacion>(),
  ])
  const consultorios = cons.results ?? [], prestaciones = pres.results ?? []
  if (!consultorios.length || !prestaciones.length) {
    return pagina(c, 'Dar turno', (
      <div class="angosto columna">
        <Barra paso={1} paciente={url({})} quien={`${paciente.nombre} ${paciente.apellido}`} />
        <Tarjeta><p>Para dar turnos hace falta al menos un consultorio con horarios y una prestación activa.</p>
          <div class="fila"><Boton href="/configuracion" variante="oscuro">Ir a Configuración</Boton></div></Tarjeta>
      </div>
    ))
  }
  const consultorio = consultorios.find((x) => x.id === entero(q.consultorio)) ?? consultorios.find((x) => x.id === paciente.consultorio_id) ?? consultorios[0]
  const prestacion = prestaciones.find((x) => x.id === entero(q.prestacion)) ?? prestacionPorDefecto(prestaciones, consultorio, paciente.veces === 0)
  const base: Q = { paciente: String(paciente.id), consultorio: String(consultorio.id), prestacion: String(prestacion.id) }
  const quien = `${paciente.nombre} ${paciente.apellido}`
  const cambiarPaciente = url({})

  const eligio = q.fecha && q.hora && esFecha(q.fecha) && esHora(q.hora)
  const primera = eligio ? q.fecha! : hoy
  const agenda = await cargarAgenda(c.env.DB, primera, sumarDias(primera, eligio ? 0 : DIAS_A_OFRECER), ahoraISO())

  // ----- Paso 3: revisar y guardar -----
  if (eligio) {
    const fecha = q.fecha!, hora = q.hora!
    const dia = diaDe(agenda, consultorio.id, fecha)
    const control = controlar(dia, hora, prestacion.duracion_min, hoy, ahoraMin)
    return pagina(c, 'Dar turno', (
      <PasoGuardar {...{ paciente, consultorio, consultorios, prestacion, prestaciones, base, fecha, hora, control, quien, cambiarPaciente, q, error: estado.error, hoy }} />
    ), estado.status ?? 200)
  }

  // ----- Paso 2: día y hora -----
  const dias: Dia[] = []
  for (let i = 0; i <= DIAS_A_OFRECER && dias.length < MAX_PASTILLAS; i++) {
    const d = diaDe(agenda, consultorio.id, sumarDias(hoy, i))
    if (d.franjas.length) dias.push(d)
  }
  const libres = (d: Dia) => huecos(d, prestacion.duracion_min, hoy, ahoraMin)
  const elegido = dias.find((d) => d.fecha === q.fecha) ?? dias.find((d) => libres(d).length) ?? dias[0]
  const lista = elegido ? libres(elegido) : []
  const linkDia = (fecha: string) => url({ ...base, fecha })
  return pagina(c, 'Dar turno', (
    <div class="angosto columna">
      <Barra paso={1} paciente={cambiarPaciente} quien={quien} />
      {estado.error && <Aviso tipo="error">{estado.error}</Aviso>}
      <Tarjeta titulo="¿Cuándo?">
        <div class="columna">
          <div class="fila-marcas" role="group" aria-label="Consultorio">
            {consultorios.map((x) => <a class="pastilla" href={url({ paciente: base.paciente, consultorio: String(x.id) })} aria-current={x.id === consultorio.id ? 'true' : undefined}>{x.nombre}</a>)}
          </div>
          <div class="fila-marcas" role="group" aria-label="Prestación">
            {prestaciones.map((x) => (
              <a class="pastilla" href={url({ paciente: base.paciente, consultorio: base.consultorio, prestacion: String(x.id), fecha: elegido?.fecha })} aria-current={x.id === prestacion.id ? 'true' : undefined}>
                {x.nombre} · {x.duracion_min} min
              </a>
            ))}
          </div>
        </div>
        {dias.length ? (
          <>
            <nav class="fila-marcas" aria-label="Días">
              {dias.map((d) => {
                const dow = new Date(d.fecha + 'T00:00:00Z').getUTCDay()
                const clase = ['pastilla', 'dia', d.cerrado?.tipo === 'bloqueo' && 'rayado', d.cerrado?.tipo === 'feriado' && 'rayado feriado'].filter(Boolean).join(' ')
                return (
                  <a class={clase} href={linkDia(d.fecha)} aria-current={d.fecha === elegido?.fecha ? 'true' : undefined}>
                    {DIAS[dow].slice(0, 3)} {Number(d.fecha.slice(8, 10))}/{Number(d.fecha.slice(5, 7))}
                    {d.cerrado && <span class="oculto-visual"> ({d.cerrado.tipo === 'feriado' ? 'feriado' : 'bloqueado'})</span>}
                  </a>
                )
              })}
            </nav>
            {elegido && <h3>{fechaLarga(elegido.fecha)}</h3>}
            {elegido?.cerrado?.tipo === 'feriado' && (
              <div class="aviso franja">
                <span>Feriado: {elegido.cerrado.texto}. Figura sin atención.</span>
                <form method="post" action="/turnos/feriado">
                  <input type="hidden" name="fecha" value={elegido.fecha} />
                  <input type="hidden" name="volver" value={linkDia(elegido.fecha)} />
                  <Boton type="submit" variante="borde">Atiendo este día</Boton>
                </form>
              </div>
            )}
            {elegido?.cerrado?.tipo === 'bloqueo' && <Aviso tipo="ambar">Esta fecha está bloqueada ({elegido.cerrado.texto}). Se libera desde «Bloquear la agenda».</Aviso>}
            {elegido && !elegido.cerrado && (lista.length ? <Huecos lista={lista} fecha={elegido.fecha} base={base} /> : <p class="suave">No quedan huecos libres este día para {prestacion.nombre.toLowerCase()}.</p>)}
            {elegido && !elegido.cerrado && (
              <form method="get" action="/turnos/nuevo" class="fila otra-hora">
                {Object.entries(base).map(([k, v]) => <input type="hidden" name={k} value={v} />)}
                <input type="hidden" name="fecha" value={elegido.fecha} />
                <div class="campo">
                  <label for="otra-hora">Otra hora</label>
                  <input id="otra-hora" class="entrada" type="time" name="hora" step="300" required />
                </div>
                <Boton type="submit" variante="borde">Usar esta hora</Boton>
              </form>
            )}
          </>
        ) : <p class="suave">Este consultorio no tiene días de atención cargados.</p>}
      </Tarjeta>
    </div>
  ), estado.status ?? 200)
}

function Huecos({ lista, fecha, base }: { lista: string[]; fecha: string; base: Q }) {
  const grupo = (titulo: string, horas: string[]) => horas.length ? (
    <div class="columna-chica">
      <span class="etiqueta">{titulo}</span>
      <div class="fila-marcas">{horas.map((h) => <a class="pastilla hueco" href={url({ ...base, fecha, hora: h })}>{h}</a>)}</div>
    </div>
  ) : null
  return <div class="columna">{grupo('Mañana', lista.filter((h) => h < '13:00'))}{grupo('Tarde', lista.filter((h) => h >= '13:00'))}</div>
}

function PasoGuardar(p: {
  paciente: PacienteTurno; consultorio: Consultorio; consultorios: Consultorio[]; prestacion: Prestacion; prestaciones: Prestacion[]; base: Q
  fecha: string; hora: string; control: Control; quien: string; cambiarPaciente: string; q: Q; error?: string; hoy: string
}) {
  const { paciente, consultorio, prestacion, prestaciones, base, fecha, hora, control, quien } = p
  const elegidos = [{ texto: `${fechaLarga(fecha)} · ${hora}`, href: url({ ...base, fecha }) }]
  const forzar = control.avisos.length > 0
  const importe = prestacion.importe === 0 ? 'Sin cargo' : pesos(prestacion.importe)
  return (
    <div class="angosto columna">
      <Barra paso={2} paciente={p.cambiarPaciente} quien={quien} resto={elegidos} />
      {p.error && <Aviso tipo="error">{p.error}</Aviso>}
      {control.errores.map((e) => <Aviso tipo="error">{e}</Aviso>)}
      {control.avisos.map((a) => <Aviso tipo="ambar">{a.texto}</Aviso>)}
      {paciente.incompleta === 1 && <Aviso>La ficha de {paciente.nombre} está incompleta: se completa antes de la primera consulta.</Aviso>}
      <Tarjeta titulo="Revisá y guardá">
        <div class="resumen-turno">
          <div class="dato-chico"><span class="suave chico">Paciente</span><strong>{quien}</strong><span class="chico suave">DNI {dniConPuntos(paciente.dni)}</span></div>
          <div class="dato-chico"><span class="suave chico">Cuándo</span><strong>{fechaLarga(fecha)}</strong><span class="chico suave">{hora} · {prestacion.duracion_min} min · {consultorio.nombre}</span></div>
          <div class="dato-chico"><span class="suave chico">Prestación</span><strong>{prestacion.nombre}</strong>
            <details class="desplegable"><summary>Cambiar</summary>
              <div class="fila-marcas">{prestaciones.map((x) => <a class="pastilla" href={url({ ...base, prestacion: String(x.id), fecha, hora })} aria-current={x.id === prestacion.id ? 'true' : undefined}>{x.nombre}</a>)}</div>
            </details></div>
          <div class="dato-chico"><span class="suave chico">Importe</span><strong>{importe}</strong><span class="chico suave">{paciente.cobertura === 'obra_social' ? paciente.obra_social : 'Particular'}</span></div>
        </div>
        <form method="post" action="/turnos" class="columna" novalidate>
          <input type="hidden" name="paciente" value={base.paciente} />
          <input type="hidden" name="consultorio" value={base.consultorio} />
          <input type="hidden" name="prestacion" value={base.prestacion} />
          <input type="hidden" name="fecha" value={fecha} />
          <input type="hidden" name="hora" value={hora} />
          {forzar && <input type="hidden" name="forzar" value="1" />}
          <Interruptor etiqueta="Repetir" nombre="repetir" ayuda="Un turno igual cada tantas semanas, hasta la fecha que elijas. Los días que no se puedan, se saltean." />
          <div class="campos-2">
            <div class="campo">
              <label for="c-cada">Cada</label>
              <select id="c-cada" name="cada" class="entrada">{[1, 2, 3, 4, 6, 8, 12].map((n) => <option value={n} selected={n === 1}>{n === 1 ? '1 semana' : `${n} semanas`}</option>)}</select>
            </div>
            <Campo etiqueta="Hasta el" nombre="hasta" tipo="date" valor={sumarDias(fecha, 28)} />
          </div>
          <Interruptor etiqueta="Avisarle" nombre="avisar" marcado ayuda="Al guardar, te dejamos el mensaje listo para mandarle por WhatsApp." />
          <div class="ventana-pie">
            {control.errores.length
              ? <Boton href={url({ ...base, fecha })} variante="oscuro">Elegir otra hora</Boton>
              : <Boton type="submit" variante="destacado">{forzar ? 'Guardar igual' : 'Guardar turno'}</Boton>}
          </div>
        </form>
      </Tarjeta>
    </div>
  )
}

turnos.get('/turnos/nuevo', (c) => vistaNuevo(c, c.req.query()))

// ---------- Alta rápida dentro de Dar turno ----------
turnos.post('/turnos/paciente', async (c) => {
  const { datos, errores } = validarAlta(await c.req.parseBody())
  if (Object.keys(errores).length) return pasoPaciente(c, {}, { errores, datos, status: 422 })
  const db = c.env.DB
  const existe = await db.prepare('SELECT id FROM pacientes WHERE dni = ?').bind(datos.dni).first<{ id: number }>()
  if (existe) return c.redirect(url({ paciente: String(existe.id) }))
  try {
    const r = await db.prepare('INSERT INTO pacientes (dni, nombre, apellido, celular, correo) VALUES (?, ?, ?, ?, ?) RETURNING id')
      .bind(datos.dni, datos.nombre, datos.apellido, datos.celular, datos.correo).first<{ id: number }>()
    await registrar(c, 'paciente_alta', `paciente:${r!.id}`, c.get('email'))
    return c.redirect(url({ paciente: String(r!.id) }))
  } catch (e) {
    const otro = await db.prepare('SELECT id FROM pacientes WHERE dni = ?').bind(datos.dni).first<{ id: number }>()
    if (otro) return c.redirect(url({ paciente: String(otro.id) }))
    throw e
  }
})

// ---------- «Atiendo este día»: un feriado deja de figurar sin atención ----------
turnos.post('/turnos/feriado', async (c) => {
  const f = await c.req.parseBody()
  const fecha = typeof f.fecha === 'string' ? f.fecha : ''
  const volver = typeof f.volver === 'string' && f.volver.startsWith('/turnos/nuevo?') ? f.volver : '/turnos/nuevo'
  if (esFecha(fecha)) {
    const r = await c.env.DB.prepare('UPDATE feriados SET atiende = 1 WHERE fecha = ? AND atiende IS NOT 1').bind(fecha).run()
    if (r.meta.changes) await registrar(c, 'feriado_atiende', fecha, c.get('email'))
  }
  return c.redirect(volver)
})

// ---------- Guardar ----------
turnos.post('/turnos', async (c) => {
  const form = await c.req.parseBody() as Record<string, string>
  const volver = (error: string, status: 409 | 422 = 422) => vistaNuevo(c, form, { error, status })
  const { fecha: hoy, hora: ahora } = ahoraAR()
  const { datos, error } = leerTurno(form)
  if (!datos) return volver(error!)
  const db = c.env.DB

  const [paciente, consultorio, prestacion] = await Promise.all([
    leerPacienteTurno(db, datos.paciente_id),
    db.prepare('SELECT id, nombre, modalidad, direccion FROM consultorios WHERE id = ? AND activo = 1').bind(datos.consultorio_id).first<Consultorio>(),
    db.prepare('SELECT id, nombre, duracion_min, importe FROM prestaciones WHERE id = ? AND activa = 1').bind(datos.prestacion_id).first<Prestacion>(),
  ])
  if (!paciente || !consultorio || !prestacion) return volver('El paciente, el consultorio o la prestación ya no están disponibles. Elegí de nuevo.')

  const fechas = datos.repetir ? fechasDeSerie(datos.fecha, datos.repetir.cada, datos.repetir.hasta) : [datos.fecha]
  const agenda: DatosAgenda = await cargarAgenda(db, datos.fecha, fechas[fechas.length - 1], ahoraISO())
  const controlDe = (fecha: string) => controlar(diaDe(agenda, consultorio.id, fecha), datos.hora, prestacion.duracion_min, hoy, aMinutos(ahora))

  const primero = controlDe(datos.fecha)
  if (primero.errores.length) return volver(primero.errores.join(' '))
  if (primero.avisos.length && !datos.forzar) return volver('Revisá los avisos y confirmá si querés guardar igual.', 409)

  let serieId: number | null = null
  if (fechas.length > 1) {
    serieId = (await db.prepare('INSERT INTO series (cada_semanas, hasta) VALUES (?, ?) RETURNING id').bind(datos.repetir!.cada, datos.repetir!.hasta).first<{ id: number }>())!.id
  }
  const nuevo = (fecha: string, atencion: 'primera' | 'control') => ({
    paciente_id: paciente.id, consultorio_id: consultorio.id, fecha, hora: datos.hora, duracion_min: prestacion.duracion_min, prestacion_id: prestacion.id,
    cobertura: (paciente.cobertura === 'obra_social' && paciente.obra_social_id ? 'obra_social' : 'particular') as 'obra_social' | 'particular',
    obra_social_id: paciente.cobertura === 'obra_social' ? paciente.obra_social_id : null, modalidad: consultorio.modalidad, atencion, serie_id: serieId,
  })
  const id = await crearTurno(db, nuevo(datos.fecha, paciente.veces === 0 ? 'primera' : 'control'), datos.forzar && primero.avisos.length > 0)
  if (!id) return volver('Ese horario se ocupó recién. Elegí otro.', 409)

  const salteados: string[] = []
  for (const fecha of fechas.slice(1)) {
    const r = controlDe(fecha)
    const sirve = !r.errores.length && !r.avisos.some((a) => a.tipo === 'superpone') && (datos.forzar || !r.avisos.length)
    if (!sirve || !(await crearTurno(db, nuevo(fecha, 'control'), false))) salteados.push(fecha)
  }
  await registrar(c, 'turno_alta', `turno:${id}${fechas.length > 1 ? ` · serie de ${fechas.length - salteados.length}` : ''}`, c.get('email'))
  const salida = new URLSearchParams()
  if (datos.avisar) salida.set('avisar', '1')
  if (salteados.length) salida.set('salteados', salteados.join(','))
  return c.redirect(`/turnos/${id}/listo${salida.size ? `?${salida}` : ''}`)
})

// ---------- Turno dado ----------
turnos.get('/turnos/:id{[0-9]+}/listo', async (c) => {
  const id = Number(c.req.param('id'))
  const t = await c.env.DB.prepare(
    `SELECT t.id, t.fecha, t.hora, t.duracion_min, t.serie_id, p.id paciente_id, p.nombre, p.apellido, p.celular, co.nombre consultorio, co.direccion, co.modalidad, pr.nombre prestacion,
            s.cada_semanas, s.hasta, (SELECT COUNT(*) FROM turnos x WHERE x.serie_id = t.serie_id AND x.estado <> 'cancelado') en_serie
       FROM turnos t JOIN pacientes p ON p.id = t.paciente_id JOIN consultorios co ON co.id = t.consultorio_id
       LEFT JOIN prestaciones pr ON pr.id = t.prestacion_id LEFT JOIN series s ON s.id = t.serie_id WHERE t.id = ?`).bind(id).first<{
      id: number; fecha: string; hora: string; duracion_min: number; serie_id: number | null; paciente_id: number; nombre: string; apellido: string; celular: string
      consultorio: string; direccion: string | null; modalidad: string; prestacion: string | null; cada_semanas: number | null; hasta: string | null; en_serie: number
    }>()
  if (!t) return c.notFound()
  const prof = await datosProfesional(c)
  const salteados = (c.req.query('salteados') ?? '').split(',').filter(esFecha).slice(0, MAX_AVISADOS)
  const lugar = t.modalidad === 'videollamada' ? 'por videollamada' : `en ${t.consultorio}${t.direccion ? ` (${t.direccion})` : ''}`
  const mensaje = `Hola ${t.nombre}, te damos turno el ${fechaLarga(t.fecha).toLowerCase()} a las ${t.hora} ${lugar}.${prof.nombre ? ` ${prof.nombre}.` : ''} ¡Te esperamos!`
  const avisar = c.req.query('avisar') === '1'
  return pagina(c, 'Turno dado', (
    <div class="angosto columna">
      <a class="volver" href="/"><Volver />Volver a Hoy</a>
      <h1>Turno dado</h1>
      <Tarjeta titulo={`${t.nombre} ${t.apellido}`}>
        <dl class="datos">
          <dt>Cuándo</dt><dd>{fechaLarga(t.fecha)} · {t.hora}</dd>
          <dt>Dónde</dt><dd>{t.consultorio}</dd>
          <dt>Prestación</dt><dd>{t.prestacion ?? '—'} · {t.duracion_min} min</dd>
          {t.serie_id && <><dt>Se repite</dt><dd>{t.en_serie} turnos, cada {t.cada_semanas === 1 ? 'semana' : `${t.cada_semanas} semanas`} hasta el {t.hasta}</dd></>}
        </dl>
        {salteados.length > 0 && <Aviso tipo="ambar">No se pudieron dar {salteados.length === 1 ? 'el turno del' : 'los turnos de los'} {salteados.map((f) => fechaCorta(f)).join(', ')}: estaban ocupados, bloqueados o sin atención.</Aviso>}
        <div class="ventana-pie entre">
          <Boton href={`/pacientes/${t.paciente_id}?tab=turnos`} variante="borde">Ver ficha</Boton>
          <div class="fila">
            <Boton href="/turnos/nuevo" variante="borde">Dar otro turno</Boton>
            {avisar
              ? <Boton href={enlaceWhatsapp(t.celular, mensaje)} variante="destacado">Avisarle por WhatsApp</Boton>
              : <Boton href="/" variante="oscuro">Volver a Hoy</Boton>}
          </div>
        </div>
      </Tarjeta>
    </div>
  ))
})
