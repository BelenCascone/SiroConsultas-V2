// P3 · Bloquear la agenda, resolver uno por uno los turnos que caen adentro y los feriados con «¿Atendés?».
// Maqueta: docs/pantallas/Bloqueo.dc.html · docs/DISENO_APROBADO.md, sección 5.
import { Hono } from 'hono'
import type { Child } from 'hono/jsx'
import type { C, Env } from '../tipos'
import { leerInstalacion } from '../lib/instalacion'
import { DIAS, ahoraAR, ahoraISO, esFecha, esHora, sumarDias } from '../lib/fechas'
import { registrar } from '../lib/sesion'
import { enlaceWhatsapp } from '../lib/pacientes'
import { aMinutos, cargarAgenda, MOTIVOS_BLOQUEO } from '../lib/turnos'
import { moverTurno } from '../lib/agenda'
import {
  HORAS_PARA_ELEGIR, MOTIVO_TEXTO, cuandoCorto, leerBloqueo, mensajeParaElegir, rangoCorto, sugerirHorarios, turnosEnBloqueo,
  type DatosBloqueo, type Horario, type TurnoEnBloqueo,
} from '../lib/bloqueos'
import { Pagina } from '../ui/pagina'
import { Aviso, Boton, Campo, Opciones, Tarjeta } from '../ui/componentes'
import { Calendario, Volver } from '../ui/iconos'
import { datosProfesional, avisosSinLeer } from './inicio'

export const bloqueos = new Hono<Env>()

async function pagina(c: C, titulo: string, hijos: Child, status: 200 | 404 = 200) {
  const [prof, avisos] = await Promise.all([datosProfesional(c), avisosSinLeer(c)])
  return c.html(
    <Pagina titulo={titulo} seccion="agenda" inst={leerInstalacion(c.env)} email={c.get('email')!} nombre={prof.nombre} avisos={avisos}>
      {hijos}
    </Pagina>, status)
}

const entero = (v: unknown) => (typeof v === 'string' && /^\d{1,9}$/.test(v) ? Number(v) : 0)
const may = (s: string) => s[0].toUpperCase() + s.slice(1)
const nuevoUrl = (p: Record<string, string | null | undefined>) => {
  const u = new URLSearchParams()
  for (const [k, v] of Object.entries(p)) if (v) u.set(k, v)
  return `/bloqueos/nuevo${u.size ? `?${u}` : ''}`
}
/** Los textos que viajan en la dirección se recortan: se muestran siempre como texto, nunca como HTML. */
const recorte = (v: unknown) => (typeof v === 'string' ? v.slice(0, 300) : '')

type Fila = { id: number } & DatosBloqueo & { quitado_en: string | null }
const leerFila = (db: D1Database, id: number) => db.prepare(
  'SELECT id, desde, hasta, hora_desde, hora_hasta, consultorio_id, motivo, quitado_en FROM bloqueos WHERE id = ?').bind(id).first<Fila>()

/** «Congreso · Centro · de 13:00 a 15:00» */
async function descripcion(db: D1Database, b: DatosBloqueo) {
  const lugar = b.consultorio_id ? (await db.prepare('SELECT nombre FROM consultorios WHERE id = ?').bind(b.consultorio_id).first<{ nombre: string }>())?.nombre ?? null : null
  return [MOTIVO_TEXTO(b.motivo), lugar, b.hora_desde && b.hora_hasta ? `de ${b.hora_desde} a ${b.hora_hasta}` : null].filter(Boolean).join(' · ')
}

