// P5 · Enviar a la contadora. Maqueta: docs/pantallas/Contadora.dc.html · docs/DISENO_APROBADO.md, sección 7.
// Manda por correo (o deja descargar) la planilla del período con cobros, pagos y comprobantes. Sin datos clínicos.
import { Hono } from 'hono'
import type { Child } from 'hono/jsx'
import type { C, Env } from '../tipos'
import { leerInstalacion } from '../lib/instalacion'
import { MESES, ahoraAR } from '../lib/fechas'
import { ErrorCorreo, SIN_CORREO, esCorreo, mandarCorreo, modoCorreo } from '../lib/correo'
import { TIPO_XLSX, elegirPeriodo, fechaCorta, hojas, nombrePlanilla, periodos, planilla, totales, type Periodo, type Totales } from '../lib/contadora'
import { Pagina } from '../ui/pagina'
import { Aviso, Boton, Campo, Pastilla, Tarjeta, pesos } from '../ui/componentes'
import { Volver } from '../ui/iconos'
import { avisosSinLeer, datosProfesional } from './inicio'

export const contadora = new Hono<Env>()
type Perfil = { nombre: string | null; correo: string | null; correo_contadora: string | null }
type Envio = { id: number; desde: string; hasta: string; para: string | null; creado_en: string }

const perfil = (c: C) => c.env.DB.prepare('SELECT nombre, correo, correo_contadora FROM profesional WHERE id = 1').first<Perfil>()
const consulta = (p: Periodo) => new URLSearchParams({ periodo: p.clave, ...(p.clave === 'fechas' && { desde: p.desde, hasta: p.hasta }) }).toString()
const fechaNumeros = (f: string) => `${fechaCorta(f)}/${f.slice(0, 4)}`

/** Cómo se llama un envío viejo en la lista: el mes, el trimestre o las fechas. */
export function nombreDePeriodo(desde: string, hasta: string, hoy: string) {
  const anio = Number(desde.slice(0, 4)), mes = Number(desde.slice(5, 7))
  const fin = (m: number) => `${anio}-${String(m).padStart(2, '0')}-${new Date(Date.UTC(anio, m, 0)).getUTCDate()}`
  const otroAnio = String(anio) === hoy.slice(0, 4) ? '' : ` ${anio}`
  if (desde.slice(8) === '01' && hasta === fin(mes)) return `${MESES[mes - 1][0].toUpperCase()}${MESES[mes - 1].slice(1)}${otroAnio}`
  if (desde.slice(8) === '01' && (mes - 1) % 3 === 0 && hasta === fin(mes + 2)) return `${['Primer', 'Segundo', 'Tercer', 'Cuarto'][(mes - 1) / 3]} trimestre${otroAnio}`
  return `Del ${fechaNumeros(desde)} al ${fechaNumeros(hasta)}`
}

async function pagina(c: C, hijos: Child, status: 200 | 422 = 200) {
  const [prof, avisos] = await Promise.all([datosProfesional(c), avisosSinLeer(c)])
  return c.html(<Pagina titulo="Enviar a la contadora" seccion="cobros" inst={leerInstalacion(c.env)} email={c.get('email')!} nombre={prof.nombre} avisos={avisos}>{hijos}</Pagina>, status)
}

