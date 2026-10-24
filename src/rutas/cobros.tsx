// P4 · Cobrar y cobros. Maqueta: docs/pantallas/Cobrar.dc.html · docs/DISENO_APROBADO.md, sección 4.
// Paso 1: a quién se cobra. Paso 2: importe, cuánto pagó y cómo. El paso 3 (comprobante) es de X4: `/comprobantes/nuevo?pago=<id>`.
import { Hono } from 'hono'
import type { Child } from 'hono/jsx'
import type { C, Env } from '../tipos'
import { leerInstalacion } from '../lib/instalacion'
import { ahoraAR, ahoraISO } from '../lib/fechas'
import { registrar } from '../lib/sesion'
import { buscarPacientes, enlaceWhatsapp, fechaCorta, fechaNumeros, iniciales } from '../lib/pacientes'
import {
  MEDIOS, ErrorCobro, anularCobro, anularPago, guardarCobro, importeCampo, leerImporte, leerMotivo, mensajeDatosPago, pendientesDeCobro, plataDeHoy,
  textoMedio, type Cuanto, type ParaCobrar,
} from '../lib/cobros'
import { Pagina } from '../ui/pagina'
import { Aviso, Boton, Campo, Estado, Pastilla, Tarjeta, Ventana, pesos } from '../ui/componentes'
import { Lupa, Mas, Volver } from '../ui/iconos'
import { avisosSinLeer, datosProfesional } from './inicio'

export const cobros = new Hono<Env>()

async function pagina(c: C, titulo: string, hijos: Child, status: 200 | 404 | 409 | 422 = 200) {
  const [prof, avisos] = await Promise.all([datosProfesional(c), avisosSinLeer(c)])
  return c.html(<Pagina titulo={titulo} seccion="cobros" inst={leerInstalacion(c.env)} email={c.get('email')!} nombre={prof.nombre} avisos={avisos}>{hijos}</Pagina>, status)
}

const claveNueva = () => crypto.randomUUID()
const numeroId = (v: string | undefined) => (v && /^\d{1,9}$/.test(v) ? Number(v) : null)
const cuandoTexto = (fecha: string, hora: string | null, hoy: string) => `${fecha === hoy ? 'hoy' : fechaCorta(fecha)}${hora ? ` ${hora}` : ''}`
const detalle = (p: ParaCobrar, hoy: string) => [
  p.concepto,
  cuandoTexto(p.fecha, p.hora, hoy),
  p.cobertura === 'obra_social' ? `copago ${p.obra_social ?? 'obra social'}` : 'Particular',
  p.tipo === 'cobro' && p.pagado > 0 ? 'pagó una parte' : null,
  p.origen === 'ausencia' ? 'cobro por ausencia' : null,
].filter(Boolean).join(' · ')
const enlaceCobrar = (p: ParaCobrar) => `/cobros/nuevo?${p.tipo}=${p.id}`

// ---------- Paso 1: ¿a quién le cobrás? ----------
cobros.get('/cobros/nuevo', async (c) => {
  const { fecha: hoy } = ahoraAR()
  const q = c.req.query()
  // Desde la consulta: se cobra su turno; sin turno, lo que debe el paciente.
  const consulta = numeroId(q.consulta)
  if (consulta) {
    const k = await c.env.DB.prepare('SELECT paciente_id, turno_id FROM consultas WHERE id = ?').bind(consulta).first<{ paciente_id: number; turno_id: number | null }>()
    if (!k) return c.notFound()
    return c.redirect(k.turno_id ? `/cobros/nuevo?turno=${k.turno_id}` : `/cobros/nuevo?paciente=${k.paciente_id}`)
  }
  const turno = numeroId(q.turno)
  if (turno) {
    const cb = await c.env.DB.prepare('SELECT id, saldo FROM v_cobros WHERE turno_id = ? AND anulado_en IS NULL ORDER BY id DESC').bind(turno).first<{ id: number; saldo: number }>()
    if (cb) return cb.saldo > 0 ? c.redirect(`/cobros/nuevo?cobro=${cb.id}`) : c.redirect(`/cobros/${cb.id}`)
    return pasoDos(c, { tipo: 'turno', id: turno })
  }
  const cobro = numeroId(q.cobro)
  if (cobro) return pasoDos(c, { tipo: 'cobro', id: cobro })
  const paciente = numeroId(q.paciente)
  if (paciente) {
    if (q.otro === '1') return pasoDos(c, { tipo: 'libre', id: paciente })
    const lista = await pendientesDeCobro(c.env.DB, paciente)
    if (lista.length === 1) return c.redirect(enlaceCobrar(lista[0]))
    if (lista.length === 0) return pasoDos(c, { tipo: 'libre', id: paciente })
    return pasoUno(c, hoy, lista, paciente)
  }
  return pasoUno(c, hoy, await pendientesDeCobro(c.env.DB))
})