// ---------- Armar el bloqueo ----------
bloqueos.get('/bloqueos/nuevo', async (c) => {
  const q = c.req.query()
  const { fecha: hoy, hora: ahora } = ahoraAR()
  const db = c.env.DB
  const desde = esFecha(q.desde ?? '') ? q.desde! : hoy
  const hasta = esFecha(q.hasta ?? '') && q.hasta! >= desde ? q.hasta! : desde
  const alcance = q.alcance === 'franja' ? 'franja' : 'dia'
  const hora_desde = esHora(q.hora_desde ?? '') ? q.hora_desde! : '13:00'
  const hora_hasta = esHora(q.hora_hasta ?? '') ? q.hora_hasta! : '15:00'
  const motivo = q.motivo && q.motivo in MOTIVOS_BLOQUEO ? q.motivo : ''
  const consultorios = (await db.prepare('SELECT id, nombre FROM consultorios WHERE activo = 1 ORDER BY orden, nombre').all<{ id: number; nombre: string }>()).results ?? []
  const consultorio = consultorios.some((x) => String(x.id) === q.consultorio) ? q.consultorio! : 'todos'

  const armado = leerBloqueo({ desde, hasta, alcance, hora_desde, hora_hasta, consultorio, motivo }, hoy)
  const adentro = armado.datos ? (await turnosEnBloqueo(db, armado.datos, hoy, aMinutos(ahora))).length : 0
  const donde = alcance === 'franja' ? 'en esas horas' : 'en esos días'

  const vigentes = (await db.prepare(
    `SELECT b.id, b.desde, b.hasta, b.hora_desde, b.hora_hasta, b.consultorio_id, b.motivo, b.quitado_en FROM bloqueos b
      WHERE b.quitado_en IS NULL AND b.hasta >= ? ORDER BY b.desde, b.id LIMIT 30`).bind(hoy).all<Fila>()).results ?? []
  const vigentesConDatos = await Promise.all(vigentes.map(async (b) => ({
    ...b, texto: await descripcion(db, b), faltan: (await turnosEnBloqueo(db, b, hoy, aMinutos(ahora))).length,
  })))

  const feriados = (await db.prepare(
    `SELECT f.fecha, f.nombre, f.atiende, (SELECT COUNT(*) FROM turnos t WHERE t.fecha = f.fecha AND t.estado = 'confirmado') turnos
       FROM feriados f WHERE f.fecha >= ? ORDER BY f.fecha LIMIT 8`).bind(hoy).all<{ fecha: string; nombre: string; atiende: number | null; turnos: number }>()).results ?? []

  return pagina(c, 'Bloquear la agenda', (
    <div class="angosto columna">
      <a class="volver" href="/agenda"><Volver />Volver a la agenda</a>
      <div class="columna-chica centrado">
        <h1>Bloquear la agenda</h1>
        <p class="suave">Lo bloqueado no se ofrece para dar turnos ni en el pedido online.</p>
      </div>
      {q.quitado === '1' && <Aviso tipo="ok">Bloqueo quitado: esos horarios vuelven a ofrecerse.</Aviso>}
      {q.error && <Aviso tipo="error">{recorte(q.error)}</Aviso>}
      <Tarjeta titulo="Nuevo bloqueo">
        <form method="post" action="/bloqueos" class="columna" data-recalcular="/bloqueos/nuevo" novalidate>
          <div class="campos-2">
            <Campo etiqueta="Desde" nombre="desde" tipo="date" valor={desde} />
            <Campo etiqueta="Hasta" nombre="hasta" tipo="date" valor={hasta} />
          </div>
          <Opciones leyenda="Qué se bloquea" nombre="alcance" elegida={alcance} opciones={[{ valor: 'dia', texto: 'Todo el día' }, { valor: 'franja', texto: 'Una franja' }]} />
          {alcance === 'franja' && (
            <div class="campos-2">
              <Campo etiqueta="Desde la hora" nombre="hora_desde" tipo="time" valor={hora_desde} />
              <Campo etiqueta="Hasta la hora" nombre="hora_hasta" tipo="time" valor={hora_hasta} />
            </div>
          )}
          <div class="campo">
            <label for="c-consultorio">Consultorio</label>
            <select id="c-consultorio" name="consultorio" class="entrada">
              <option value="todos" selected={consultorio === 'todos'}>Todos</option>
              {consultorios.map((x) => <option value={x.id} selected={String(x.id) === consultorio}>{x.nombre}</option>)}
            </select>
          </div>
          <Opciones leyenda="Motivo, si querés (solo lo ves vos)" nombre="motivo" elegida={motivo}
            opciones={[{ valor: '', texto: 'Sin motivo' }, ...Object.entries(MOTIVOS_BLOQUEO).map(([valor, texto]) => ({ valor, texto }))]} />
          {armado.datos && (adentro > 0
            ? <Aviso tipo="ambar">Ya tenés {adentro === 1 ? '1 turno' : `${adentro} turnos`} {donde}. Al bloquear, decidís qué hacer con {adentro === 1 ? 'ese turno' : 'cada uno'}.</Aviso>
            : <Aviso>No tenés turnos {donde}.</Aviso>)}
          {!armado.datos && q.desde && <Aviso tipo="error">{armado.error}</Aviso>}
          <div class="ventana-pie entre">
            <button class="boton borde" type="submit" formmethod="get" formaction="/bloqueos/nuevo" data-sin-js="">Ver cuántos turnos caen</button>
            <Boton type="submit" variante="destacado">{desde === hasta ? `Bloquear el ${rangoCorto(desde, hasta)}` : `Bloquear del ${rangoCorto(desde, hasta)}`}</Boton>
          </div>
        </form>
      </Tarjeta>

      {vigentesConDatos.length > 0 && (
        <Tarjeta titulo="Bloqueos vigentes">
          <ul class="lista">
            {vigentesConDatos.map((b) => (
              <li>
                <span class="columna-chica">
                  <strong>{rangoCorto(b.desde, b.hasta)}</strong>
                  <span class="chico suave">{b.texto || 'Todos los consultorios'}</span>
                </span>
                <span class="fila">
                  {b.faltan > 0 && <a class="boton borde" href={`/bloqueos/${b.id}`}>Faltan resolver {b.faltan}</a>}
                  <form method="post" action={`/bloqueos/${b.id}/quitar`} data-confirmar="¿Quitar este bloqueo? Esos horarios vuelven a ofrecerse. Los turnos que ya moviste o cancelaste no se tocan.">
                    <Boton type="submit" variante="texto">Quitar</Boton>
                  </form>
                </span>
              </li>
            ))}
          </ul>
        </Tarjeta>
      )}

      <section id="feriados" class="tarjeta suave" aria-labelledby="fer-titulo">
        <div class="tarjeta-cabeza"><h2 id="fer-titulo">Próximos feriados</h2></div>
        {feriados.length === 0 && <p class="suave">No hay feriados cargados para lo que viene.</p>}
        <ul class="lista">
          {feriados.map((f) => {
            const d = DIAS[new Date(f.fecha + 'T00:00:00Z').getUTCDay()]
            return (
              <li class="feriado-fila">
                <span class="columna-chica">
                  <strong>{may(d)} {Number(f.fecha.slice(8))}/{Number(f.fecha.slice(5, 7))}</strong>
                  <span class="chico suave">{f.nombre} · {f.turnos === 0 ? 'sin turnos' : f.turnos === 1 ? 'tenés 1 turno' : `tenés ${f.turnos} turnos`}</span>
                  {f.atiende !== 1 && f.turnos > 0 && <a class="chico" href={`/agenda?vista=dia&fecha=${f.fecha}`}>Ver {f.turnos === 1 ? 'el turno' : 'los turnos'} de ese día</a>}
                </span>
                <form method="post" action="/bloqueos/feriado" class="fila" aria-label={`¿Atendés el ${f.fecha}?`}>
                  <input type="hidden" name="fecha" value={f.fecha} />
                  <span class="chico suave">¿Atendés?</span>
                  <span class="segmento">
                    <button type="submit" name="atiende" value="1" class="pastilla" aria-pressed={f.atiende === 1 ? 'true' : 'false'}>Sí</button>
                    <button type="submit" name="atiende" value="0" class="pastilla" aria-pressed={f.atiende === 0 ? 'true' : 'false'}>No</button>
                  </span>
                </form>
              </li>
            )
          })}
        </ul>
        <p class="chico suave">Hasta que lo decidas, un feriado figura sin atención.</p>
      </section>
    </div>
  ))
})

