// X1 · Configuración de la instalación. No importa código de las tareas paralelas.
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { Child } from 'hono/jsx'
import type { C, Env } from '../tipos'
import { leerInstalacion } from '../lib/instalacion'
import { DatosInvalidos, DIAS, texto, entero, centavos, leerHorarios, leerFoto, normalizar, type Horario } from '../lib/configuracion'
import { Pagina, iniciales } from '../ui/pagina'
import { Aviso, Boton, Campo, Interruptor, Opciones, Tarjeta, Ventana, pesos } from '../ui/componentes'

type Perfil = { nombre: string | null; especialidad: string | null; matricula: string | null; whatsapp: string | null; correo: string | null; foto_clave: string | null }
type Consultorio = { id: number; nombre: string; modalidad: string; direccion: string | null; como_llegar: string | null; activo: number }
type Prestacion = { id: number; nombre: string; duracion_min: number; importe: number; activa: number }
type Obra = { id: number; nombre: string; en_uso: number; pacientes: number }
const SECCIONES = [
  ['perfil', 'Tu perfil', 'Nombre, matrícula, foto'],
  ['consultorios', 'Consultorios y horarios', 'Lugares y días de atención'],
  ['prestaciones', 'Prestaciones', 'Duración e importe'],
  ['obras', 'Obras sociales', 'Las que usás'],
  ['cobros', 'Cobros y comprobantes', 'Próximamente'],
  ['recordatorios', 'Recordatorios', 'Próximamente'],
  ['cuenta', 'Cuenta y seguridad', 'Próximamente'],
]
const ruta = (seccion: string) => `/configuracion/${seccion}`
const valor = (form: FormData | undefined, clave: string, defecto: string | null | number = '') => {
  const v = form?.get(clave)
  return typeof v === 'string' ? v : String(defecto ?? '')
}
const marcado = (form: FormData | undefined, clave: string, defecto: number) => form ? form.get(clave) === '1' : !!defecto
function Guardar() { return <div class="config-pie"><Boton type="submit" variante="oscuro">Guardar cambios</Boton></div> }
function Numero({ nombre, etiqueta, valor: v, min, max }: { nombre: string; etiqueta: string; valor: number | string; min: number; max: number }) {
  return <label class="campo">{etiqueta}<input class="entrada" name={nombre} type="number" min={min} max={max} step="1" value={v} required /></label>
}
function Horarios({ prefijo, horarios, form }: { prefijo: string; horarios: Horario[]; form?: FormData }) {
  return <div class="columna config-horarios">{DIAS.map((dia, i) => {
    const n = i + 1
    const desde = form?.getAll(`${prefijo}_desde_${n}`)
    const hasta = form?.getAll(`${prefijo}_hasta_${n}`)
    const franjas = desde ? desde.map((d, j) => ({ desde: String(d), hasta: String(hasta?.[j] ?? '') })) : horarios.filter(h => h.dia === n)
    if (!franjas.length) franjas.push({ desde: '', hasta: '' })
    return <fieldset class="config-dia" data-config-dia="">
      <legend><label class="config-casilla"><input type="checkbox" name={`${prefijo}_dia_${n}`} value="1" checked={marcado(form, `${prefijo}_dia_${n}`, horarios.some(h => h.dia === n) ? 1 : 0)} />{dia}</label></legend>
      <div class="columna" data-config-franjas="">{franjas.map((h, j) => <div class="config-franja">
        <label>Desde<span class="oculto-visual"> {dia}, franja {j + 1}</span><input class="entrada" type="time" name={`${prefijo}_desde_${n}`} value={h.desde} /></label>
        <label>Hasta<span class="oculto-visual"> {dia}, franja {j + 1}</span><input class="entrada" type="time" name={`${prefijo}_hasta_${n}`} value={h.hasta} /></label>
        <button class="boton texto" type="button" data-config-quitar="" aria-label={`Quitar horario de ${dia}`}>Quitar</button>
      </div>)}</div>
      <button class="boton texto" type="button" data-config-otro="">+ Otro horario<span class="oculto-visual"> de {dia}</span></button>
    </fieldset>
  })}</div>
}
function DatosConsultorio({ co, horarios, form }: { co?: Consultorio; horarios: Horario[]; form?: FormData }) {
  const p = co ? `co_${co.id}` : 'nuevo'
  return <div class="columna" data-config-consultorio="">
    <div class="config-campos">
      <Campo etiqueta="Nombre del consultorio" nombre={`${p}_nombre`} valor={valor(form, `${p}_nombre`, co?.nombre)} requerido />
      <Opciones leyenda="¿Cómo atendés ahí?" nombre={`${p}_modalidad`} elegida={valor(form, `${p}_modalidad`, co?.modalidad ?? 'presencial')} opciones={[{ valor: 'presencial', texto: 'Presencial' }, { valor: 'videollamada', texto: 'Videollamada' }]} />
      <div data-config-presencial=""><Campo etiqueta="Dirección" nombre={`${p}_direccion`} valor={valor(form, `${p}_direccion`, co?.direccion)} ayuda="Para atención presencial." /></div>
      <div data-config-presencial=""><Campo etiqueta="Cómo llegar (opcional)" nombre={`${p}_como_llegar`} valor={valor(form, `${p}_como_llegar`, co?.como_llegar)} ayuda="Enlace del mapa o indicaciones: piso, timbre." /></div>
    </div>
    <Horarios prefijo={p} horarios={horarios} form={form} />
  </div>
}
function DatosPrestacion({ pr, form }: { pr?: Prestacion; form?: FormData }) {
  const p = pr ? `pr_${pr.id}` : 'nueva'
  return <div class="config-prestacion">
    <Campo etiqueta="Nombre de la prestación" nombre={`${p}_nombre`} valor={valor(form, `${p}_nombre`, pr?.nombre)} requerido />
    <Numero etiqueta="Duración (minutos)" nombre={`${p}_duracion`} valor={valor(form, `${p}_duracion`, pr?.duracion_min ?? 30)} min={5} max={480} />
    <Campo etiqueta="Importe particular ($)" nombre={`${p}_importe`} valor={valor(form, `${p}_importe`, ((pr?.importe ?? 0) / 100).toFixed(2))} modoTeclado="numeric" requerido ayuda={pr?.importe === 0 ? 'Sin cargo' : 'Sin puntos de miles; hasta dos decimales.'} />
    <Interruptor etiqueta="Activa" nombre={`${p}_activa`} marcado={marcado(form, `${p}_activa`, pr?.activa ?? 1)} />
  </div>
}