async function pasoUno(c: C, hoy: string, lista: ParaCobrar[], paciente?: number) {
  const plata = await plataDeHoy(c.env.DB, hoy)
  const hoyLista = lista.filter((p) => p.fecha === hoy)
  const antes = lista.filter((p) => p.fecha !== hoy)
  const q = (c.req.query('q') ?? '').slice(0, 80).trim()
  const encontrados = q ? (await buscarPacientes(c.env.DB, q, hoy)).filter((p) => !p.baja).slice(0, 8) : []
  const Fila = ({ p }: { p: ParaCobrar }) => (
    <li>
      <a class="fila-elegir" href={enlaceCobrar(p)}>
        <span class="avatar-chico" aria-hidden="true">{iniciales(p.nombre, p.apellido)}</span>
        <span class="columna-chica"><strong>{p.nombre} {p.apellido}</strong><span class="chico suave">{detalle(p, hoy)}</span></span>
        <span class="importe">{p.tipo === 'turno' && p.cobertura === 'obra_social' ? 'Copago' : pesos(p.saldo)}</span>
      </a>
    </li>
  )
  return pagina(c, 'Cobrar', <div class="angosto columna">
    <a class="volver" href={paciente ? `/pacientes/${paciente}` : '/'}><Volver />{paciente ? 'Volver a la ficha' : 'Volver a Hoy'}</a>
    <section class="encabezado">
      <h1>Cobrar</h1>
      <span class="portada-sub">Hoy cobraste {pesos(plata.cobrado)}</span>
    </section>
    <Tarjeta titulo="Terminaron y falta cobrar" tono="ambar">
      {hoyLista.length ? <ul class="lista">{hoyLista.map((p) => <Fila p={p} />)}</ul> : <p class="chico">No queda nadie de hoy por cobrar.</p>}
    </Tarjeta>
    <Tarjeta titulo="Te deben de antes">
      {antes.length ? <ul class="lista">{antes.map((p) => <Fila p={p} />)}</ul> : <p class="suave">Nadie te debe de días anteriores.</p>}
    </Tarjeta>
    {!paciente && (
      <Tarjeta titulo="Cobrarle a otro paciente">
        <form class="buscador chico-buscador" method="get" action="/cobros/nuevo" role="search">
          <Lupa />
          <label for="busca-c" class="oculto-visual">Buscar paciente</label>
          <input id="busca-c" name="q" type="search" value={q} placeholder="Nombre, DNI o celular" />
        </form>
        {q && (encontrados.length === 0 ? <p class="suave">No encontramos pacientes con «{q}».</p> : (
          <ul class="lista">{encontrados.map((p) => (
            <li><a class="fila-elegir" href={`/cobros/nuevo?paciente=${p.id}`}>
              <span class="avatar-chico" aria-hidden="true">{iniciales(p.nombre, p.apellido)}</span>
              <span class="columna-chica"><strong>{p.nombre} {p.apellido}</strong>{p.saldo > 0 && <span class="chico suave">Debe {pesos(p.saldo)}</span>}</span>
            </a></li>
          ))}</ul>
        ))}
      </Tarjeta>
    )}
    {paciente && <Boton href={`/cobros/nuevo?paciente=${paciente}&otro=1`} variante="borde"><Mas />Otro cobro</Boton>}
  </div>)
}

// ---------- Paso 2: importe, cuánto pagó y cómo ----------
type Destino = { tipo: 'turno' | 'cobro' | 'libre'; id: number }
type Valores = { importe?: string; cuanto?: string; parte?: string; medio?: string; prestacion?: string; concepto?: string; clave?: string }

type Contexto = {
  paciente: { id: number; nombre: string; apellido: string; celular: string }
  titulo: string
  sub: string
  importe: number | null      // sugerido (turno/libre) o saldo (cobro existente)
  editable: boolean           // se puede cambiar el importe (todavía no hay cobro)
  copago: boolean
  prestaciones?: { id: number; nombre: string; importe: number }[]
}

