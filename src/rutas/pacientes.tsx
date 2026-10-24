import { HerramientasDocumentos } from './documentos'
// P1 · Pacientes: lista con buscador, filtros y orden; alta rápida con DNI; ficha con sus pestañas; editar; dar de baja y reactivar.
// Maquetas: docs/pantallas/Pacientes.dc.html y Ficha.dc.html · docs/DISENO_APROBADO.md, secciones 9 y 10.
import { Hono } from 'hono'
import type { Child } from 'hono/jsx'
import type { C, Env } from '../tipos'
import { leerInstalacion, habilitado } from '../lib/instalacion'
import { ahoraAR, ahoraISO } from '../lib/fechas'
import { registrar } from '../lib/sesion'
import {
  FILTROS, ORDENES, MOTIVOS_BAJA, buscarPacientes, contarPorFiltro, filtrarYOrdenar, filaDePaciente, marcas, validarAlta, validarFicha,
  fechaCorta, fechaNumeros, edad, dniConPuntos, enlaceWhatsapp, iniciales, textoMotivo,
  type Errores, type Filtro, type Orden, type FilaPaciente,
} from '../lib/pacientes'
import { Pagina } from '../ui/pagina'
import { Aviso, Boton, Campo, Estado, Pastilla, Tarjeta, Ventana, pesos } from '../ui/componentes'
import { Lupa, Mas, Volver } from '../ui/iconos'
import { datosProfesional, avisosSinLeer } from './inicio'

export const pacientes = new Hono<Env>()

const POR_PAGINA = 50

async function pagina(c: C, titulo: string, hijos: Child, status: 200 | 404 | 409 | 422 = 200) {
  const [prof, avisos] = await Promise.all([datosProfesional(c), avisosSinLeer(c)])
  return c.html(
    <Pagina titulo={titulo} seccion="pacientes" inst={leerInstalacion(c.env)} email={c.get('email')!} nombre={prof.nombre} avisos={avisos}>
      {hijos}
    </Pagina>, status)
}

const proximoTexto = (p: string | null, hoy: string) => {
  if (!p) return 'Sin turno'
  const [f, h] = p.split(' ')
  return `${f === hoy ? 'Hoy' : fechaCorta(f)} · ${h}`
}

const Lapiz = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" /></svg>
)
const Charla = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20l1.3-3.9A8 8 0 1 1 8 19z" /></svg>
)

// ---------- Formularios ----------
function FormAlta({ datos, errores }: { datos?: Record<string, string | null | undefined>; errores?: Errores }) {
  const v = (k: string) => datos?.[k] ?? undefined
  return (
    <form method="post" action="/pacientes" class="columna" novalidate>
      <div class="campos-2">
        <Campo etiqueta="DNI" nombre="dni" modoTeclado="numeric" valor={v('dni')} error={errores?.dni} requerido autocompletar="off" />
        <Campo etiqueta="Celular" nombre="celular" tipo="tel" valor={v('celular')} error={errores?.celular} requerido autocompletar="off" />
        <Campo etiqueta="Nombre" nombre="nombre" valor={v('nombre')} error={errores?.nombre} requerido autocompletar="off" />
        <Campo etiqueta="Apellido" nombre="apellido" valor={v('apellido')} error={errores?.apellido} requerido autocompletar="off" />
      </div>
      <Campo etiqueta="Correo (opcional)" nombre="correo" tipo="email" valor={v('correo')} error={errores?.correo} autocompletar="off" />
      <p class="chico suave">El DNI es único: si ya existe, te mostramos esa ficha. El resto de los datos se completan en la ficha, antes de la primera consulta.</p>
      <div class="ventana-pie">
        <Boton type="submit" variante="oscuro">Guardar paciente</Boton>
      </div>
    </form>
  )
}

type Opcion = { valor: string; texto: string }
function Selector({ etiqueta, nombre, opciones, elegida, error }: { etiqueta: string; nombre: string; opciones: Opcion[]; elegida?: string; error?: string }) {
  const id = `c-${nombre}`
  return (
    <div class="campo">
      <label for={id}>{etiqueta}</label>
      <select id={id} name={nombre} class="entrada" aria-invalid={error ? 'true' : undefined} aria-describedby={error ? `${id}-error` : undefined}>
        {opciones.map((o) => <option value={o.valor} selected={o.valor === elegida}>{o.texto}</option>)}
      </select>
      {error && <p id={`${id}-error`} class="ayuda" role="alert">{error}</p>}
    </div>
  )
}

type Paciente = {
  id: number; dni: string; nombre: string; apellido: string; celular: string; correo: string | null
  fecha_nacimiento: string | null; domicilio: string | null; ocupacion: string | null; cobertura: string | null
  obra_social_id: number | null; obra_social: string | null; numero_afiliado: string | null
  consultorio_id: number | null; consultorio: string | null; recordatorios_baja: number
  baja_en: string | null; baja_motivo: string | null; baja_detalle: string | null
}

async function leerPaciente(c: C, id: number) {
  return c.env.DB.prepare(
    `SELECT p.*, os.nombre obra_social, co.nombre consultorio FROM pacientes p
       LEFT JOIN obras_sociales os ON os.id = p.obra_social_id LEFT JOIN consultorios co ON co.id = p.consultorio_id WHERE p.id = ?`
  ).bind(id).first<Paciente>()
}

async function opcionesFicha(c: C, p?: { obra_social_id: number | null; consultorio_id: number | null }) {
  const [os, cons] = await Promise.all([
    c.env.DB.prepare('SELECT id, nombre FROM obras_sociales WHERE en_uso = 1 OR id = ? ORDER BY nombre').bind(p?.obra_social_id ?? -1).all<{ id: number; nombre: string }>(),
    c.env.DB.prepare('SELECT id, nombre FROM consultorios WHERE activo = 1 OR id = ? ORDER BY orden, nombre').bind(p?.consultorio_id ?? -1).all<{ id: number; nombre: string }>(),
  ])
  return {
    coberturas: [{ valor: '', texto: 'Sin completar' }, { valor: 'particular', texto: 'Particular' }, ...(os.results ?? []).map((o) => ({ valor: `os:${o.id}`, texto: o.nombre }))],
    consultorios: [{ valor: '', texto: 'Sin elegir' }, ...(cons.results ?? []).map((o) => ({ valor: String(o.id), texto: o.nombre }))],
  }
}