bloqueos.post('/bloqueos', async (c) => {
  const f = await c.req.parseBody() as Record<string, string>
  const { fecha: hoy } = ahoraAR()
  const campos = { desde: f.desde, hasta: f.hasta, alcance: f.alcance, hora_desde: f.hora_desde, hora_hasta: f.hora_hasta, consultorio: f.consultorio, motivo: f.motivo }
  const fallo = (error: string) => c.redirect(nuevoUrl({ ...campos, error }))
  const r = leerBloqueo(f, hoy)
  if (!r.datos) return fallo(r.error!)
  const b = r.datos
  if (b.consultorio_id && !(await c.env.DB.prepare('SELECT 1 FROM consultorios WHERE id = ? AND activo = 1').bind(b.consultorio_id).first())) return fallo('Ese consultorio no está disponible.')
  const nuevo = await c.env.DB.prepare(
    'INSERT INTO bloqueos (desde, hasta, hora_desde, hora_hasta, consultorio_id, motivo) VALUES (?, ?, ?, ?, ?, ?) RETURNING id')
    .bind(b.desde, b.hasta, b.hora_desde, b.hora_hasta, b.consultorio_id, b.motivo).first<{ id: number }>()
  await registrar(c, 'bloqueo_creado', `bloqueo:${nuevo!.id} · ${b.desde} → ${b.hasta}`, c.get('email'))
  return c.redirect(`/bloqueos/${nuevo!.id}`)
})