async function contexto(c: C, d: Destino, hoy: string): Promise<Contexto | null> {
  const db = c.env.DB
  if (d.tipo === 'turno') {
    const t = await db.prepare(
      `SELECT t.id, t.fecha, t.hora, t.estado, t.cobertura, os.nombre obra_social, COALESCE(pr.nombre, 'Consulta') concepto, COALESCE(pr.importe, 0) importe,
              p.id pid, p.nombre, p.apellido, p.celular
         FROM turnos t JOIN pacientes p ON p.id = t.paciente_id LEFT JOIN prestaciones pr ON pr.id = t.prestacion_id
         LEFT JOIN obras_sociales os ON os.id = t.obra_social_id WHERE t.id = ?`
    ).bind(d.id).first<{ id: number; fecha: string; hora: string; estado: string; cobertura: string; obra_social: string | null; concepto: string; importe: number; pid: number; nombre: string; apellido: string; celular: string }>()
    if (!t || t.estado !== 'atendido') return null
    const copago = t.cobertura === 'obra_social'
    return {
      paciente: { id: t.pid, nombre: t.nombre, apellido: t.apellido, celular: t.celular },
      titulo: `${t.nombre} ${t.apellido}`, sub: `${t.concepto} · ${cuandoTexto(t.fecha, t.hora, hoy)} · ${copago ? `copago ${t.obra_social ?? 'obra social'}` : 'Particular'}`,
      importe: copago ? 0 : t.importe, editable: true, copago,
    }
  }
  if (d.tipo === 'cobro') {
    const k = await db.prepare(
      `SELECT vc.id, vc.fecha, vc.concepto, vc.importe, vc.saldo, vc.pagado, vc.estado, vc.cobertura, p.id pid, p.nombre, p.apellido, p.celular
         FROM v_cobros vc JOIN pacientes p ON p.id = vc.paciente_id WHERE vc.id = ?`
    ).bind(d.id).first<{ id: number; fecha: string; concepto: string; importe: number; saldo: number; pagado: number; estado: string; cobertura: string; pid: number; nombre: string; apellido: string; celular: string }>()
    if (!k || !['debe', 'parcial'].includes(k.estado)) return null
    return {
      paciente: { id: k.pid, nombre: k.nombre, apellido: k.apellido, celular: k.celular },
      titulo: `${k.nombre} ${k.apellido}`,
      sub: `${k.concepto} del ${fechaNumeros(k.fecha)}${k.pagado > 0 ? ` · ya pagó ${pesos(k.pagado)} de ${pesos(k.importe)}` : ''}`,
      importe: k.saldo, editable: false, copago: k.cobertura === 'obra_social',
    }
  }
  const p = await db.prepare('SELECT id, nombre, apellido, celular, cobertura FROM pacientes WHERE id = ? AND baja_en IS NULL').bind(d.id)
    .first<{ id: number; nombre: string; apellido: string; celular: string; cobertura: string | null }>()
  if (!p) return null
  const prestaciones = (await db.prepare('SELECT id, nombre, importe FROM prestaciones WHERE activa = 1 ORDER BY orden, id').all<{ id: number; nombre: string; importe: number }>()).results ?? []
  const copago = p.cobertura === 'obra_social'
  return {
    paciente: { id: p.id, nombre: p.nombre, apellido: p.apellido, celular: p.celular },
    titulo: `${p.nombre} ${p.apellido}`, sub: 'Cobro sin turno', importe: copago ? 0 : prestaciones[0]?.importe ?? 0, editable: true, copago, prestaciones,
  }
}