async function pantalla(c: C, q: Record<string, string | undefined>, aviso?: { tipo: 'ok' | 'error'; texto: string }) {
  const { fecha: hoy } = ahoraAR()
  const { periodo, error } = elegirPeriodo(hoy, q)
  const [prof, t, anteriores] = await Promise.all([
    perfil(c),
    error ? null : totales(c.env.DB, periodo.desde, periodo.hasta),
    c.env.DB.prepare('SELECT id, desde, hasta, para, creado_en FROM envios_contadora ORDER BY id DESC LIMIT 8').all<Envio>(),
  ])
  const modo = modoCorreo(c.env)
  const para = esCorreo(prof?.correo_contadora) ? prof!.correo_contadora! : null
  const puedeEnviar = !error && !!para && !!modo
  const oculto = <><input type="hidden" name="periodo" value={periodo.clave} />{periodo.clave === 'fechas' && <><input type="hidden" name="desde" value={periodo.desde} /><input type="hidden" name="hasta" value={periodo.hasta} /></>}</>
  return pagina(c, <div class="angosto columna">
    <a class="volver" href="/cobros"><Volver />Volver a Cobros</a>
    <section class="encabezado"><div class="columna-chica"><h1>Enviar a la contadora</h1><span class="portada-sub">Una planilla con cobros, pagos y comprobantes.</span></div></section>
    {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}
    <nav class="fila" aria-label="Período">
      {periodos(hoy, q.desde, q.hasta).map((p) => <Pastilla href={`/contadora?${consulta(p)}`} actual={p.clave === periodo.clave}>{p.titulo}</Pastilla>)}
    </nav>
    {periodo.clave === 'fechas' && (
      <form class="fila contadora-fechas" method="get" action="/contadora">
        <input type="hidden" name="periodo" value="fechas" />
        <Campo etiqueta="Desde" nombre="desde" tipo="date" valor={q.desde ?? periodo.desde} />
        <Campo etiqueta="Hasta" nombre="hasta" tipo="date" valor={q.hasta ?? periodo.hasta} />
        <Boton type="submit" variante="borde">Ver el período</Boton>
      </form>
    )}
    {error ? <Aviso tipo="error">{error}</Aviso> : <Resumen t={t!} />}
    <Tarjeta titulo="La planilla trae tres hojas">
      <ul class="contadora-hojas">
        <li><strong>Cobros</strong> · paciente, prestación, cobertura, saldo</li>
        <li><strong>Pagos</strong> · medio y anulados con motivo</li>
        <li><strong>Comprobantes</strong> · número, receptor, CAE</li>
      </ul>
      <p class="ayuda">No lleva datos clínicos.</p>
    </Tarjeta>
    <Tarjeta etiqueta="Para quién">
      <div class="fila entre-todo">
        <div class="columna-chica"><span class="chico suave">Para</span>{para ? <strong>{para}</strong> : <span>Todavía no cargaste el correo de tu contadora.</span>}</div>
        <Boton href="/configuracion/cobros" variante="texto">{para ? 'Cambiar' : 'Cargarlo'}</Boton>
      </div>
      {!modo && <Aviso tipo="ambar">{SIN_CORREO} Mientras tanto, podés descargar la planilla y mandarla vos.</Aviso>}
      {modo === 'demo' && <p class="ayuda">En la demo no sale ningún correo de verdad.</p>}
      {prof?.correo && esCorreo(prof.correo) && <p class="ayuda">Te llega una copia a {prof.correo}.</p>}
      <div class="fila contadora-acciones">
        <form method="post" action="/contadora/enviar">{oculto}<Boton type="submit" variante="destacado" disabled={!puedeEnviar}>Enviar {periodo.nombre}</Boton></form>
        <form method="post" action="/contadora/planilla">{oculto}<Boton type="submit" variante="borde" disabled={!!error}>Solo descargar la planilla</Boton></form>
      </div>
    </Tarjeta>
    <Tarjeta titulo="Envíos anteriores">
      {anteriores.results.length === 0 ? <p class="suave">Todavía no le mandaste nada.</p> : (
        <ul class="lista">{anteriores.results.map((e) => (
          <li class="fila entre-todo"><strong>{nombreDePeriodo(e.desde, e.hasta, hoy)}</strong>
            <span class="chico suave">{e.para ? `enviado el ${fechaCorta(ahoraAR(Date.parse(e.creado_en)).fecha)} a ${e.para}` : `descargada el ${fechaCorta(ahoraAR(Date.parse(e.creado_en)).fecha)}`}</span></li>
        ))}</ul>
      )}
    </Tarjeta>
  </div>, error || aviso?.tipo === 'error' ? 422 : 200)
}

function Resumen({ t }: { t: Totales }) {
  return <div class="resumen-turno" aria-label="Totales del período">
    <div class="dato-tarjeta"><span class="chico suave">Cobrado</span><strong class="dato-grande">{pesos(t.cobrado)}</strong><span class="chico suave">{t.pagos} {t.pagos === 1 ? 'pago' : 'pagos'}</span></div>
    <div class="dato-tarjeta"><span class="chico suave">Facturado</span><strong class="dato-grande">{pesos(t.facturado)}</strong><span class="chico suave">{t.facturas} {t.facturas === 1 ? 'factura C' : 'facturas C'}</span></div>
    <div class="dato-tarjeta"><span class="chico suave">Sin factura</span><strong class="dato-grande">{pesos(t.sin_factura)}</strong><span class="chico suave">{t.internos} {t.internos === 1 ? 'comprobante interno' : 'comprobantes internos'}</span></div>
  </div>
}