bloqueos.post('/bloqueos/:id{[0-9]+}/quitar', async (c) => {
  const id = Number(c.req.param('id'))
  const r = await c.env.DB.prepare('UPDATE bloqueos SET quitado_en = ? WHERE id = ? AND quitado_en IS NULL').bind(ahoraISO(), id).run()
  if (r.meta.changes) await registrar(c, 'bloqueo_quitado', `bloqueo:${id}`, c.get('email'))
  return c.redirect(nuevoUrl({ quitado: '1' }))
})

// ---------- ¿Atendés este feriado? ----------
bloqueos.post('/bloqueos/feriado', async (c) => {
  const f = await c.req.parseBody()
  const fecha = typeof f.fecha === 'string' ? f.fecha : ''
  if (esFecha(fecha) && (f.atiende === '1' || f.atiende === '0')) {
    const r = await c.env.DB.prepare('UPDATE feriados SET atiende = ? WHERE fecha = ? AND atiende IS NOT ?').bind(Number(f.atiende), fecha, Number(f.atiende)).run()
    if (r.meta.changes) await registrar(c, f.atiende === '1' ? 'feriado_atiende' : 'feriado_no_atiende', fecha, c.get('email'))
  }
  return c.redirect('/bloqueos/nuevo#feriados')
})

// ---------- Resolver los turnos de un bloqueo ----------
type Propuesta = { id: number; turno_id: number; fecha: string; hora: string }