async function pasoDos(c: C, d: Destino, v: Valores = {}, error?: string) {
  const { fecha: hoy } = ahoraAR()
  const k = await contexto(c, d, hoy)
  if (!k) return pagina(c, 'Cobrar', <div class="angosto columna"><Aviso tipo="error">No hay nada para cobrar ahí: ya está pagado, anulado o el turno no está atendido.</Aviso><Boton href="/cobros/nuevo" variante="borde">Volver a Cobrar</Boton></div>, 404)
  const prof = await c.env.DB.prepare('SELECT transferencia_alias alias, transferencia_cbu cbu, transferencia_titular titular, transferencia_qr_clave qr FROM profesional WHERE id = 1')
    .first<{ alias: string | null; cbu: string | null; titular: string | null; qr: string | null }>()
  const cuanto = (['todo', 'parte', 'nada'] as const).find((x) => x === v.cuanto) ?? 'todo'
  const medio = MEDIOS.find((m) => m.valor === v.medio)?.valor ?? 'efectivo'
  const importe = v.importe ?? (k.importe !== null ? importeCampo(k.importe) : '')
  const conDatos = !!(prof?.alias || prof?.cbu)
  const mensaje = mensajeDatosPago({ nombre: k.paciente.nombre, concepto: k.sub.split(' · ')[0] || 'la consulta', importe: k.importe ?? 0, alias: prof?.alias ?? null, cbu: prof?.cbu ?? null, titular: prof?.titular ?? null, qr: !!prof?.qr }, pesos)
  return pagina(c, 'Cobrar', <div class="angosto columna">
    <a class="volver" href="/cobros/nuevo"><Volver />Cambiar a quién le cobrás</a>
    <section class="encabezado">
      <div class="columna-chica"><h1>{k.titulo}</h1><span class="portada-sub">{k.sub}</span></div>
    </section>
    {error && <Aviso tipo="error">{error}</Aviso>}
    <Tarjeta etiqueta="Cobro">
      <form method="post" action="/cobros" class="columna" novalidate>
        <input type="hidden" name="tipo" value={d.tipo} />
        <input type="hidden" name="id" value={d.id} />
        <input type="hidden" name="clave" value={v.clave ?? claveNueva()} />
        {k.prestaciones && (
          <div class="campos-2">
            <div class="campo">
              <label for="c-prestacion">Concepto</label>
              <select id="c-prestacion" name="prestacion" class="entrada">
                {k.prestaciones.map((p) => <option value={p.id} selected={String(p.id) === v.prestacion}>{p.nombre}{k.copago ? '' : ` · ${pesos(p.importe)}`}</option>)}
                <option value="" selected={v.prestacion === ''}>Otro</option>
              </select>
            </div>
            <Campo etiqueta="Si es otro, ¿cuál?" nombre="concepto" valor={v.concepto} autocompletar="off" />
          </div>
        )}
        {k.editable ? (
          <Campo etiqueta={k.copago ? 'Copago (puede ser 0)' : 'Importe'} nombre="importe" modoTeclado="numeric" valor={importe} clase="importe-campo"
            ayuda={k.copago ? 'Con obra social se cobra solo el copago.' : 'Si es 0, queda «Sin cargo»: sin pago ni comprobante.'} autocompletar="off" />
        ) : (
          <div class="dato-tarjeta"><span class="chico suave">Falta pagar</span><strong class="dato-grande">{pesos(k.importe ?? 0)}</strong></div>
        )}
        <fieldset class="opciones">
          <legend>¿Cuánto pagó?</legend>
          {[['todo', 'Todo'], ['parte', 'Una parte'], ['nada', 'Nada por ahora']].map(([valor, texto]) => (
            <label class="opcion"><input type="radio" name="cuanto" value={valor} checked={valor === cuanto} /><span>{texto}</span></label>
          ))}
        </fieldset>
        <Campo etiqueta="Si pagó una parte, ¿cuánto?" nombre="parte" modoTeclado="numeric" valor={v.parte} ayuda="Lo que falta queda en «Te deben»." autocompletar="off" />
        <fieldset class="opciones">
          <legend>¿Cómo pagó?</legend>
          {MEDIOS.map((m) => <label class="opcion"><input type="radio" name="medio" value={m.valor} checked={m.valor === medio} /><span>{m.texto}</span></label>)}
        </fieldset>
        <div class="aviso entre-todo">
          <span>¿Te va a transferir? Mandale tus datos de pago y registrás el pago cuando llegue.</span>
          <Boton abre="ventana-datos" variante="borde" href={`#ventana-datos`}>Enviar datos de pago</Boton>
        </div>
        <div class="ventana-pie">
          <Boton type="submit" variante="destacado">Guardar</Boton>
        </div>
      </form>
    </Tarjeta>
    <Ventana id="ventana-datos" titulo="Enviar datos de pago" sub={`A ${k.paciente.nombre} ${k.paciente.apellido}`}>
      {conDatos ? <>
        <pre class="mensaje-previa">{mensaje}</pre>
        {prof?.qr && <div class="qr"><img src="/cobros/qr" alt="QR para pagar" class="qr-imagen" /></div>}
        <p class="chico suave">SiroConsultas no mueve dinero ni se conecta a tu cuenta. El cobro queda en «Te deben» hasta que registres el pago.</p>
        <div class="ventana-pie">
          {prof?.qr && <a class="boton borde" href="/cobros/qr?descargar=1">Descargar el QR</a>}
          <a class="boton oscuro" href={enlaceWhatsapp(k.paciente.celular, mensaje)} target="_blank" rel="noopener">Mandar por WhatsApp</a>
        </div>
      </> : (
        <Aviso tipo="ambar">Todavía no cargaste tus datos para transferir. Cargalos en <a href="/configuracion/cobros">Configuración → Cobros y comprobantes</a>.</Aviso>
      )}
    </Ventana>
  </div>, error ? 422 : 200)
}