type ValoresFicha = Record<string, string | undefined>
const valoresDe = (p: Paciente): ValoresFicha => ({
  dni: p.dni, nombre: p.nombre, apellido: p.apellido, celular: p.celular, correo: p.correo ?? '', fecha_nacimiento: p.fecha_nacimiento ?? '',
  domicilio: p.domicilio ?? '', ocupacion: p.ocupacion ?? '', numero_afiliado: p.numero_afiliado ?? '',
  cobertura: p.cobertura === 'obra_social' ? `os:${p.obra_social_id}` : p.cobertura ?? '', consultorio_id: p.consultorio_id ? String(p.consultorio_id) : '',
  recordatorios: p.recordatorios_baja ? '' : '1',
})

function FormEditar({ id, valores, errores, opciones, avisoDni, otroId }: {
  id: number; valores: ValoresFicha; errores?: Errores; opciones: Awaited<ReturnType<typeof opcionesFicha>>; avisoDni?: string; otroId?: number
}) {
  return (
    <form method="post" action={`/pacientes/${id}/editar`} class="columna" novalidate>
      <div class="campos-2">
        <Campo etiqueta="Nombre" nombre="nombre" valor={valores.nombre} error={errores?.nombre} requerido autocompletar="off" />
        <Campo etiqueta="Apellido" nombre="apellido" valor={valores.apellido} error={errores?.apellido} requerido autocompletar="off" />
        <Campo etiqueta="DNI" nombre="dni" modoTeclado="numeric" valor={valores.dni} error={errores?.dni} requerido autocompletar="off" />
        <Campo etiqueta="Nacimiento" nombre="fecha_nacimiento" tipo="date" valor={valores.fecha_nacimiento} error={errores?.fecha_nacimiento} />
        <Campo etiqueta="Celular" nombre="celular" tipo="tel" valor={valores.celular} error={errores?.celular} requerido autocompletar="off" />
        <Campo etiqueta="Correo" nombre="correo" tipo="email" valor={valores.correo} error={errores?.correo} autocompletar="off" />
        <Campo etiqueta="Domicilio" nombre="domicilio" valor={valores.domicilio} error={errores?.domicilio} autocompletar="off" />
        <Campo etiqueta="Ocupación" nombre="ocupacion" valor={valores.ocupacion} error={errores?.ocupacion} autocompletar="off" />
        <Selector etiqueta="Cobertura" nombre="cobertura" opciones={opciones.coberturas} elegida={valores.cobertura} error={errores?.cobertura} />
        <Campo etiqueta="N.º de afiliado" nombre="numero_afiliado" valor={valores.numero_afiliado} error={errores?.numero_afiliado} ayuda="Solo con obra social." autocompletar="off" />
        <Selector etiqueta="Consultorio" nombre="consultorio_id" opciones={opciones.consultorios} elegida={valores.consultorio_id} />
      </div>
      <div class="interruptor">
        <label for="i-recordatorios"><span class="etiqueta">Mandarle recordatorios de turno</span></label>
        <input id="i-recordatorios" type="checkbox" role="switch" name="recordatorios" value="1" checked={valores.recordatorios === '1'} />
      </div>
      {otroId && <Aviso tipo="error">Ese DNI ya es de otro paciente. <a href={`/pacientes/${otroId}`}>Ver su ficha</a></Aviso>}
      {avisoDni && (
        <>
          <Aviso tipo="ambar">{avisoDni}</Aviso>
          <input type="hidden" name="confirmar_dni" value={valores.dni} />
        </>
      )}
      <p class="chico suave">Cada cambio queda registrado con la fecha.</p>
      <div class="ventana-pie entre">
        <Boton variante="peligro" abre="ventana-baja" href={`/pacientes/${id}?baja=1`}>Dar de baja al paciente</Boton>
        <Boton type="submit" variante="oscuro">{avisoDni ? 'Sí, cambiar el DNI y guardar' : 'Guardar cambios'}</Boton>
      </div>
    </form>
  )
}

// ---------- Lista ----------
pacientes.get('/pacientes', async (c) => {
  const { fecha: hoy } = ahoraAR()
  const q = (c.req.query('q') ?? '').slice(0, 80)
  const filtro = (FILTROS.some((f) => f.id === c.req.query('filtro')) ? c.req.query('filtro') : 'todos') as Filtro
  const orden = (ORDENES.includes(c.req.query('orden') as Orden) ? c.req.query('orden') : 'nombre') as Orden
  const cuantos = Math.min(Math.max(Number(c.req.query('n')) || POR_PAGINA, POR_PAGINA), 2000)
  const filas = await buscarPacientes(c.env.DB, q, hoy)
  const cuenta = contarPorFiltro(filas)
  const lista = filtrarYOrdenar(filas, filtro, orden)
  const enlace = (cambios: Record<string, string | number>) => {
    const u = new URLSearchParams({ ...(q && { q }), ...(filtro !== 'todos' && { filtro }), ...(orden !== 'nombre' && { orden }) })
    for (const [k, v] of Object.entries(cambios)) v === '' ? u.delete(k) : u.set(k, String(v))
    const s = u.toString()
    return `/pacientes${s ? `?${s}` : ''}`
  }
  const Columna = ({ id, texto }: { id: Orden; texto: string }) => (
    <a href={enlace({ orden: id === 'nombre' ? '' : id, n: '' })} aria-current={orden === id ? 'true' : undefined} class="orden">
      {texto}{orden === id ? <span aria-hidden="true"> ↓</span> : null}
      {orden === id && <span class="oculto-visual"> (ordenado así)</span>}
    </a>
  )
  const total = cuenta.todos
  return pagina(c, 'Pacientes', <>
    <section class="encabezado">
      <div class="columna-chica">
        <h1>Pacientes</h1>
        <span class="portada-sub">{total === 1 ? '1 paciente' : `${total} pacientes`}</span>
      </div>
      <div class="fila encabezado-acciones">
        <form class="buscador" method="get" action="/pacientes" role="search">
          <Lupa />
          <label for="busca" class="oculto-visual">Buscar paciente</label>
          <input id="busca" name="q" type="search" value={q} placeholder="Buscar por nombre, DNI o celular" />
          {filtro !== 'todos' && <input type="hidden" name="filtro" value={filtro} />}
          {orden !== 'nombre' && <input type="hidden" name="orden" value={orden} />}
        </form>
        <Boton variante="destacado" href="/pacientes/nuevo" abre="ventana-nuevo"><Mas />Paciente nuevo</Boton>
      </div>
    </section>
    <nav class="fila" aria-label="Filtrar pacientes">
      {FILTROS.map((f) => (
        <Pastilla href={enlace({ filtro: f.id === 'todos' ? '' : f.id, n: '' })} actual={f.id === filtro} cuenta={f.id === 'todos' ? undefined : cuenta[f.id]}>{f.texto}</Pastilla>
      ))}
    </nav>
    <section class="tarjeta tabla-pacientes" aria-label="Lista de pacientes">
      <div class="fila-tabla cabeza-tabla">
        <Columna id="nombre" texto="Paciente" />
        <span>Celular</span>
        <Columna id="ultimo" texto="Último turno" />
        <Columna id="proximo" texto="Próximo turno" />
        <span class="derecha">Saldo</span>
      </div>
      {lista.slice(0, cuantos).map((p) => <FilaLista p={p} hoy={hoy} />)}
      {lista.length === 0 && (
        <p class="suave vacio">{q ? `No encontramos pacientes con «${q}».` : 'No hay pacientes con ese filtro.'}</p>
      )}
      {lista.length > cuantos && (
        <div class="fila centro"><Boton href={enlace({ n: cuantos + POR_PAGINA })} variante="borde">Ver más pacientes</Boton></div>
      )}
    </section>
    <Ventana id="ventana-nuevo" titulo="Paciente nuevo"><FormAlta /></Ventana>
  </>)
})