bloqueos.get('/bloqueos/:id{[0-9]+}', async (c) => {
  const id = Number(c.req.param('id'))
  const db = c.env.DB
  const b = await leerFila(db, id)
  if (!b) return c.notFound()
  const q = c.req.query()
  const { fecha: hoy, hora: ahora } = ahoraAR()
  const ahoraMin = aMinutos(ahora)
  const volver = `/bloqueos/${id}`

  const turnos = b.quitado_en ? [] : await turnosEnBloqueo(db, b, hoy, ahoraMin)
  const propuestas = turnos.length
    ? ((await db.prepare("SELECT id, turno_id, fecha, hora FROM propuestas WHERE estado = 'reservada' AND vence_en > ? AND turno_id IS NOT NULL ORDER BY fecha, hora").bind(ahoraISO()).all<Propuesta>()).results ?? [])
    : []
  const esperando = (t: TurnoEnBloqueo) => propuestas.filter((p) => p.turno_id === t.id)
  const faltan = turnos.filter((t) => esperando(t).length === 0).length

  // Panel de «Mover» abierto en un renglón
  const moviendo = turnos.find((t) => t.id === entero(q.mover) && esperando(t).length === 0) ?? null
  let sugeridos: Horario[] = []
  if (moviendo) {
    const datos = await cargarAgenda(db, moviendo.fecha < hoy ? hoy : moviendo.fecha, sumarDias(moviendo.fecha < hoy ? hoy : moviendo.fecha, 60), ahoraISO())
    sugeridos = sugerirHorarios({ ...datos, turnos: datos.turnos.filter((x) => x.id !== moviendo.id) }, moviendo.consultorio_id, moviendo.duracion_min, moviendo.fecha, moviendo.hora, hoy, ahoraMin)
  }
  const [ec, ef, eh] = (q.elegido ?? '').split(',')
  const elegido = moviendo && ec === String(moviendo.consultorio_id) ? sugeridos.find((s) => s.fecha === ef && s.hora === eh) ?? null : null

  const prof = await datosProfesional(c)
  const firma = prof.nombre ? ` ${prof.nombre}.` : ''
  const detalle = await descripcion(db, b)

  return pagina(c, 'Bloqueo', (
    <div class="angosto columna">
      <a class="volver" href="/agenda"><Volver />Volver a la agenda</a>
      {q.hecho && <Aviso tipo="ok">{recorte(q.hecho)}</Aviso>}
      {q.error && <Aviso tipo="error">{recorte(q.error)}</Aviso>}
      {b.quitado_en
        ? <Aviso tipo="ambar">Este bloqueo se quitó: esos horarios vuelven a ofrecerse.</Aviso>
        : <Aviso tipo="ok">Agenda bloqueada {b.desde === b.hasta ? 'el' : 'del'} {rangoCorto(b.desde, b.hasta)}{detalle ? ` · ${detalle.toLowerCase()}` : ''}</Aviso>}
      {!b.quitado_en && (
        <Tarjeta titulo={faltan === 0 ? 'Todo resuelto' : faltan === 1 ? 'Falta resolver 1 turno' : `Faltan resolver ${faltan} turnos`}>
          {turnos.length === 0 && <p class="suave">No hay turnos adentro de este bloqueo.</p>}
          <ul class="resolver-lista">
            {turnos.map((t) => {
              const hay = esperando(t)
              const abierto = moviendo?.id === t.id
              return (
                <li class={hay.length ? 'resolver hecho' : 'resolver'}>
                  <span class="columna-chica resolver-quien">
                    <strong>{t.nombre} {t.apellido}</strong>
                    <span class="chico suave">{cuandoCorto(t.fecha, t.hora)} · {t.prestacion ?? 'Consulta'} · {t.consultorio}</span>
                  </span>
                  {hay.length > 0 ? (
                    <div class="resolver-panel">
                      <span class="chico suave">Le ofrecimos estos horarios; quedan reservados hasta que elija (o {HORAS_PARA_ELEGIR} horas).</span>
                      <div class="fila-marcas">
                        {hay.map((p) => (
                          <form method="post" action={`/bloqueos/${id}/elegir`}>
                            <input type="hidden" name="turno" value={t.id} />
                            <input type="hidden" name="propuesta" value={p.id} />
                            <button class="pastilla" type="submit">Eligió el {cuandoCorto(p.fecha, p.hora)}</button>
                          </form>
                        ))}
                      </div>
                      <div class="fila">
                        <Boton href={enlaceWhatsapp(t.celular, mensajeParaElegir(t.nombre, cuandoCorto(t.fecha, t.hora), hay.map((p) => cuandoCorto(p.fecha, p.hora)), firma))} variante="borde">Mandar los horarios por WhatsApp</Boton>
                        <form method="post" action={`/turnos/${t.id}/cancelar`} data-confirmar={`¿Cancelar el turno de ${t.nombre}? Después te dejamos el mensaje listo para avisarle.`}>
                          <input type="hidden" name="volver" value={volver} />
                          <Boton type="submit" variante="peligro">Cancelar y avisar</Boton>
                        </form>
                      </div>
                    </div>
                  ) : abierto ? (
                    <div class="resolver-panel">
                      <span class="chico suave">Primeros huecos libres después del bloqueo, cerca de su horario de siempre</span>
                      <div class="fila-marcas">
                        {sugeridos.map((s) => (
                          <a class="pastilla" href={`${volver}?${new URLSearchParams({ mover: String(t.id), elegido: `${t.consultorio_id},${s.fecha},${s.hora}` })}`}
                            aria-pressed={elegido?.fecha === s.fecha && elegido.hora === s.hora ? 'true' : 'false'}>{cuandoCorto(s.fecha, s.hora)}</a>
                        ))}
                        <a class="pastilla" href={`/agenda?${new URLSearchParams({ vista: 'semana', fecha: sugeridos[0]?.fecha ?? sumarDias(b.hasta, 1), mover: String(t.id), volver })}`}><Calendario />Otro día en la agenda</a>
                      </div>
                      {sugeridos.length === 0 && <p class="chico suave">No encontramos huecos libres en los próximos 60 días: elegí otro día en la agenda.</p>}
                      <div class="fila">
                        {elegido ? (
                          <form method="post" action={`/bloqueos/${id}/mover`}>
                            <input type="hidden" name="turno" value={t.id} />
                            <input type="hidden" name="consultorio" value={t.consultorio_id} />
                            <input type="hidden" name="fecha" value={elegido.fecha} />
                            <input type="hidden" name="hora" value={elegido.hora} />
                            <Boton type="submit" variante="destacado">Mover al {cuandoCorto(elegido.fecha, elegido.hora)} y avisar</Boton>
                          </form>
                        ) : <span class="boton inactivo" aria-disabled="true">Elegí un horario</span>}
                        {sugeridos.length > 0 && (
                          <form method="post" action={`/bloqueos/${id}/proponer`}>
                            <input type="hidden" name="turno" value={t.id} />
                            <Boton type="submit" variante="claro">Que elija el paciente</Boton>
                          </form>
                        )}
                        <a class="boton texto" href={volver}>Cancelar</a>
                      </div>
                      <p class="chico suave">«Que elija el paciente» te deja listo un WhatsApp con estos {sugeridos.length} horarios; mientras, quedan reservados.</p>
                    </div>
                  ) : (
                    <span class="fila">
                      <Boton href={`${volver}?mover=${t.id}`} variante="oscuro">Mover</Boton>
                      <form method="post" action={`/turnos/${t.id}/cancelar`} data-confirmar={`¿Cancelar el turno de ${t.nombre}? Después te dejamos el mensaje listo para avisarle.`}>
                        <input type="hidden" name="volver" value={volver} />
                        <Boton type="submit" variante="borde">Cancelar y avisar</Boton>
                      </form>
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </Tarjeta>
      )}
      <div class="fila centro">
        <Boton href="/bloqueos/nuevo" variante="texto">Hacer otro bloqueo</Boton>
        {!b.quitado_en && (
          <form method="post" action={`/bloqueos/${id}/quitar`} data-confirmar="¿Quitar este bloqueo? Esos horarios vuelven a ofrecerse. Los turnos que ya moviste o cancelaste no se tocan.">
            <Boton type="submit" variante="texto">Quitar este bloqueo</Boton>
          </form>
        )}
      </div>
    </div>
  ))
})

/** El turno tiene que seguir adentro del bloqueo y confirmado. */
async function turnoDelBloqueo(c: C, bloqueoId: number, turnoId: number) {
  const b = await leerFila(c.env.DB, bloqueoId)
  if (!b || b.quitado_en) return null
  const { fecha: hoy, hora } = ahoraAR()
  return (await turnosEnBloqueo(c.env.DB, b, hoy, aMinutos(hora))).find((t) => t.id === turnoId) ?? null
}

bloqueos.post('/bloqueos/:id{[0-9]+}/mover', async (c) => {
  const id = Number(c.req.param('id'))
  const f = await c.req.parseBody()
  const tid = entero(f.turno), cid = entero(f.consultorio)
  const fecha = typeof f.fecha === 'string' ? f.fecha : '', hora = typeof f.hora === 'string' ? f.hora : ''
  const volver = (error: string) => c.redirect(`/bloqueos/${id}?${new URLSearchParams({ mover: String(tid), error })}`)
  const t = await turnoDelBloqueo(c, id, tid)
  if (!t || !cid || !esFecha(fecha) || !esHora(hora)) return volver('Ese turno ya no está en el bloqueo.')
  const { fecha: hoy, hora: ahora } = ahoraAR()
  const r = await moverTurno(c.env.DB, { ...t, estado: 'confirmado' }, { consultorio_id: cid, fecha, hora }, hoy, aMinutos(ahora))
  if (r.error) return volver(r.error)
  await registrar(c, 'turno_movido', `turno:${tid} · ${t.fecha} ${t.hora} → ${fecha} ${hora} (bloqueo ${id})`, c.get('email'))
  return c.redirect(`/turnos/${tid}/aviso?${new URLSearchParams({ que: 'movido', antes: `${t.fecha} ${t.hora}`, volver: `/bloqueos/${id}` })}`)
})

// «Que elija el paciente»: se reservan los horarios sugeridos y se deja listo el WhatsApp con las opciones.
bloqueos.post('/bloqueos/:id{[0-9]+}/proponer', async (c) => {
  const id = Number(c.req.param('id'))
  const f = await c.req.parseBody()
  const tid = entero(f.turno)
  const db = c.env.DB
  const volver = (error: string) => c.redirect(`/bloqueos/${id}?${new URLSearchParams({ mover: String(tid), error })}`)
  const t = await turnoDelBloqueo(c, id, tid)
  if (!t) return volver('Ese turno ya no está en el bloqueo.')
  const ya = await db.prepare("SELECT 1 FROM propuestas WHERE turno_id = ? AND estado = 'reservada' AND vence_en > ?").bind(tid, ahoraISO()).first()
  if (ya) return c.redirect(`/bloqueos/${id}`)
  const { fecha: hoy, hora: ahora } = ahoraAR()
  const desde = t.fecha < hoy ? hoy : t.fecha
  const datos = await cargarAgenda(db, desde, sumarDias(desde, 60), ahoraISO())
  const opciones = sugerirHorarios({ ...datos, turnos: datos.turnos.filter((x) => x.id !== tid) }, t.consultorio_id, t.duracion_min, t.fecha, t.hora, hoy, aMinutos(ahora))
  if (!opciones.length) return volver('No hay huecos libres para ofrecerle: elegí otro día en la agenda.')
  const vence = ahoraISO(Date.now() + HORAS_PARA_ELEGIR * 3600_000)
  await db.batch(opciones.map((o) => db.prepare(
    'INSERT INTO propuestas (turno_id, consultorio_id, fecha, hora, duracion_min, vence_en) VALUES (?, ?, ?, ?, ?, ?)').bind(tid, t.consultorio_id, o.fecha, o.hora, t.duracion_min, vence)))
  await registrar(c, 'turno_propuestas', `turno:${tid} · ${opciones.length} horarios (bloqueo ${id})`, c.get('email'))
  return c.redirect(`/bloqueos/${id}?${new URLSearchParams({ hecho: `Reservamos ${opciones.length} horarios para ${t.nombre}. Mandáselos por WhatsApp para que elija.` })}`)
})

// El paciente contestó cuál le queda bien: el turno pasa a ese horario y los otros se liberan.
bloqueos.post('/bloqueos/:id{[0-9]+}/elegir', async (c) => {
  const id = Number(c.req.param('id'))
  const f = await c.req.parseBody()
  const tid = entero(f.turno), pid = entero(f.propuesta)
  const db = c.env.DB
  const volver = (error: string) => c.redirect(`/bloqueos/${id}?${new URLSearchParams({ error })}`)
  const t = await turnoDelBloqueo(c, id, tid)
  if (!t) return volver('Ese turno ya no está en el bloqueo.')
  const reservadas = (await db.prepare("SELECT id, fecha, hora, consultorio_id FROM propuestas WHERE turno_id = ? AND estado = 'reservada' AND vence_en > ?").bind(tid, ahoraISO())
    .all<{ id: number; fecha: string; hora: string; consultorio_id: number }>()).results ?? []
  const p = reservadas.find((x) => x.id === pid)
  if (!p) return volver('Esos horarios ya vencieron.')
  // Mientras se mueve, los horarios dejan de estar reservados (si no, el turno chocaría con su propia reserva).
  await db.prepare("UPDATE propuestas SET estado = CASE WHEN id = ? THEN 'elegida' ELSE 'liberada' END WHERE turno_id = ? AND estado = 'reservada'").bind(pid, tid).run()
  const { fecha: hoy, hora: ahora } = ahoraAR()
  const r = await moverTurno(db, { ...t, estado: 'confirmado' }, { consultorio_id: p.consultorio_id, fecha: p.fecha, hora: p.hora }, hoy, aMinutos(ahora))
  if (r.error) {
    await db.prepare("UPDATE propuestas SET estado = 'reservada' WHERE turno_id = ? AND id IN (" + reservadas.map(() => '?').join(',') + ')').bind(tid, ...reservadas.map((x) => x.id)).run()
    return volver(r.error)
  }
  await registrar(c, 'turno_movido', `turno:${tid} · ${t.fecha} ${t.hora} → ${p.fecha} ${p.hora} (eligió, bloqueo ${id})`, c.get('email'))
  return c.redirect(`/turnos/${tid}/aviso?${new URLSearchParams({ que: 'movido', antes: `${t.fecha} ${t.hora}`, volver: `/bloqueos/${id}` })}`)
})