cobros.post('/cobros', async (c) => {
  const f = await c.req.parseBody()
  const s = (k: string) => (typeof f[k] === 'string' ? (f[k] as string) : '')
  const tipo = (['turno', 'cobro', 'libre'] as const).find((x) => x === s('tipo'))
  const id = numeroId(s('id'))
  if (!tipo || !id) return c.redirect('/cobros/nuevo')
  const v: Valores = { importe: s('importe'), cuanto: s('cuanto'), parte: s('parte'), medio: s('medio'), prestacion: s('prestacion'), concepto: s('concepto'), clave: s('clave') }
  const cuanto = (['todo', 'parte', 'nada'] as const).find((x) => x === v.cuanto) as Cuanto | undefined
  try {
    if (!cuanto) throw new ErrorCobro('Elegí cuánto pagó.')
    const importe = tipo === 'cobro' ? null : leerImporte(v.importe)
    if (tipo !== 'cobro' && importe === null) throw new ErrorCobro('Revisá el importe: va en pesos, por ejemplo 18000 o 18.000,50.')
    const parte = cuanto === 'parte' ? leerImporte(v.parte) : null
    if (cuanto === 'parte' && parte === null) throw new ErrorCobro('Escribí cuánto pagó.')
    let origen
    if (tipo === 'turno') origen = { tipo, turnoId: id }
    else if (tipo === 'cobro') origen = { tipo, cobroId: id }
    else {
      const prestacion = numeroId(v.prestacion)
      const nombre = prestacion ? (await c.env.DB.prepare('SELECT nombre FROM prestaciones WHERE id = ? AND activa = 1').bind(prestacion).first<{ nombre: string }>())?.nombre : null
      origen = { tipo, pacienteId: id, prestacionId: nombre ? prestacion : null, concepto: nombre ?? v.concepto ?? '' }
    }
    const r = await guardarCobro(c.env.DB, { origen, importe, cuanto, parte, medio: v.medio ?? '', clave: v.clave ?? '', hoy: ahoraAR().fecha })
    if (!r.repetido) await registrar(c, r.pagoId ? 'pago_registrado' : 'cobro_registrado', `cobro:${r.cobroId}${r.pagoId ? ` · pago:${r.pagoId}` : ''}`, c.get('email'))
    if (r.pagoId) return c.redirect(`/comprobantes/nuevo?pago=${r.pagoId}`)
    return c.redirect(`/cobros/${r.cobroId}?aviso=${r.sinCargo ? 'sin_cargo' : 'te_deben'}`)
  } catch (e) {
    if (!(e instanceof ErrorCobro)) throw e
    return pasoDos(c, { tipo, id }, v, e.message)
  }
})

// ---------- Lista de cobros ----------
const FILTROS = [
  { id: 'todos', texto: 'Todos' }, { id: 'deben', texto: 'Te deben' }, { id: 'hoy', texto: 'De hoy' }, { id: 'anulados', texto: 'Anulados' },
] as const
const ESTADO: Record<string, { estado: string; texto: string }> = {
  pagado: { estado: 'atendido', texto: 'Pagado' }, parcial: { estado: 'debe', texto: 'Pagó una parte' }, debe: { estado: 'debe', texto: 'Te debe' },
  sin_cargo: { estado: 'confirmado', texto: 'Sin cargo' }, anulado: { estado: 'cancelado', texto: 'Anulado' }, perdonado: { estado: 'cancelado', texto: 'Perdonado' },
}
const POR_PAGINA = 50