function FilaLista({ p, hoy }: { p: FilaPaciente; hoy: string }) {
  return (
    <a class="fila-tabla fila-paciente" href={`/pacientes/${p.id}`}>
      <span class="celda-paciente">
        <span class="avatar-chico" aria-hidden="true">{iniciales(p.nombre, p.apellido)}</span>
        <span class="columna-chica">
          <strong>{p.nombre} {p.apellido}</strong>
          <span class="fila-marcas">{marcas(p).map((m) => <Estado estado={m.estado} texto={m.texto} />)}</span>
        </span>
      </span>
      <span><span class="solo-celular suave">Celular </span>{p.celular}</span>
      <span><span class="solo-celular suave">Último </span>{p.ultimo === hoy ? 'Hoy' : fechaCorta(p.ultimo)}</span>
      <span><span class="solo-celular suave">Próximo </span>{proximoTexto(p.proximo, hoy)}</span>
      <span class={p.saldo > 0 ? 'derecha importe debe-texto' : 'derecha suave'}>{p.saldo > 0 ? pesos(p.saldo) : '—'}</span>
    </a>
  )
}

// ---------- Alta rápida ----------
pacientes.get('/pacientes/nuevo', (c) =>
  pagina(c, 'Paciente nuevo', <AltaSola />))

function AltaSola({ datos, errores }: { datos?: Record<string, string | null>; errores?: Errores }) {
  return (
    <div class="angosto columna">
      <a class="volver" href="/pacientes"><Volver />Pacientes</a>
      <Tarjeta titulo="Paciente nuevo"><FormAlta datos={datos ?? undefined} errores={errores} /></Tarjeta>
    </div>
  )
}

pacientes.post('/pacientes', async (c) => {
  const { datos, errores } = validarAlta(await c.req.parseBody())
  if (Object.keys(errores).length) return pagina(c, 'Paciente nuevo', <AltaSola datos={datos} errores={errores} />, 422)
  const existe = await c.env.DB.prepare('SELECT id FROM pacientes WHERE dni = ?').bind(datos.dni).first<{ id: number }>()
  if (existe) return c.redirect(`/pacientes/${existe.id}?aviso=existe`)
  try {
    const r = await c.env.DB.prepare('INSERT INTO pacientes (dni, nombre, apellido, celular, correo) VALUES (?, ?, ?, ?, ?) RETURNING id')
      .bind(datos.dni, datos.nombre, datos.apellido, datos.celular, datos.correo).first<{ id: number }>()
    await registrar(c, 'paciente_alta', `paciente:${r!.id}`, c.get('email'))
    return c.redirect(`/pacientes/${r!.id}?aviso=nuevo`)
  } catch (e) {
    // otro envío con el mismo DNI ganó la carrera: se muestra esa ficha
    const otro = await c.env.DB.prepare('SELECT id FROM pacientes WHERE dni = ?').bind(datos.dni).first<{ id: number }>()
    if (otro) return c.redirect(`/pacientes/${otro.id}?aviso=existe`)
    throw e
  }
})

// ---------- Ficha ----------
const PESTANAS = [
  { id: 'resumen', texto: 'Resumen' },
  { id: 'historia', texto: 'Historia clínica' },
  { id: 'turnos', texto: 'Turnos' },
  { id: 'pagos', texto: 'Pagos', modulo: 'cobros' as const },
  { id: 'documentos', texto: 'Documentos', modulo: 'documentos' as const },
]