async function pantalla(c: C, seccion: string, error?: string, form?: FormData, nuevo = false) {
  const prof = (await c.env.DB.prepare('SELECT nombre, especialidad, matricula, whatsapp, correo, foto_clave FROM profesional WHERE id = 1').first<Perfil>())!
  const avisos = (await c.env.DB.prepare('SELECT COUNT(*) n FROM notificaciones WHERE leida_en IS NULL').first<{ n: number }>())?.n ?? 0
  let contenido: Child
  if (seccion === 'perfil') {
    contenido = <Tarjeta titulo="Tu perfil"><form class="columna" method="post" action={ruta('perfil')} enctype="multipart/form-data">
      <p class="suave">Tu nombre y matrícula aparecen en los documentos que entregás.</p>
      <div class="fila">
        {prof.foto_clave ? <img class="config-foto" src="/configuracion/foto" alt="Tu foto de perfil" /> : <span class="config-foto avatar" role="img" aria-label="Iniciales del perfil">{iniciales(prof.nombre, c.get('email')!)}</span>}
        <div class="campo"><label for="config-foto">Foto de perfil</label><input id="config-foto" class="entrada" name="foto" type="file" accept="image/jpeg,image/png,image/webp" aria-describedby="foto-ayuda" /><span class="ayuda" id="foto-ayuda">JPG, PNG o WebP, hasta 5 MB.</span></div>
      </div>
      <div class="config-campos">{([
        ['nombre', 'Nombre y apellido', 120, 'text'], ['especialidad', 'Especialidad', 120, 'text'], ['matricula', 'Matrícula', 60, 'text'], ['whatsapp', 'WhatsApp', 30, 'tel'], ['correo', 'Correo', 200, 'email'],
      ] as const).map(([campo, etiqueta, max, tipo]) => <label class="campo">{etiqueta}<input class="entrada" name={campo} type={tipo} maxLength={max} value={valor(form, campo, prof[campo])} /></label>)}</div>
      <p class="ayuda">Sin nombre y matrícula no podés emitir documentos. El correo del perfil no cambia el correo con el que ingresás.</p><Guardar />
    </form></Tarjeta>
  } else if (seccion === 'consultorios') {
    const consultorios = (await c.env.DB.prepare('SELECT * FROM consultorios ORDER BY orden, id').all<Consultorio>()).results
    const horarios = (await c.env.DB.prepare('SELECT consultorio_id, dia, desde, hasta FROM horarios ORDER BY dia, desde').all<Horario & { consultorio_id: number }>()).results
    contenido = <>
      <Tarjeta titulo="Consultorios y horarios" accion={<Boton abre="nuevo-consultorio">+ Agregar consultorio</Boton>}>
        <p class="ayuda">Apagar un consultorio conserva sus turnos y datos; deja de ofrecerse para turnos nuevos.</p>
        <form class="columna" method="post" action={ruta('consultorios')}>
          {consultorios.map(co => <section class="config-registro" aria-label={`Consultorio ${co.nombre}`}>
            <input type="hidden" name="ids" value={co.id} />
            <div class="tarjeta-cabeza"><h3>{co.nombre}</h3><Interruptor etiqueta={`Consultorio ${co.nombre} activo`} nombre={`co_${co.id}_activo`} marcado={marcado(nuevo ? undefined : form, `co_${co.id}_activo`, co.activo)} /></div>
            <p class="suave chico">{co.modalidad === 'videollamada' ? 'Videollamada' : co.direccion || 'Sin dirección'}</p>
            <ul class="config-resumen">{DIAS.map((dia, i) => {
              const franjas = horarios.filter(h => h.consultorio_id === co.id && h.dia === i + 1)
              return franjas.length ? <li><strong>{dia}</strong> {franjas.map(h => `${h.desde}–${h.hasta}`).join(' y ')}</li> : null
            })}</ul>
            <details open={!!error && !nuevo}><summary class="boton texto">Editar horarios<span class="oculto-visual"> de {co.nombre}</span></summary><DatosConsultorio co={co} horarios={horarios.filter(h => h.consultorio_id === co.id)} form={nuevo ? undefined : form} /></details>
          </section>)}
          {consultorios.length ? <Guardar /> : <p>Todavía no agregaste consultorios.</p>}
        </form>
      </Tarjeta>
      <Ventana id="nuevo-consultorio" titulo="Agregar consultorio"><form class="columna" method="post" action="/configuracion/consultorios/nuevo">
        {nuevo && error && <Aviso tipo="error">{error}</Aviso>}<DatosConsultorio horarios={[]} form={nuevo ? form : undefined} /><div class="config-pie"><Boton cierra>Cancelar</Boton><Boton type="submit" variante="oscuro">Guardar consultorio</Boton></div>
      </form></Ventana>
      {nuevo && error && <span hidden data-config-abrir="nuevo-consultorio" />}
    </>
  } else if (seccion === 'prestaciones') {
    const prestaciones = (await c.env.DB.prepare('SELECT * FROM prestaciones ORDER BY orden, id').all<Prestacion>()).results
    contenido = <>
      <Tarjeta titulo="Prestaciones" accion={<Boton abre="nueva-prestacion">+ Agregar prestación</Boton>}>
        <p class="suave">La duración arma la agenda. El importe es lo que se cobra si es particular.</p>
        <form class="columna" method="post" action={ruta('prestaciones')}>{prestaciones.map(pr => <section class="config-registro" aria-label={pr.nombre}>
          <input type="hidden" name="ids" value={pr.id} /><DatosPrestacion pr={pr} form={nuevo ? undefined : form} />
          <p class="ayuda">{pr.importe === 0 ? 'Sin cargo' : pesos(pr.importe)}</p>
        </section>)}<p class="ayuda">Un importe 0 es «Sin cargo» y no lleva comprobante. Los cambios no tocan los cobros ya hechos.</p>{prestaciones.length > 0 && <Guardar />}</form>
      </Tarjeta>
      <Ventana id="nueva-prestacion" titulo="Agregar prestación"><form class="columna" method="post" action="/configuracion/prestaciones/nueva">{nuevo && error && <Aviso tipo="error">{error}</Aviso>}<DatosPrestacion form={nuevo ? form : undefined} /><div class="config-pie"><Boton cierra>Cancelar</Boton><Boton type="submit" variante="oscuro">Guardar prestación</Boton></div></form></Ventana>
      {nuevo && error && <span hidden data-config-abrir="nueva-prestacion" />}
    </>
  } else if (seccion === 'obras') {
    const obras = (await c.env.DB.prepare('SELECT o.*, (SELECT COUNT(*) FROM pacientes p WHERE p.obra_social_id = o.id) pacientes FROM obras_sociales o ORDER BY o.nombre COLLATE NOCASE').all<Obra>()).results
    const q = c.req.query('q')?.trim().slice(0, 120) ?? ''
    const lista = obras.filter(o => normalizar(o.nombre).includes(normalizar(q)))
    const Fila = ({ o }: { o: Obra }) => <li><span><strong>{o.nombre}</strong><br /><span class="ayuda">{o.pacientes} pacientes{!o.en_uso && ' · No se ofrece para pacientes nuevos'}</span></span><form method="post" action={`/configuracion/obras/${o.id}`}><input name="en_uso" type="hidden" value={o.en_uso ? '0' : '1'} /><input name="q" type="hidden" value={q} /><Boton type="submit" variante="texto">{o.en_uso ? 'Dejar de usar' : 'Usar'}</Boton></form></li>
    contenido = <Tarjeta titulo="Obras sociales con las que trabajás">
      <p class="ayuda">Con obra social cobrás solo el copago. Dejar de usarla no cambia a los pacientes que ya la tienen.</p>
      <form method="get" action={ruta('obras')} class="fila" role="search"><Campo etiqueta="Buscar obra social" nombre="q" tipo="search" valor={q} /><Boton type="submit">Buscar</Boton></form>
      <h3>Las que usás</h3><ul class="lista">{lista.filter(o => o.en_uso).map(o => <Fila o={o} />)}</ul>{!lista.some(o => o.en_uso) && <p class="suave">No hay obras sociales en uso{q ? ' para esa búsqueda' : ''}.</p>}
      <h3>Catálogo</h3><ul class="lista">{lista.filter(o => !o.en_uso).map(o => <Fila o={o} />)}</ul>{!lista.some(o => !o.en_uso) && <p class="suave">No hay otras obras sociales{q ? ' para esa búsqueda' : ' en el catálogo'}.</p>}
    </Tarjeta>
  } else {
    contenido = <Tarjeta titulo={SECCIONES.find(s => s[0] === seccion)![1]}><p>Próximamente</p></Tarjeta>
  }
  return c.html(<Pagina titulo="Configuración" seccion="configuracion" inst={leerInstalacion(c.env)} email={c.get('email')!} nombre={prof.nombre} avisos={avisos}>
    <div class="config-layout"><aside class="columna"><h1>Configuración</h1><nav class="config-menu" aria-label="Secciones de configuración">{SECCIONES.map(([id, titulo, sub]) => <a href={ruta(id)} aria-current={id === seccion ? 'page' : undefined}><strong>{titulo}</strong><span class="ayuda">{sub}</span></a>)}</nav></aside>
      <div class="columna config-contenido">{error && <Aviso tipo="error">{error}</Aviso>}{!error && c.req.query('guardado') === '1' && <Aviso tipo="ok">Guardaste los cambios.</Aviso>}{contenido}</div>
    </div>
  </Pagina>, error ? 400 : 200)
}