cobros.get('/cobros', async (c) => {
  const { fecha: hoy } = ahoraAR()
  const filtro = FILTROS.find((x) => x.id === c.req.query('filtro'))?.id ?? 'todos'
  const q = (c.req.query('q') ?? '').slice(0, 80).trim()
  const n = Math.min(Math.max(Number(c.req.query('n')) || POR_PAGINA, POR_PAGINA), 2000)
  const donde: string[] = []
  const args: (string | number)[] = []
  if (filtro === 'deben') donde.push('vc.saldo > 0')
  if (filtro === 'hoy') { donde.push('(vc.fecha = ? OR EXISTS (SELECT 1 FROM pagos pa WHERE pa.cobro_id = vc.id AND pa.fecha = ?))'); args.push(hoy, hoy) }
  if (filtro === 'anulados') donde.push("vc.estado = 'anulado'")
  if (q) {
    const digitos = q.replace(/\D/g, '')
    donde.push(`(lower(p.nombre || ' ' || p.apellido) LIKE ? OR lower(p.apellido || ' ' || p.nombre) LIKE ?${digitos ? ' OR p.dni LIKE ?' : ''} OR lower(vc.concepto) LIKE ?)`)
    const like = `%${q.toLowerCase().replace(/[%_]/g, '')}%`
    args.push(like, like, ...(digitos ? [`%${digitos}%`] : []), like)
  }
  const [filas, plata] = await Promise.all([
    c.env.DB.prepare(
      `SELECT vc.id, vc.fecha, vc.concepto, vc.importe, vc.pagado, vc.saldo, vc.estado, p.id pid, p.nombre, p.apellido
         FROM v_cobros vc JOIN pacientes p ON p.id = vc.paciente_id ${donde.length ? `WHERE ${donde.join(' AND ')}` : ''}
        ORDER BY vc.fecha DESC, vc.id DESC LIMIT ?`
    ).bind(...args, n + 1).all<{ id: number; fecha: string; concepto: string; importe: number; pagado: number; saldo: number; estado: string; pid: number; nombre: string; apellido: string }>(),
    plataDeHoy(c.env.DB, hoy),
  ])
  const lista = filas.results ?? []
  const enlace = (cambios: Record<string, string | number>) => {
    const u = new URLSearchParams({ ...(filtro !== 'todos' && { filtro }), ...(q && { q }) })
    for (const [k, v] of Object.entries(cambios)) v === '' ? u.delete(k) : u.set(k, String(v))
    return `/cobros${u.size ? `?${u}` : ''}`
  }
  return pagina(c, 'Cobros', <>
    <section class="encabezado">
      <h1>Cobros</h1>
      <div class="fila encabezado-acciones">
        <form class="buscador" method="get" action="/cobros" role="search">
          <Lupa />
          <label for="busca" class="oculto-visual">Buscar cobros</label>
          <input id="busca" name="q" type="search" value={q} placeholder="Paciente, DNI o concepto" />
          {filtro !== 'todos' && <input type="hidden" name="filtro" value={filtro} />}
        </form>
        <Boton href="/cobros/nuevo" variante="destacado"><Mas />Cobrar</Boton>
      </div>
    </section>
    <div class="resumen-turno">
      <div class="dato-tarjeta"><span class="chico suave">Hoy cobraste</span><strong class="dato-grande">{pesos(plata.cobrado)}</strong></div>
      <div class="dato-tarjeta"><span class="chico suave">Te deben</span><strong class="dato-grande debe-texto">{pesos(plata.teDeben)}</strong></div>
      <a class="dato-tarjeta enlace-tarjeta" href="/contadora" data-modulo="cobros"><span class="chico suave">Para tu contadora</span><strong>Enviar a la contadora</strong></a>
    </div>
    <nav class="fila" aria-label="Filtrar cobros">
      {FILTROS.map((x) => <Pastilla href={enlace({ filtro: x.id === 'todos' ? '' : x.id, n: '' })} actual={x.id === filtro}>{x.texto}</Pastilla>)}
    </nav>
    <section class="tarjeta" aria-label="Lista de cobros">
      {lista.length === 0 ? <p class="suave vacio">{q ? `No encontramos cobros con «${q}».` : 'No hay cobros con ese filtro.'}</p> : (
        <ul class="lista">{lista.slice(0, n).map((x) => {
          const e = ESTADO[x.estado] ?? ESTADO.debe
          return (
            <li>
              <a class="fila-elegir" href={`/cobros/${x.id}`}>
                <span class="columna-chica">
                  <strong>{x.nombre} {x.apellido}</strong>
                  <span class="chico suave">{x.concepto} · {fechaNumeros(x.fecha)}</span>
                </span>
                <span class="fila">
                  <span class="importe">{pesos(x.importe)}</span>
                  <Estado estado={e.estado} texto={x.estado === 'parcial' ? `Debe ${pesos(x.saldo)}` : e.texto} />
                </span>
              </a>
            </li>
          )
        })}</ul>
      )}
      {lista.length > n && <div class="fila centro"><Boton href={enlace({ n: n + POR_PAGINA })} variante="borde">Ver más cobros</Boton></div>}
    </section>
  </>)
})