const ESTADO_COBRO: Record<string, { estado: string; texto: string }> = {
  pagado: { estado: 'atendido', texto: 'Pagado' }, parcial: { estado: 'debe', texto: 'Pagó una parte' }, debe: { estado: 'debe', texto: 'Debe' },
  sin_cargo: { estado: 'confirmado', texto: 'Sin cargo' }, anulado: { estado: 'cancelado', texto: 'Anulado' }, perdonado: { estado: 'cancelado', texto: 'Perdonado' },
}
const MEDIOS: Record<string, string> = { efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta', otro: 'Otro' }
const TIPO_DOC: Record<string, string> = { certificado: 'Certificado', pedido: 'Pedido de estudios', medicacion: 'Medicación recetada' }
const TIPO_MEDICION: Record<string, string> = {
  peso: 'Peso', talla: 'Talla', presion: 'Presión', frecuencia_cardiaca: 'Frecuencia cardíaca', temperatura: 'Temperatura',
  saturacion: 'Saturación', glucemia: 'Glucemia', perimetro_cintura: 'Perímetro de cintura', otra: 'Otra',
}
const recorte = (s: string | null, n = 140) => (!s ? '' : s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s)

pacientes.get('/pacientes/:id{[0-9]+}', async (c) => {
  const id = Number(c.req.param('id'))
  const { fecha: hoy } = ahoraAR()
  const inst = leerInstalacion(c.env)
  const [p, fila] = await Promise.all([leerPaciente(c, id), filaDePaciente(c.env.DB, id, hoy)])
  if (!p || !fila) return c.notFound()
  const pedida = c.req.query('tab') ?? 'resumen'
  const pestanas = PESTANAS.filter((t) => !t.modulo || habilitado(inst, t.modulo))
  const tab = pestanas.some((t) => t.id === pedida) ? pedida : 'resumen'
  const activo = !p.baja_en
  const anios = edad(p.fecha_nacimiento, hoy)
  const cobertura = p.cobertura === 'obra_social' ? p.obra_social : p.cobertura === 'particular' ? 'Particular' : 'Cobertura sin completar'
  const cobros = habilitado(inst, 'cobros')
  const [opciones, proximos] = await Promise.all([
    opcionesFicha(c, p),
    c.env.DB.prepare(`SELECT fecha, hora FROM turnos WHERE paciente_id = ? AND estado IN ('confirmado', 'solicitado') AND fecha >= ? ORDER BY fecha, hora`)
      .bind(id, hoy).all<{ fecha: string; hora: string }>(),
  ])
  const aviso = c.req.query('aviso')
  const cancelados = aviso === 'baja' && p.baja_en
    ? (await c.env.DB.prepare(`SELECT fecha, hora FROM turnos WHERE paciente_id = ? AND estado = 'cancelado' AND cierre_motivo = 'Paciente dado de baja' AND cerrado_en = ? ORDER BY fecha, hora`)
      .bind(id, p.baja_en).all<{ fecha: string; hora: string }>()).results ?? []
    : []

  return pagina(c, `${p.nombre} ${p.apellido}`, <>
    <a class="volver" href="/pacientes"><Volver />Pacientes</a>

    {!activo && (
      <div class="aviso franja" role="status">
        <span><strong>Dado de baja el {fechaNumeros(p.baja_en!.slice(0, 10))}</strong> · {textoMotivo(p.baja_motivo)}{p.baja_detalle ? ` (${p.baja_detalle})` : ''}. La historia y los cobros se conservan; no se le pueden dar turnos.</span>
        <form method="post" action={`/pacientes/${id}/reactivar`}><Boton type="submit" variante="oscuro">Reactivar</Boton></form>
      </div>
    )}
    {aviso === 'nuevo' && <Aviso tipo="ok">Listo: {p.nombre} quedó cargado. Completá el resto de la ficha antes de la primera consulta.</Aviso>}
    {aviso === 'existe' && <Aviso>Ese DNI ya era de {p.nombre} {p.apellido}: te mostramos su ficha.</Aviso>}
    {aviso === 'editado' && <Aviso tipo="ok">Cambios guardados.</Aviso>}
    {aviso === 'reactivado' && <Aviso tipo="ok">{p.nombre} está activo otra vez.</Aviso>}
    {aviso === 'baja' && (
      <div class="aviso ok columna-chica" role="status">
        <span>{p.nombre} {p.apellido} quedó dado de baja.</span>
        {cancelados.length > 0 && <>
          <span>{cancelados.length === 1 ? 'Se canceló su turno' : `Se cancelaron sus ${cancelados.length} turnos`}. Avisale por WhatsApp:</span>
          <span class="fila">{cancelados.map((t) => (
            <a class="boton borde" href={enlaceWhatsapp(p.celular, `Hola ${p.nombre}, te aviso que se canceló tu turno del ${fechaNumeros(t.fecha)} a las ${t.hora}.`)} target="_blank" rel="noopener">
              {fechaCorta(t.fecha)} · {t.hora}
            </a>
          ))}</span>
        </>}
      </div>
    )}

    <section class="ficha-cabeza tarjeta">
      <div class="fila ficha-identidad">
        <span class="avatar-grande" aria-hidden="true">{iniciales(p.nombre, p.apellido)}</span>
        <div class="columna-chica">
          <h1 class="titulo-ficha">{p.nombre} {p.apellido}</h1>
          <span class="suave">DNI {dniConPuntos(p.dni)}{anios !== null ? ` · ${anios} años` : ''} · {cobertura} · {p.celular}</span>
          <span class="fila-marcas">{marcas(fila).map((m) => <Estado estado={m.estado} texto={m.texto} />)}
            {fila.veces > 0 && <Estado estado="confirmado" texto={fila.veces === 1 ? 'Vino 1 vez' : `Vino ${fila.veces} veces`} />}
          </span>
        </div>
      </div>
      {activo && (
        <div class="fila ficha-acciones">
          {cobros && fila.saldo > 0 && (
            <a class="boton debe-boton" href={`/cobros/nuevo?paciente=${id}`} data-modulo="cobros"><span>Debe</span><strong>Cobrar {pesos(fila.saldo)}</strong></a>
          )}
          <a class="redondo" href={enlaceWhatsapp(p.celular)} target="_blank" rel="noopener" aria-label="Escribirle por WhatsApp" title="Escribirle por WhatsApp"><Charla /></a>
          <a class="redondo destacado-redondo" href={`/turnos/nuevo?paciente=${id}`} data-modulo="agenda" aria-label="Darle turno" title="Darle turno"><Mas /></a>
          <a class="redondo" href={`/pacientes/${id}/editar`} data-abre="ventana-editar" aria-label="Editar datos" title="Editar datos"><Lapiz /></a>
        </div>
      )}
    </section>

    {activo && <HerramientasDocumentos c={c} pacienteId={id} />}

    <nav class="fila" aria-label="Secciones de la ficha">
      {pestanas.map((t) => <Pastilla href={`/pacientes/${id}${t.id === 'resumen' ? '' : `?tab=${t.id}`}`} actual={t.id === tab}>{t.texto}</Pastilla>)}
    </nav>

    {tab === 'resumen' && <Resumen c={c} p={p} fila={fila} hoy={hoy} cobertura={cobertura} />}
    {tab === 'historia' && <Historia c={c} id={id} />}
    {tab === 'turnos' && <Turnos c={c} id={id} hoy={hoy} />}
    {tab === 'pagos' && <Pagos c={c} id={id} />}
    {tab === 'documentos' && <Documentos c={c} id={id} />}

    {activo && (
      <>
        <Ventana id="ventana-editar" titulo="Editar datos" ancha>
          <FormEditar id={id} valores={valoresDe(p)} opciones={opciones} />
        </Ventana>
        <VentanaBaja p={p} saldo={fila.saldo} proximos={proximos.results ?? []} cobros={cobros} abierta={c.req.query('baja') === '1'} />
      </>
    )}
  </>)
})

function VentanaBaja({ p, saldo, proximos, cobros, abierta }: { p: Paciente; saldo: number; proximos: { fecha: string; hora: string }[]; cobros: boolean; abierta: boolean }) {
  const contenido = (
    <form method="post" action={`/pacientes/${p.id}/baja`} class="columna">
      <p>No se borra nada: la historia clínica, los cobros y los comprobantes se conservan. Deja de aparecer en la lista y no se le pueden dar turnos ni puede pedirlos online. Lo podés reactivar cuando quieras.</p>
      <fieldset class="opciones">
        <legend>Motivo</legend>
        {MOTIVOS_BAJA.map((m, i) => (
          <label class="opcion"><input type="radio" name="motivo" value={m.valor} checked={i === 0} required /><span>{m.texto}</span></label>
        ))}
      </fieldset>
      <Campo etiqueta="Detalle (opcional)" nombre="detalle" autocompletar="off" />
      {proximos.length > 0 && (
        <Aviso tipo="ambar">
          {proximos.length === 1
            ? `Tiene un turno el ${fechaNumeros(proximos[0].fecha)} a las ${proximos[0].hora}. Al darlo de baja se cancela y te dejamos listo el mensaje para avisarle.`
            : `Tiene ${proximos.length} turnos próximos. Al darlo de baja se cancelan y te dejamos listos los mensajes para avisarle.`}
        </Aviso>
      )}
      {saldo > 0 && (
        <Aviso tipo="error">
          Debe {pesos(saldo)}. Para darlo de baja primero tiene que quedar al día.{cobros && <> <a href={`/cobros/nuevo?paciente=${p.id}`} data-modulo="cobros">Cobrar</a></>}
        </Aviso>
      )}
      <div class="ventana-pie">
        <Boton cierra variante="texto">Cancelar</Boton>
        <Boton type="submit" variante="oscuro" disabled={saldo > 0}>Dar de baja a {p.nombre}</Boton>
      </div>
    </form>
  )
  return abierta
    ? <Tarjeta titulo={`Dar de baja a ${p.nombre} ${p.apellido}`}>{contenido}</Tarjeta>
    : <Ventana id="ventana-baja" titulo={`Dar de baja a ${p.nombre} ${p.apellido}`}>{contenido}</Ventana>
}

async function Resumen({ c, p, fila, hoy, cobertura }: { c: C; p: Paciente; fila: FilaPaciente; hoy: string; cobertura: string | null }) {
  const consultas = (await c.env.DB.prepare(
    `SELECT tipo, motivo, plan, date(finalizada_en, '-3 hours') fecha FROM consultas WHERE paciente_id = ? AND estado = 'finalizada' ORDER BY finalizada_en DESC LIMIT 3`
  ).bind(p.id).all<{ tipo: string; motivo: string | null; plan: string | null; fecha: string }>()).results ?? []
  const anios = edad(p.fecha_nacimiento, hoy)
  const datos: [string, string][] = [
    ['Nacimiento', p.fecha_nacimiento ? `${fechaNumeros(p.fecha_nacimiento)} (${anios} años)` : 'Sin completar'],
    ['DNI', dniConPuntos(p.dni)], ['Celular', p.celular], ['Correo', p.correo ?? 'Sin correo'],
    ['Domicilio', p.domicilio ?? 'Sin completar'], ['Ocupación', p.ocupacion ?? 'Sin completar'],
    ['Cobertura', p.cobertura === 'obra_social' && p.numero_afiliado ? `${cobertura} · ${p.numero_afiliado}` : cobertura ?? 'Sin completar'],
    ['Consultorio', p.consultorio ?? 'Sin elegir'], ['Recordatorios', p.recordatorios_baja ? 'No quiere recibirlos' : 'Sí'],
  ]
  return (
    <div class="ficha-resumen">
      <Tarjeta titulo="Datos">
        <dl class="datos">{datos.map(([k, v]) => <><dt>{k}</dt><dd class={v.startsWith('Sin ') ? 'suave' : undefined}>{v}</dd></>)}</dl>
      </Tarjeta>
      <div class="columna">
        <Tarjeta titulo="Próximo turno">
          <p class="dato-grande">{proximoTexto(fila.proximo, hoy)}</p>
        </Tarjeta>
        <Tarjeta titulo="Saldo" tono={fila.saldo > 0 ? 'ambar' : undefined}>
          <p class="dato-grande">{fila.saldo > 0 ? pesos(fila.saldo) : 'Al día'}</p>
          {fila.saldo > 0 && <p class="chico">Te debe de antes.</p>}
        </Tarjeta>
        <Tarjeta titulo="Próximo control">
          <p class="dato-grande">{fila.control ? fechaNumeros(fila.control) : 'Sin indicar'}</p>
          {fila.control_vencido ? <p class="chico">Se pasó la fecha y no tiene turno.</p> : null}
        </Tarjeta>
      </div>
      <Tarjeta titulo="Últimas consultas" accion={<a href={`/pacientes/${p.id}?tab=historia`}>Ver todas</a>}>
        {consultas.length === 0 ? <p class="suave">Todavía no tiene consultas.</p> : (
          <ul class="lista">{consultas.map((x) => (
            <li class="apilado"><strong>{fechaNumeros(x.fecha)} · {x.tipo === 'primera' ? 'Primera consulta' : 'Control'}</strong><span class="suave">{recorte(x.plan ?? x.motivo)}</span></li>
          ))}</ul>
        )}
      </Tarjeta>
    </div>
  )
}

async function Historia({ c, id }: { c: C; id: number }) {
  const [consultas, mediciones] = await Promise.all([
    c.env.DB.prepare(
      `SELECT c.id, c.tipo, c.estado, c.motivo, c.plan, date(COALESCE(c.finalizada_en, c.creado_en), '-3 hours') fecha, co.nombre lugar,
         (SELECT COUNT(*) FROM documentos d WHERE d.consulta_id = c.id AND d.anulado_en IS NULL) docs,
         (SELECT COUNT(*) FROM aclaraciones a WHERE a.consulta_id = c.id) aclaraciones
       FROM consultas c LEFT JOIN consultorios co ON co.id = c.consultorio_id
       WHERE c.paciente_id = ? AND c.estado <> 'descartada' ORDER BY COALESCE(c.finalizada_en, c.creado_en) DESC`
    ).bind(id).all<{ id: number; tipo: string; estado: string; motivo: string | null; plan: string | null; fecha: string; lugar: string | null; docs: number; aclaraciones: number }>(),
    c.env.DB.prepare(
      `SELECT m.tipo, m.valor, m.unidad, m.fecha FROM mediciones m
       WHERE m.paciente_id = ? AND m.anulado_en IS NULL AND m.id = (SELECT m2.id FROM mediciones m2 WHERE m2.paciente_id = m.paciente_id AND m2.tipo = m.tipo AND m2.anulado_en IS NULL ORDER BY m2.fecha DESC, m2.id DESC LIMIT 1)
       ORDER BY m.tipo`
    ).bind(id).all<{ tipo: string; valor: string; unidad: string | null; fecha: string }>(),
  ])
  const lista = consultas.results ?? []
  return (
    <div class="ficha-resumen">
      <Tarjeta titulo="Consultas">
        {lista.length === 0 ? <p class="suave">Todavía no tiene consultas.</p> : (
          <ul class="lista">{lista.map((x) => (
            <li class="apilado">
              <span class="fila"><strong>{fechaNumeros(x.fecha)} · {x.tipo === 'primera' ? 'Primera consulta' : 'Control'}</strong>
                {x.lugar && <span class="suave chico">{x.lugar}</span>}
                {x.estado === 'borrador' && <Estado estado="debe" texto="Borrador" />}
              </span>
              <span class="suave">{recorte(x.plan ?? x.motivo, 220)}</span>
              {(x.docs > 0 || x.aclaraciones > 0) && (
                <span class="chico suave">{[x.docs && `${x.docs} ${x.docs === 1 ? 'documento' : 'documentos'}`, x.aclaraciones && `${x.aclaraciones} ${x.aclaraciones === 1 ? 'aclaración' : 'aclaraciones'}`].filter(Boolean).join(' · ')}</span>
              )}
            </li>
          ))}</ul>
        )}
      </Tarjeta>
      <Tarjeta titulo="Mediciones">
        {(mediciones.results ?? []).length === 0 ? <p class="suave">Sin mediciones.</p> : (
          <dl class="datos">{(mediciones.results ?? []).map((m) => <><dt>{TIPO_MEDICION[m.tipo] ?? m.tipo}</dt><dd>{m.valor}{m.unidad ? ` ${m.unidad}` : ''} · {fechaCorta(m.fecha)}</dd></>)}</dl>
        )}
      </Tarjeta>
    </div>
  )
}

const ESTADO_TURNO: Record<string, string> = { confirmado: 'confirmado', solicitado: 'solicitado', atendido: 'atendido', ausente: 'ausente', cancelado: 'cancelado' }

async function Turnos({ c, id, hoy }: { c: C; id: number; hoy: string }) {
  const turnos = (await c.env.DB.prepare(
    `SELECT t.fecha, t.hora, t.estado, t.cancelado_por, pr.nombre prestacion, co.nombre consultorio FROM turnos t
       JOIN consultorios co ON co.id = t.consultorio_id LEFT JOIN prestaciones pr ON pr.id = t.prestacion_id
     WHERE t.paciente_id = ? ORDER BY t.fecha DESC, t.hora DESC`
  ).bind(id).all<{ fecha: string; hora: string; estado: string; cancelado_por: string | null; prestacion: string | null; consultorio: string }>()).results ?? []
  const proximos = turnos.filter((t) => t.fecha >= hoy && ['confirmado', 'solicitado'].includes(t.estado)).reverse()
  const pasados = turnos.filter((t) => !proximos.includes(t))
  const Fila = ({ t }: { t: (typeof turnos)[number] }) => (
    <li>
      <span class="columna-chica">
        <strong>{t.fecha === hoy ? 'Hoy' : fechaNumeros(t.fecha)} · {t.hora}</strong>
        <span class="chico suave">{[t.prestacion, t.consultorio].filter(Boolean).join(' · ')}</span>
      </span>
      <Estado estado={ESTADO_TURNO[t.estado]} texto={t.estado === 'cancelado' ? (t.cancelado_por === 'paciente' ? 'Canceló el paciente' : 'Cancelado') : undefined} />
    </li>
  )
  return (
    <div class="ficha-resumen">
      <Tarjeta titulo="Próximos" accion={<a href="/agenda" data-modulo="agenda">Moverlos o cancelarlos desde la agenda</a>}>
        {proximos.length === 0 ? <p class="suave">No tiene turnos próximos.</p> : <ul class="lista">{proximos.map((t) => <Fila t={t} />)}</ul>}
      </Tarjeta>
      <Tarjeta titulo="Anteriores">
        {pasados.length === 0 ? <p class="suave">Todavía no tuvo turnos.</p> : <ul class="lista">{pasados.map((t) => <Fila t={t} />)}</ul>}
      </Tarjeta>
    </div>
  )
}

async function Pagos({ c, id }: { c: C; id: number }) {
  const [cobros, pagos] = await Promise.all([
    c.env.DB.prepare('SELECT id, fecha, concepto, importe, saldo, estado FROM v_cobros WHERE paciente_id = ? ORDER BY fecha DESC, id DESC').bind(id)
      .all<{ id: number; fecha: string; concepto: string; importe: number; saldo: number; estado: string }>(),
    c.env.DB.prepare(
      `SELECT pa.id, pa.cobro_id, pa.fecha, pa.importe, pa.medio, pa.anulado_en, pa.anulado_motivo,
         (SELECT co.id FROM comprobantes co WHERE co.pago_id = pa.id AND co.tipo IN ('interno', 'factura_c')) comprobante_id,
         (SELECT co.tipo || ':' || COALESCE(co.numero, '') || ':' || co.estado FROM comprobantes co WHERE co.pago_id = pa.id AND co.tipo IN ('interno', 'factura_c')) comprobante
       FROM pagos pa JOIN cobros cb ON cb.id = pa.cobro_id WHERE cb.paciente_id = ? ORDER BY pa.fecha, pa.id`
    ).bind(id).all<{ id: number; cobro_id: number; fecha: string; importe: number; medio: string; anulado_en: string | null; anulado_motivo: string | null; comprobante_id: number | null; comprobante: string | null }>(),
  ])
  const lista = cobros.results ?? []
  const textoComprobante = (s: string | null) => {
    if (!s) return 'Sin comprobante'
    const [tipo, numero, estado] = s.split(':')
    const nombre = tipo === 'interno' ? `Comprobante n.º ${numero}` : numero ? `Factura C n.º ${numero}` : 'Factura C'
    return estado === 'pendiente' ? `${nombre} (pendiente)` : estado === 'anulado' ? `${nombre} (anulado)` : nombre
  }
  return (
    <Tarjeta titulo="Cobros y pagos">
      {lista.length === 0 ? <p class="suave">Todavía no tiene cobros.</p> : (
        <ul class="lista">{lista.map((cb) => {
          const e = ESTADO_COBRO[cb.estado]
          return (
            <li class="apilado">
              <span class="fila entre-todo">
                <a href={`/cobros/${cb.id}`} data-modulo="cobros"><strong>{fechaNumeros(cb.fecha)} · {cb.concepto}</strong></a>
                <span class="fila"><span class="importe">{pesos(cb.importe)}</span><Estado estado={e.estado} texto={cb.estado === 'parcial' ? `Debe ${pesos(cb.saldo)}` : e.texto} /></span>
              </span>
              {(pagos.results ?? []).filter((x) => x.cobro_id === cb.id).map((x) => (
                <span class={x.anulado_en ? 'chico suave tachado' : 'chico suave'}>
                  Pagó {pesos(x.importe)} el {fechaNumeros(x.fecha)} · {MEDIOS[x.medio]} · {x.comprobante_id
                    ? <a href={`/comprobantes/${x.comprobante_id}`} data-modulo="cobros">{textoComprobante(x.comprobante)}</a>
                    : x.anulado_en ? textoComprobante(null) : <a href={`/comprobantes/nuevo?pago=${x.id}`} data-modulo="cobros">Hacer el comprobante</a>}
                  {x.anulado_en && <span class="no-tachado"> · Anulado: {x.anulado_motivo}</span>}
                </span>
              ))}
            </li>
          )
        })}</ul>
      )}
    </Tarjeta>
  )
}

async function Documentos({ c, id }: { c: C; id: number }) {
  const [docs, archivos] = await Promise.all([
    c.env.DB.prepare('SELECT tipo, datos, fecha, consulta_id, anulado_en, anulado_motivo FROM documentos WHERE paciente_id = ? ORDER BY fecha DESC, id DESC').bind(id)
      .all<{ tipo: string; datos: string; fecha: string; consulta_id: number | null; anulado_en: string | null; anulado_motivo: string | null }>(),
    c.env.DB.prepare(`SELECT nombre, tipo, date(creado_en, '-3 hours') fecha, consulta_id, anulado_en, anulado_motivo FROM archivos WHERE paciente_id = ? ORDER BY creado_en DESC`).bind(id)
      .all<{ nombre: string; tipo: string; fecha: string; consulta_id: number | null; anulado_en: string | null; anulado_motivo: string | null }>(),
  ])
  const filas = [
    ...(docs.results ?? []).map((d) => ({ tipo: TIPO_DOC[d.tipo] ?? d.tipo, fecha: d.fecha, origen: d.consulta_id ? 'De una consulta' : 'Desde la ficha', anulado: d.anulado_en ? d.anulado_motivo : null })),
    ...(archivos.results ?? []).map((a) => ({ tipo: `Estudio · ${a.nombre}`, fecha: a.fecha, origen: a.consulta_id ? 'De una consulta' : 'Adjuntado a la ficha', anulado: a.anulado_en ? a.anulado_motivo : null })),
  ].sort((a, b) => b.fecha.localeCompare(a.fecha))
  return (
    <Tarjeta titulo="Documentos">
      {filas.length === 0 ? <p class="suave">Todavía no tiene documentos ni estudios.</p> : (
        <ul class="lista">{filas.map((f) => (
          <li>
            <span class="columna-chica">
              <strong class={f.anulado ? 'tachado' : undefined}>{f.tipo}</strong>
              <span class="chico suave">{f.origen}{f.anulado ? ` · Anulado: ${f.anulado}` : ''}</span>
            </span>
            <span class="suave">{fechaNumeros(f.fecha)}</span>
          </li>
        ))}</ul>
      )}
      <p class="chico suave">Nada se borra: lo que se anotó mal se anula con el motivo.</p>
    </Tarjeta>
  )
}

// ---------- Editar ----------
pacientes.get('/pacientes/:id{[0-9]+}/editar', async (c) => {
  const p = await leerPaciente(c, Number(c.req.param('id')))
  if (!p) return c.notFound()
  if (p.baja_en) return c.redirect(`/pacientes/${p.id}`)
  return pagina(c, 'Editar datos', <EditarSola p={p} valores={valoresDe(p)} opciones={await opcionesFicha(c, p)} />)
})

function EditarSola(props: { p: Paciente; valores: ValoresFicha; opciones: Awaited<ReturnType<typeof opcionesFicha>>; errores?: Errores; avisoDni?: string; otroId?: number }) {
  return (
    <div class="angosto columna">
      <a class="volver" href={`/pacientes/${props.p.id}`}><Volver />{props.p.nombre} {props.p.apellido}</a>
      <Tarjeta titulo="Editar datos">
        <FormEditar id={props.p.id} valores={props.valores} errores={props.errores} opciones={props.opciones} avisoDni={props.avisoDni} otroId={props.otroId} />
      </Tarjeta>
    </div>
  )
}

pacientes.post('/pacientes/:id{[0-9]+}/editar', async (c) => {
  const p = await leerPaciente(c, Number(c.req.param('id')))
  if (!p) return c.notFound()
  if (p.baja_en) return c.redirect(`/pacientes/${p.id}`)
  const f = await c.req.parseBody()
  const { fecha: hoy } = ahoraAR()
  const { datos, errores } = validarFicha(f, hoy)
  const valores: ValoresFicha = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, typeof v === 'string' ? v : undefined]))
  valores.dni = datos.dni && !errores.dni ? datos.dni : valores.dni
  const opciones = await opcionesFicha(c, { obra_social_id: datos.obra_social_id ?? p.obra_social_id, consultorio_id: datos.consultorio_id ?? p.consultorio_id })
  if (datos.obra_social_id && !opciones.coberturas.some((o) => o.valor === `os:${datos.obra_social_id}`)) errores.cobertura = 'Elegí la cobertura.'
  if (datos.consultorio_id && !opciones.consultorios.some((o) => o.valor === String(datos.consultorio_id))) errores.consultorio_id = 'Elegí el consultorio.'
  let otroId: number | undefined
  if (!errores.dni && datos.dni !== p.dni) {
    const otro = await c.env.DB.prepare('SELECT id FROM pacientes WHERE dni = ? AND id <> ?').bind(datos.dni, p.id).first<{ id: number }>()
    if (otro) { errores.dni = 'Ese DNI ya es de otro paciente.'; otroId = otro.id }
  }
  if (Object.keys(errores).length) return pagina(c, 'Editar datos', <EditarSola p={p} valores={valores} opciones={opciones} errores={errores} otroId={otroId} />, otroId ? 409 : 422)
  // El cambio de DNI se confirma: el anterior queda en el historial de cambios.
  if (datos.dni !== p.dni && f.confirmar_dni !== datos.dni) {
    const avisoDni = `Vas a cambiar el DNI de ${dniConPuntos(p.dni)} a ${dniConPuntos(datos.dni)}. El anterior queda en el historial de cambios.`
    return pagina(c, 'Editar datos', <EditarSola p={p} valores={valores} opciones={opciones} avisoDni={avisoDni} />, 409)
  }
  const r = await c.env.DB.prepare(
    `UPDATE pacientes SET dni = ?, nombre = ?, apellido = ?, celular = ?, correo = ?, fecha_nacimiento = ?, domicilio = ?, ocupacion = ?,
       cobertura = ?, obra_social_id = ?, numero_afiliado = ?, consultorio_id = ?, recordatorios_baja = ?, actualizado_en = ?
     WHERE id = ? AND baja_en IS NULL`
  ).bind(datos.dni, datos.nombre, datos.apellido, datos.celular, datos.correo, datos.fecha_nacimiento, datos.domicilio, datos.ocupacion,
    datos.cobertura, datos.obra_social_id, datos.numero_afiliado, datos.consultorio_id, datos.recordatorios_baja, ahoraISO(), p.id).run()
  if (r.meta.changes) await registrar(c, 'paciente_editado', `paciente:${p.id}${datos.dni !== p.dni ? ' · cambió el DNI' : ''}`, c.get('email'))
  return c.redirect(`/pacientes/${p.id}?aviso=editado`)
})