contadora.get('/contadora', (c) => pantalla(c, c.req.query(), c.req.query('enviado') ? { tipo: 'ok', texto: c.req.query('copia') === '1' ? 'Enviado. Te llegó una copia a tu correo.' : 'Enviado.' } : undefined))

async function leerPedido(c: C) {
  const f = await c.req.parseBody()
  const q = Object.fromEntries(['periodo', 'desde', 'hasta'].map((k) => [k, typeof f[k] === 'string' ? (f[k] as string) : undefined]))
  const { fecha: hoy } = ahoraAR()
  return { q, ...elegirPeriodo(hoy, q) }
}
const guardarEnvio = (c: C, p: Periodo, t: Totales, para: string | null) =>
  c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO envios_contadora (desde, hasta, para, cobrado, facturado, sin_factura) VALUES (?, ?, ?, ?, ?, ?)').bind(p.desde, p.hasta, para, t.cobrado, t.facturado, t.sin_factura),
    c.env.DB.prepare('INSERT INTO auditoria (evento, detalle, usuario) VALUES (?, ?, ?)').bind(para ? 'contadora_enviada' : 'contadora_descargada', `${p.desde}..${p.hasta}`, c.get('email')!),
  ])

contadora.post('/contadora/planilla', async (c) => {
  const { q, periodo, error } = await leerPedido(c)
  if (error) return pantalla(c, q, { tipo: 'error', texto: error })
  const [t, h] = await Promise.all([totales(c.env.DB, periodo.desde, periodo.hasta), hojas(c.env.DB, periodo.desde, periodo.hasta)])
  const b = planilla(h)
  await guardarEnvio(c, periodo, t, null)
  c.header('Content-Type', TIPO_XLSX)
  c.header('Content-Disposition', `attachment; filename="${nombrePlanilla(periodo.desde, periodo.hasta)}"`)
  c.header('Cache-Control', 'private, no-store')
  c.header('X-Content-Type-Options', 'nosniff')
  return c.body(b.buffer as ArrayBuffer)
})

contadora.post('/contadora/enviar', async (c) => {
  const { q, periodo, error } = await leerPedido(c)
  if (error) return pantalla(c, q, { tipo: 'error', texto: error })
  const prof = await perfil(c)
  if (!esCorreo(prof?.correo_contadora)) return pantalla(c, q, { tipo: 'error', texto: 'Cargá el correo de tu contadora en Configuración → Cobros y comprobantes.' })
  const [t, h] = await Promise.all([totales(c.env.DB, periodo.desde, periodo.hasta), hojas(c.env.DB, periodo.desde, periodo.hasta)])
  const copia = esCorreo(prof!.correo) && prof!.correo !== prof!.correo_contadora ? prof!.correo : null
  const rango = `del ${fechaNumeros(periodo.desde)} al ${fechaNumeros(periodo.hasta)}`
  const titulo = periodo.clave === 'fechas' ? rango : `de ${periodo.nombre.replace(/^el /, '')} ${periodo.desde.slice(0, 4)}`
  try {
    await mandarCorreo(c.env, {
      para: prof!.correo_contadora!, copia, responderA: copia,
      asunto: `Cobros ${titulo}${prof!.nombre ? ` · ${prof!.nombre}` : ''}`,
      texto: [
        'Hola,', '',
        `Te mando la planilla con los cobros, pagos y comprobantes ${rango}.`, '',
        `Cobrado: ${pesos(t.cobrado)} (${t.pagos} ${t.pagos === 1 ? 'pago' : 'pagos'})`,
        `Facturado: ${pesos(t.facturado)} (${t.facturas} ${t.facturas === 1 ? 'factura C' : 'facturas C'})`,
        `Sin factura: ${pesos(t.sin_factura)} (${t.internos} ${t.internos === 1 ? 'comprobante interno' : 'comprobantes internos'})`, '',
        'Saludos,', prof!.nombre ?? '',
      ].join('\n'),
      adjuntos: [{ nombre: nombrePlanilla(periodo.desde, periodo.hasta), tipo: TIPO_XLSX, datos: planilla(h) }],
    }, prof!.nombre ?? '')
  } catch (e) {
    if (e instanceof ErrorCorreo) return pantalla(c, q, { tipo: 'error', texto: e.message })
    throw e
  }
  await guardarEnvio(c, periodo, t, prof!.correo_contadora!)
  return c.redirect(`/contadora?${consulta(periodo)}&enviado=1${copia ? '&copia=1' : ''}`, 303)
})