// ---------- Detalle de un cobro ----------
cobros.get('/cobros/:id{[0-9]+}', async (c) => {
  const id = Number(c.req.param('id'))
  const k = await c.env.DB.prepare(
    `SELECT vc.*, p.nombre, p.apellido, p.id pid, t.hora, os.nombre obra_social FROM v_cobros vc JOIN pacientes p ON p.id = vc.paciente_id
       LEFT JOIN turnos t ON t.id = vc.turno_id LEFT JOIN obras_sociales os ON os.id = vc.obra_social_id WHERE vc.id = ?`
  ).bind(id).first<{ id: number; fecha: string; concepto: string; importe: number; pagado: number; saldo: number; estado: string; cobertura: string; obra_social: string | null; anulado_motivo: string | null; nombre: string; apellido: string; pid: number; hora: string | null }>()
  if (!k) return c.notFound()
  const pagos = (await c.env.DB.prepare(
    `SELECT pa.id, pa.fecha, pa.importe, pa.medio, pa.anulado_en, pa.anulado_motivo,
            co.id comprobante_id, co.tipo comprobante_tipo, co.numero, co.estado comprobante_estado
       FROM pagos pa LEFT JOIN comprobantes co ON co.pago_id = pa.id AND co.tipo IN ('interno', 'factura_c')
      WHERE pa.cobro_id = ? ORDER BY pa.fecha, pa.id`
  ).bind(id).all<{ id: number; fecha: string; importe: number; medio: string; anulado_en: string | null; anulado_motivo: string | null; comprobante_id: number | null; comprobante_tipo: string | null; numero: number | null; comprobante_estado: string | null }>()).results ?? []
  const e = ESTADO[k.estado] ?? ESTADO.debe
  const aviso = c.req.query('aviso')
  const AVISOS: Record<string, [string, 'ok' | 'ambar']> = {
    sin_cargo: ['Quedó «Sin cargo»: no lleva pago ni comprobante.', 'ok'],
    te_deben: ['Quedó en «Te deben». Cuando pague, lo cobrás desde acá.', 'ambar'],
    pago_anulado: ['Pago anulado.', 'ok'],
    cobro_anulado: ['Cobro anulado.', 'ok'],
  }
  const error = c.req.query('error')
  const vigentes = pagos.filter((p) => !p.anulado_en)
  return pagina(c, 'Cobro', <div class="angosto columna">
    <a class="volver" href="/cobros"><Volver />Volver a Cobros</a>
    {aviso && AVISOS[aviso] && <Aviso tipo={AVISOS[aviso][1]}>{AVISOS[aviso][0]}</Aviso>}
    {error && <Aviso tipo="error">{error.slice(0, 200)}</Aviso>}
    <Tarjeta etiqueta="Cobro">
      <div class="entre-todo">
        <div class="columna-chica">
          <h1 class="titulo-ficha"><a href={`/pacientes/${k.pid}`}>{k.nombre} {k.apellido}</a></h1>
          <span class="suave">{k.concepto} · {fechaNumeros(k.fecha)}{k.hora ? ` ${k.hora}` : ''} · {k.cobertura === 'obra_social' ? `copago ${k.obra_social ?? ''}` : 'Particular'}</span>
        </div>
        <Estado estado={e.estado} texto={e.texto} />
      </div>
      <div class="resumen-turno">
        <div class="dato-tarjeta"><span class="chico suave">Importe</span><strong>{pesos(k.importe)}</strong></div>
        <div class="dato-tarjeta"><span class="chico suave">Pagó</span><strong>{pesos(k.pagado)}</strong></div>
        <div class="dato-tarjeta"><span class="chico suave">Falta</span><strong class={k.saldo > 0 ? 'debe-texto' : undefined}>{pesos(k.saldo)}</strong></div>
      </div>
      {k.estado === 'anulado' && <Aviso>Anulado: {k.anulado_motivo}</Aviso>}
      {k.saldo > 0 && <Boton href={`/cobros/nuevo?cobro=${k.id}`} variante="destacado">Cobrar {pesos(k.saldo)}</Boton>}
    </Tarjeta>
    <Tarjeta titulo="Pagos">
      {pagos.length === 0 ? <p class="suave">Todavía no tiene pagos.</p> : (
        <ul class="lista">{pagos.map((p) => (
          <li class="apilado">
            <span class="entre-todo fila">
              <span class={p.anulado_en ? 'tachado' : undefined}><strong>{pesos(p.importe)}</strong> · {textoMedio(p.medio)} · {fechaNumeros(p.fecha)}</span>
              {!p.anulado_en && (p.comprobante_id
                ? <a href={`/comprobantes/${p.comprobante_id}`} data-modulo="cobros">{p.comprobante_tipo === 'interno' ? `Comprobante n.º ${p.numero}` : 'Factura C'}{p.comprobante_estado === 'pendiente' ? ' (pendiente)' : ''}</a>
                : <a href={`/comprobantes/nuevo?pago=${p.id}`} data-modulo="cobros">Hacer el comprobante</a>)}
            </span>
            {p.anulado_en && <span class="chico suave">Anulado: {p.anulado_motivo}</span>}
            {!p.anulado_en && (
              <details class="desplegable">
                <summary>Anular este pago</summary>
                <form method="post" action={`/pagos/${p.id}/anular`} class="columna" data-confirmar="¿Anular el pago? Su comprobante interno también queda anulado.">
                  <Campo etiqueta="Motivo" nombre="motivo" requerido autocompletar="off" ayuda="Por ejemplo: «Importe mal cargado». El pago queda en el historial, tachado." />
                  <div><button type="submit" class="boton peligro">Anular el pago</button></div>
                </form>
              </details>
            )}
          </li>
        ))}</ul>
      )}
    </Tarjeta>
    {k.estado !== 'anulado' && vigentes.length === 0 && (
      <details class="desplegable">
        <summary>Anular el cobro</summary>
        <form method="post" action={`/cobros/${k.id}/anular`} class="columna" data-confirmar="¿Anular el cobro?">
          <Campo etiqueta="Motivo" nombre="motivo" requerido autocompletar="off" ayuda="Por ejemplo: «Cargado dos veces»." />
          <div><button type="submit" class="boton peligro">Anular el cobro</button></div>
        </form>
      </details>
    )}
  </div>)
})