export const configuracion = new Hono<Env>()
configuracion.use('/configuracion/perfil', bodyLimit({ maxSize: 6 * 1024 * 1024, onError: c => c.text('La foto puede pesar hasta 5 MB.', 413) }))
configuracion.get('/configuracion', c => c.redirect(ruta('perfil')))
configuracion.get('/configuracion/foto', async c => {
  const prof = await c.env.DB.prepare('SELECT foto_clave FROM profesional WHERE id = 1').first<{ foto_clave: string | null }>()
  if (!prof?.foto_clave) return c.notFound()
  const foto = await c.env.ARCHIVOS.get(prof.foto_clave)
  if (!foto) return c.notFound()
  const tipo = foto.httpMetadata?.contentType
  if (!tipo || !['image/jpeg', 'image/png', 'image/webp'].includes(tipo)) return c.notFound()
  c.header('Content-Type', tipo)
  c.header('Cache-Control', 'private, no-store')
  c.header('X-Content-Type-Options', 'nosniff')
  return c.body(foto.body)
})
configuracion.get('/configuracion/:seccion', c => SECCIONES.some(s => s[0] === c.req.param('seccion')) ? pantalla(c, c.req.param('seccion')) : c.notFound())

// El lote de D1 garantiza que no queden horarios o prestaciones guardados a medias.
async function guardar(c: C, seccion: string, accion: (form: FormData) => Promise<void>, nuevo = false) {
  const form = await c.req.formData()
  try {
    await accion(form)
    return c.redirect(`${ruta(seccion)}?guardado=1`, 303)
  } catch (e) {
    if (e instanceof DatosInvalidos) return pantalla(c, seccion, e.message, form, nuevo)
    throw e
  }
}
configuracion.post('/configuracion/perfil', c => guardar(c, 'perfil', async form => {
  const nombre = texto(form, 'nombre', 120), especialidad = texto(form, 'especialidad', 120), matricula = texto(form, 'matricula', 60)
  const whatsapp = texto(form, 'whatsapp', 30), correo = texto(form, 'correo', 200)
  if (correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) throw new DatosInvalidos('Revisá el correo.')
  const archivo = form.get('foto')
  let clave: string | undefined
  if (archivo && typeof archivo !== 'string' && archivo.size) {
    const { bytes, tipo } = await leerFoto(archivo)
    clave = `perfil/${crypto.randomUUID()}`
    await c.env.ARCHIVOS.put(clave, bytes, { httpMetadata: { contentType: tipo } })
  }
  try {
    await c.env.DB.prepare(`UPDATE profesional SET nombre = ?, especialidad = ?, matricula = ?, whatsapp = ?, correo = ?, foto_clave = COALESCE(?, foto_clave), actualizado_en = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = 1`)
      .bind(nombre || null, especialidad || null, matricula || null, whatsapp || null, correo || null, clave ?? null).run()
  } catch (e) {
    if (clave) await c.env.ARCHIVOS.delete(clave)
    throw e
  }
}))
function datosConsultorio(form: FormData, prefijo: string) {
  const nombre = texto(form, `${prefijo}_nombre`, 80, true), modalidad = texto(form, `${prefijo}_modalidad`, 20, true)
  if (!['presencial', 'videollamada'].includes(modalidad)) throw new DatosInvalidos('Elegí Presencial o Videollamada.')
  const direccion = texto(form, `${prefijo}_direccion`, 200), como = texto(form, `${prefijo}_como_llegar`, 400)
  if (modalidad === 'presencial' && !direccion) throw new DatosInvalidos('Completá la dirección del consultorio presencial.')
  return { nombre, modalidad, direccion: modalidad === 'presencial' ? direccion : '', como: modalidad === 'presencial' ? como : '', horarios: leerHorarios(form, prefijo) }
}
async function idsExistentes(c: C, form: FormData, tabla: 'consultorios' | 'prestaciones') {
  const ids = form.getAll('ids').map(id => entero(id, 1, Number.MAX_SAFE_INTEGER))
  if (!ids.length || new Set(ids).size !== ids.length || ids.length > 200) throw new DatosInvalidos('Revisá la lista antes de guardar.')
  const existentes = (await c.env.DB.prepare(`SELECT id FROM ${tabla}`).all<{ id: number }>()).results
  if (ids.some(id => !existentes.some(r => r.id === id))) throw new DatosInvalidos('La lista cambió. Volvé a abrir la sección.')
  return ids
}
configuracion.post('/configuracion/consultorios', c => guardar(c, 'consultorios', async form => {
  const ids = await idsExistentes(c, form, 'consultorios')
  const sentencias: D1PreparedStatement[] = []
  for (const id of ids) {
    const d = datosConsultorio(form, `co_${id}`)
    sentencias.push(c.env.DB.prepare('UPDATE consultorios SET nombre = ?, modalidad = ?, direccion = ?, como_llegar = ?, activo = ? WHERE id = ?').bind(d.nombre, d.modalidad, d.direccion || null, d.como || null, form.get(`co_${id}_activo`) === '1' ? 1 : 0, id))
    sentencias.push(c.env.DB.prepare('DELETE FROM horarios WHERE consultorio_id = ?').bind(id))
    for (const h of d.horarios) sentencias.push(c.env.DB.prepare('INSERT INTO horarios (consultorio_id, dia, desde, hasta) VALUES (?, ?, ?, ?)').bind(id, h.dia, h.desde, h.hasta))
  }
  await c.env.DB.batch(sentencias)
}))
configuracion.post('/configuracion/consultorios/nuevo', c => guardar(c, 'consultorios', async form => {
  const d = datosConsultorio(form, 'nuevo')
  // El lote es una transacción: MAX(id) sigue siendo el consultorio recién creado.
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO consultorios (nombre, modalidad, direccion, como_llegar) VALUES (?, ?, ?, ?)').bind(d.nombre, d.modalidad, d.direccion || null, d.como || null),
    ...d.horarios.map(h => c.env.DB.prepare('INSERT INTO horarios (consultorio_id, dia, desde, hasta) VALUES ((SELECT MAX(id) FROM consultorios), ?, ?, ?)').bind(h.dia, h.desde, h.hasta)),
  ])
}, true))
function datosPrestacion(form: FormData, prefijo: string) {
  return [texto(form, `${prefijo}_nombre`, 80, true), entero(form.get(`${prefijo}_duracion`), 5, 480), centavos(texto(form, `${prefijo}_importe`, 30, true)), form.get(`${prefijo}_activa`) === '1' ? 1 : 0]
}
configuracion.post('/configuracion/prestaciones', c => guardar(c, 'prestaciones', async form => {
  const ids = await idsExistentes(c, form, 'prestaciones')
  const sentencias = ids.map(id => c.env.DB.prepare('UPDATE prestaciones SET nombre = ?, duracion_min = ?, importe = ?, activa = ? WHERE id = ?').bind(...datosPrestacion(form, `pr_${id}`), id))
  await c.env.DB.batch(sentencias)
}))
configuracion.post('/configuracion/prestaciones/nueva', c => guardar(c, 'prestaciones', async form => {
  await c.env.DB.prepare('INSERT INTO prestaciones (nombre, duracion_min, importe, activa) VALUES (?, ?, ?, ?)').bind(...datosPrestacion(form, 'nueva')).run()
}, true))
configuracion.post('/configuracion/obras/:id', async c => {
  const form = await c.req.formData()
  let id: number, uso: number
  try { id = entero(c.req.param('id'), 1, Number.MAX_SAFE_INTEGER); uso = entero(form.get('en_uso'), 0, 1) } catch { return pantalla(c, 'obras', 'Revisá la obra social.') }
  const r = await c.env.DB.prepare('UPDATE obras_sociales SET en_uso = ? WHERE id = ?').bind(uso, id).run()
  if (!r.meta.changes) return c.notFound()
  return c.redirect(`${ruta('obras')}?guardado=1&q=${encodeURIComponent(typeof form.get('q') === 'string' ? String(form.get('q')).slice(0, 120) : '')}`, 303)
})