// ---------- Dar de baja y reactivar ----------
pacientes.post('/pacientes/:id{[0-9]+}/baja', async (c) => {
  const id = Number(c.req.param('id'))
  const { fecha: hoy } = ahoraAR()
  const [p, fila] = await Promise.all([leerPaciente(c, id), filaDePaciente(c.env.DB, id, hoy)])
  if (!p || !fila) return c.notFound()
  if (p.baja_en) return c.redirect(`/pacientes/${id}`)
  const f = await c.req.parseBody()
  const motivo = MOTIVOS_BAJA.some((m) => m.valor === f.motivo) ? String(f.motivo) : null
  const detalle = typeof f.detalle === 'string' ? f.detalle.trim().slice(0, 200) || null : null
  if (!motivo) return pagina(c, 'Dar de baja', <Aviso tipo="error">Elegí el motivo de la baja. <a href={`/pacientes/${id}?baja=1`}>Volver</a></Aviso>, 422)
  // Si debe plata, no se puede dar de baja hasta que quede al día (decidido el 23/10).
  if (fila.saldo > 0) {
    return pagina(c, 'Dar de baja', <Aviso tipo="error">{p.nombre} debe {pesos(fila.saldo)}. Para darlo de baja primero tiene que quedar al día. <a href={`/pacientes/${id}`}>Volver a la ficha</a></Aviso>, 409)
  }
  const en = ahoraISO()
  // Los turnos próximos se cancelan solos, en el mismo paso que la baja.
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE turnos SET estado = 'cancelado', cancelado_por = 'profesional', cierre_motivo = 'Paciente dado de baja', cerrado_en = ?, actualizado_en = ?
      WHERE paciente_id = ? AND estado IN ('confirmado', 'solicitado') AND fecha >= ?`).bind(en, en, id, hoy),
    c.env.DB.prepare('UPDATE pacientes SET baja_en = ?, baja_motivo = ?, baja_detalle = ?, actualizado_en = ? WHERE id = ? AND baja_en IS NULL').bind(en, motivo, detalle, en, id),
  ])
  await registrar(c, 'paciente_baja', `paciente:${id} · ${motivo}`, c.get('email'))
  return c.redirect(`/pacientes/${id}?aviso=baja`)
})

pacientes.post('/pacientes/:id{[0-9]+}/reactivar', async (c) => {
  const id = Number(c.req.param('id'))
  const r = await c.env.DB.prepare('UPDATE pacientes SET baja_en = NULL, baja_motivo = NULL, baja_detalle = NULL WHERE id = ? AND baja_en IS NOT NULL').bind(id).run()
  if (r.meta.changes) await registrar(c, 'paciente_reactivado', `paciente:${id}`, c.get('email'))
  return c.redirect(`/pacientes/${id}?aviso=reactivado`)
})