// ---------- Anular ----------
cobros.post('/pagos/:id{[0-9]+}/anular', async (c) => {
  const id = Number(c.req.param('id'))
  const f = await c.req.parseBody()
  const pago = await c.env.DB.prepare('SELECT cobro_id FROM pagos WHERE id = ?').bind(id).first<{ cobro_id: number }>()
  if (!pago) return c.notFound()
  try {
    const motivo = leerMotivo(f.motivo)
    await anularPago(c.env.DB, id, motivo, ahoraISO())
    await registrar(c, 'pago_anulado', `pago:${id}`, c.get('email'))
    return c.redirect(`/cobros/${pago.cobro_id}?aviso=pago_anulado`)
  } catch (e) {
    if (!(e instanceof ErrorCobro)) throw e
    return c.redirect(`/cobros/${pago.cobro_id}?error=${encodeURIComponent(e.message)}`)
  }
})

cobros.post('/cobros/:id{[0-9]+}/anular', async (c) => {
  const id = Number(c.req.param('id'))
  const f = await c.req.parseBody()
  try {
    const motivo = leerMotivo(f.motivo)
    if (await anularCobro(c.env.DB, id, motivo, ahoraISO())) await registrar(c, 'cobro_anulado', `cobro:${id}`, c.get('email'))
    return c.redirect(`/cobros/${id}?aviso=cobro_anulado`)
  } catch (e) {
    if (!(e instanceof ErrorCobro)) throw e
    return c.redirect(`/cobros/${id}?error=${encodeURIComponent(e.message)}`)
  }
})

// ---------- QR para transferir (lo carga Configuración, X4) ----------
cobros.get('/cobros/qr', async (c) => {
  const prof = await c.env.DB.prepare('SELECT transferencia_qr_clave clave FROM profesional WHERE id = 1').first<{ clave: string | null }>()
  if (!prof?.clave) return c.notFound()
  const obj = await c.env.ARCHIVOS.get(prof.clave)
  if (!obj) return c.notFound()
  const tipo = obj.httpMetadata?.contentType ?? 'image/png'
  if (!/^image\/(png|jpeg|webp)$/.test(tipo)) return c.notFound()
  const descargar = c.req.query('descargar') === '1'
  return new Response(obj.body, { headers: {
    'Content-Type': tipo, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    ...(descargar && { 'Content-Disposition': `attachment; filename="qr-para-pagar.${tipo.split('/')[1].replace('jpeg', 'jpg')}"` }),
  } })
})
