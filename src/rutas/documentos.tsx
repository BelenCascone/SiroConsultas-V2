// X3 · Documentos privados, medicación de MisRx, estudios y exportación clínica.
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { C, Env } from '../tipos'
import type { Child } from 'hono/jsx'
import { leerInstalacion } from '../lib/instalacion'
import { ahoraAR, ahoraISO } from '../lib/fechas'
import { firmar, verificar } from '../lib/firma'
import { leerPaciente, idNuevo, fechaValida, fechaTexto, datosDeConsulta, ANTECEDENTES, MEDICIONES, type Consulta, type PacienteConsulta } from '../lib/consultas'
import { ErrorDocumento, numero, texto, pdf, zip, sha256, bytesTexto, nombreSeguro, type EntradaZip } from '../lib/documentos'
import { Pagina } from '../ui/pagina'
import { Aviso, Boton, Campo, Pastilla, Tarjeta, Ventana } from '../ui/componentes'
import { PorCorreo } from './envios'

export const documentos = new Hono<Env>()
const TIPOS = { certificado: 'Certificado', pedido: 'Pedido de estudios', medicacion: 'Receta (MisRx)', estudio: 'Estudio' } as const
type Tipo = keyof typeof TIPOS
type Identidad = { id: number; paciente: number; consulta: number | null; tipo: Tipo }
type Documento = { id: number; paciente_id: number; consulta_id: number | null; tipo: string; datos: string; fecha: string; pdf_clave: string | null; pdf_sha256: string | null; anulado_en: string | null; anulado_motivo: string | null }
type Archivo = { tipo: string; id: number; paciente_id: number; consulta_id: number | null; nombre: string; clave: string; mime: string; tamano: number; sha256: string; creado_en: string; anulado_en: string | null; anulado_motivo: string | null }
const ficha = (id: number) => `/pacientes/${id}?tab=documentos`
const esTipo = (s: unknown): s is Tipo => typeof s === 'string' && Object.hasOwn(TIPOS, s)
async function pagina(c: C, titulo: string, hijos: Child, estado: 200 | 400 | 404 | 409 | 422 = 200) {
  const profesional = await c.env.DB.prepare('SELECT nombre FROM profesional WHERE id=1').first<{ nombre: string | null }>()
  return c.html(<Pagina titulo={titulo} seccion="pacientes" inst={leerInstalacion(c.env)} email={c.get('email')!} nombre={profesional?.nombre}>{hijos}</Pagina>, estado)
}
const seguro = (accion: (c: C) => Promise<Response>) => async (c: C) => {
  try { return await accion(c) } catch (e) {
    if (!(e instanceof ErrorDocumento)) throw e
    if (c.req.header('accept')?.includes('application/json')) return c.json({ error: e.message }, e.estado)
    return pagina(c, 'Revisá el documento', <><Aviso tipo="error">{e.message}</Aviso><p>Volvé a la pantalla anterior para corregir lo que ingresaste.</p><Boton href="/pacientes">Ver pacientes</Boton></>, e.estado)
  }
}
async function paciente(c: C, id: number, escribir = false) {
  const p = await leerPaciente(c.env.DB, id)
  if (!p) throw new ErrorDocumento('No encontramos esta ficha.', 404)
  if (escribir && p.baja_en) throw new ErrorDocumento('Paciente dado de baja: solo lectura.', 409)
  return p
}
async function auditar(c: C, evento: string, detalle: string) {
  await c.env.DB.prepare('INSERT INTO auditoria (evento, detalle, usuario) VALUES (?, ?, ?)').bind(evento, detalle, c.get('email')!).run()
}
async function fuente(c: C) {
  const r = await c.env.ASSETS?.fetch(new Request('https://assets.local/fuentes/documentos-dejavu-sans.ttf'))
  if (!r?.ok) throw new ErrorDocumento('No se pudo cargar la fuente del PDF. Probá de nuevo.', 409)
  return new Uint8Array(await r.arrayBuffer())
}
async function identidad(c: C, form: FormData): Promise<Identidad> {
  let i: Identidad
  try { i = JSON.parse(await verificar(texto(form, 'documento_contexto', 1000, true), c.env.SESION_SECRETO) ?? '') } catch { throw new ErrorDocumento('Volvé a abrir el formulario del documento.', 400) }
  if (!i || typeof i !== 'object' || !Number.isSafeInteger(i.id) || !Number.isSafeInteger(i.paciente) || i.id < 1 || i.paciente < 1 || !esTipo(i.tipo) || (i.consulta !== null && (!Number.isSafeInteger(i.consulta) || i.consulta < 1))) throw new ErrorDocumento('Revisá el documento.', 400)
  return i
}
function Resultado() {
  return <div class="columna" data-documento-resultado="" hidden><h3>Guardado en sus documentos</h3><div class="fila"><a class="boton borde" data-documento-ver="">Ver documento</a><a class="boton borde" data-documento-pdf="" download>Descargar PDF</a></div><h3>¿Se lo mandás?</h3><p class="ayuda">Por WhatsApp, descargá el archivo y adjuntalo. «Por correo» abre el documento para mandárselo con el archivo. Nada sale solo.</p><div class="fila"><a class="boton claro" data-documento-wa="" target="_blank" rel="noopener">Por WhatsApp</a><a class="boton claro" data-documento-correo="">Por correo</a><Boton cierra>Ahora no</Boton></div></div>
}
export async function HerramientasDocumentos({ c, pacienteId, consultaId, enConsulta = false }: { c: C; pacienteId: number; consultaId?: number; enConsulta?: boolean }) {
  if (!leerInstalacion(c.env).modulos.has('documentos')) return <></>
  const p = await paciente(c, pacienteId)
  if (p.baja_en) return consultaId ? <DocumentosDeConsulta c={c} consultaId={consultaId} /> : <></>
  return <div class="columna documentos-herramientas"><div class="fila">{(['certificado', 'pedido', 'medicacion'] as const).map(t => <Boton abre={`doc-${t}`} data-modulo="documentos">{TIPOS[t]}</Boton>)}</div><div data-documentos-hechos="" class="columna-chica">{consultaId && <DocumentosDeConsulta c={c} consultaId={consultaId} />}</div>
    {(['certificado', 'pedido', 'medicacion'] as const).map(async tipo => <Ventana id={`doc-${tipo}`} titulo={TIPOS[tipo]}>
      <p>{p.nombre} {p.apellido} · DNI {p.dni}</p><Formulario c={c} p={p} tipo={tipo} consultaId={consultaId} enConsulta={enConsulta} /><Resultado />
    </Ventana>)}
  </div>
}
export async function DocumentosDeConsulta({c,consultaId}: {c:C;consultaId:number}) {
  const ds=await c.env.DB.prepare('SELECT id,tipo,fecha,anulado_en FROM documentos WHERE consulta_id=? ORDER BY fecha DESC,id DESC').bind(consultaId).all<Pick<Documento,'id'|'tipo'|'fecha'|'anulado_en'>>()
  return <>{ds.results.map(d => <a data-modulo="documentos" href={`/documentos/${d.id}`} target="_blank" rel="noopener">{TIPOS[d.tipo as Tipo]} · {fechaTexto(d.fecha)}{d.anulado_en ? ' (anulado)' : ''}</a>)}</>
}
function Dato({tipo,nombre,etiqueta,multilinea,requerido,tipoEntrada='text',valor,ayuda}: {tipo:Tipo;nombre:string;etiqueta:string;multilinea?:boolean;requerido?:boolean;tipoEntrada?:string;valor?:string;ayuda?:string}) {
  const id = `doc-${tipo}-${nombre}`
  return <div class="campo"><label for={id}>{etiqueta}</label>{multilinea ? <textarea id={id} class="entrada" name={nombre} required={requerido} rows={4}>{valor}</textarea> : <input id={id} class="entrada" name={nombre} type={tipoEntrada} value={valor} required={requerido} min={tipoEntrada === 'number' ? '1' : undefined} />}{ayuda && <p class="ayuda">{ayuda}</p>}</div>
}
async function Formulario({ c, p, tipo, consultaId, enConsulta }: { c: C; p: PacienteConsulta; tipo: Tipo; consultaId?: number; enConsulta?: boolean }) {
  const i: Identidad = { id: idNuevo(), paciente: p.id, consulta: consultaId ?? null, tipo }
  return <form class="columna" method="post" action="/documentos/emitir" enctype="multipart/form-data" data-documento-form="" data-consulta-mutacion={enConsulta ? '' : undefined}>
    <input type="hidden" name="documento_contexto" value={await firmar(JSON.stringify(i), c.env.SESION_SECRETO)} />
    {tipo === 'certificado' && <><Dato tipo={tipo} etiqueta="Diagnóstico" nombre="diagnostico" multilinea requerido /><Dato tipo={tipo} etiqueta="Días de reposo" nombre="dias" tipoEntrada="number" requerido /><p class="ayuda">Se genera con tu nombre y matrícula, para imprimir y firmar a mano.</p></>}
    {tipo === 'pedido' && <><Dato tipo={tipo} etiqueta="Estudios o prácticas" nombre="estudios" multilinea requerido ayuda="Uno por renglón." /><Dato tipo={tipo} etiqueta="Diagnóstico presuntivo (opcional)" nombre="diagnostico" multilinea /></>}
    {tipo === 'medicacion' && <><Aviso>La receta digital se hace en MisRx.</Aviso><ol><li>Abrí MisRx en tu celular.</li><li>Cargá al paciente con su DNI: {p.dni}.</li><li>Hacé la receta y mandásela desde MisRx.</li></ol><h3>Anotá lo que le recetaste</h3><Dato tipo={tipo} etiqueta="Medicamento" nombre="medicamento" requerido /><Dato tipo={tipo} etiqueta="Indicaciones (opcional)" nombre="indicaciones" multilinea /><Dato tipo={tipo} etiqueta="Fecha" nombre="fecha" tipoEntrada="date" valor={ahoraAR().fecha} requerido /></>}
    {tipo === 'estudio' && <><Dato tipo={tipo} etiqueta="Nombre del estudio" nombre="nombre" requerido /><label for="doc-archivo">Archivo del estudio</label><input id="doc-archivo" class="entrada" type="file" name="archivo" accept="application/pdf,image/png,image/jpeg" required /><p class="ayuda">PDF, JPG o PNG, hasta 20 MB.</p></>}
    <div role="alert" class="aviso error" data-documento-error="" hidden /><div class="documentos-pie"><Boton cierra>Cancelar</Boton><Boton type="submit" variante="oscuro">{tipo === 'medicacion' ? 'Guardar en la ficha' : tipo === 'estudio' ? 'Guardar estudio' : `Generar ${tipo === 'certificado' ? 'certificado' : 'pedido'}`}</Boton></div>
  </form>
}
function enlaces(p: PacienteConsulta, titulo: string, url: string) {
  const mensaje = `Hola ${p.nombre}, te adjunto ${titulo.toLowerCase()}.`
  const numero = p.celular.replace(/\D/g, '')
  // «Por correo» (P5) lleva a la pantalla del documento, que lo manda con el archivo adjunto.
  return { whatsapp: `https://wa.me/${numero.length === 10 ? '549' + numero : numero}?text=${encodeURIComponent(mensaje)}`, correo: p.correo ? url : null }
}
async function respuesta(c: C, i: Identidad, p: PacienteConsulta) {
  const url = i.tipo === 'estudio' ? `/documentos/estudios/${i.id}` : `/documentos/${i.id}`
  const json = { id: i.id, titulo: TIPOS[i.tipo], url, pdf: i.tipo === 'medicacion' ? null : `${url}/archivo`, ...enlaces(p, TIPOS[i.tipo], url) }
  return c.req.header('accept')?.includes('application/json') ? c.json(json) : c.redirect(url, 303)
}
const CONDICION = `p.baja_en IS NULL AND (? IS NULL OR EXISTS (SELECT 1 FROM consultas c WHERE c.id = ? AND c.paciente_id = p.id AND c.estado <> 'descartada'))`
documentos.use('/documentos/emitir', bodyLimit({ maxSize: 21 * 1024 * 1024, onError: c => c.text('El estudio puede pesar hasta 20 MB.', 413) }))
documentos.post('/documentos/emitir', seguro(async c => {
  const form = await c.req.formData(), i = await identidad(c, form), p = await paciente(c, i.paciente, true)
  if (i.consulta !== null && !await c.env.DB.prepare("SELECT id FROM consultas WHERE id = ? AND paciente_id = ? AND estado <> 'descartada'").bind(i.consulta, p.id).first()) throw new ErrorDocumento('La consulta no corresponde a esta ficha o fue descartada.', 409)
  const tabla = i.tipo === 'estudio' ? 'archivos' : 'documentos'
  const existente = await c.env.DB.prepare(`SELECT paciente_id, consulta_id${i.tipo === 'estudio' ? '' : ', tipo'} FROM ${tabla} WHERE id = ?`).bind(i.id).first<{ paciente_id: number; consulta_id: number | null; tipo?: string }>()
  if (existente) {
    if (existente.paciente_id !== p.id || existente.consulta_id !== i.consulta || (i.tipo !== 'estudio' && existente.tipo !== i.tipo)) throw new ErrorDocumento('El documento no coincide con esta ficha.', 409)
    return respuesta(c, i, p)
  }
  let contenido: Uint8Array | null = null, mime = 'application/pdf', nombre = '', fecha = ahoraAR().fecha
  const profesional = await c.env.DB.prepare('SELECT nombre, matricula, especialidad FROM profesional WHERE id=1').first<{ nombre: string | null; matricula: string | null; especialidad: string | null }>()
  const datos: Record<string, unknown> = { paciente: p, profesional, emitido_en: ahoraISO(), emitido_por: c.get('email')! }
  if (i.tipo === 'certificado' || i.tipo === 'pedido') {
    if (!profesional?.nombre?.trim() || !profesional.matricula?.trim()) throw new ErrorDocumento('Completá tu nombre y matrícula en Configuración antes de emitir documentos.', 409)
    const diagnostico = texto(form, 'diagnostico', 4000, i.tipo === 'certificado')
    let cuerpo: string[]
    if (i.tipo === 'certificado') {
      const dias = numero(texto(form, 'dias', 4, true))
      if (dias > 9999) throw new ErrorDocumento('Revisá los días de reposo.')
      Object.assign(datos, { diagnostico, dias })
      cuerpo = [`Se deja constancia de que ${p.nombre} ${p.apellido}, DNI ${p.dni}, presenta:`, diagnostico, '', `Se indican ${dias} ${dias === 1 ? 'día' : 'días'} de reposo.`]
    } else {
      const estudios = texto(form, 'estudios', 8000, true).split(/\r?\n/).map(s => s.trim()).filter(Boolean)
      Object.assign(datos, { diagnostico, estudios })
      cuerpo = ['Se solicitan los siguientes estudios o prácticas:', ...estudios.map(s => `- ${s}`), ...(diagnostico ? ['', 'Diagnóstico presuntivo:', diagnostico] : [])]
    }
    contenido = pdf([TIPOS[i.tipo], '', `Fecha: ${fechaTexto(fecha)}`, `Paciente: ${p.nombre} ${p.apellido}`, `DNI: ${p.dni}`, '', ...cuerpo, '', `${profesional.nombre} · ${profesional.matricula}`, profesional.especialidad ?? '', '', 'Firma y sello: __________________________', 'Documento para imprimir y firmar a mano.'], await fuente(c))
  } else if (i.tipo === 'medicacion') {
    fecha = texto(form, 'fecha', 10, true)
    if (!fechaValida(fecha) || fecha > ahoraAR().fecha || fecha < '1900-01-01') throw new ErrorDocumento('Revisá la fecha de la receta.')
    Object.assign(datos, { medicamento: texto(form, 'medicamento', 1000, true), indicaciones: texto(form, 'indicaciones', 4000), origen: 'MisRx' })
  } else {
    nombre = texto(form, 'nombre', 200, true)
    const archivo = form.get('archivo')
    if (!archivo || typeof archivo === 'string' || !archivo.size || archivo.size > 20 * 1024 * 1024) throw new ErrorDocumento('Elegí un PDF, JPG o PNG de hasta 20 MB.')
    contenido = new Uint8Array(await archivo.arrayBuffer())
    const es = (...v: number[]) => v.every((b, j) => contenido![j] === b)
    const tipo = es(37,80,68,70,45) ? 'application/pdf' : es(137,80,78,71,13,10,26,10) ? 'image/png' : es(255,216,255) ? 'image/jpeg' : null
    if (!tipo || tipo !== archivo.type) throw new ErrorDocumento('El contenido no coincide con un PDF, JPG o PNG válido.')
    mime = tipo
  }
  const clave = contenido ? `documentos/${p.id}/${i.tipo}/${i.id}` : null, hash = contenido ? await sha256(contenido) : null
  let propio = false, persistido = false
  try {
    if (contenido && clave) {
      propio = !!await c.env.ARCHIVOS.put(clave, contenido, { onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: mime } })
      if (!propio) {
        if (await c.env.DB.prepare(`SELECT id FROM ${tabla} WHERE id=? AND paciente_id=?`).bind(i.id,p.id).first()) return respuesta(c,i,p)
        throw new ErrorDocumento('Este documento se está guardando. Esperá y volvé a intentarlo.', 409)
      }
    }
    const sql = i.tipo === 'estudio' ? c.env.DB.prepare(`INSERT INTO archivos (id,paciente_id,consulta_id,nombre,clave,mime,tamano,sha256) SELECT ?,p.id,?,?,?,?,?,? FROM pacientes p WHERE p.id=? AND ${CONDICION} ON CONFLICT(id) DO NOTHING`)
      .bind(i.id,i.consulta,nombre,clave,mime,contenido!.length,hash,p.id,i.consulta,i.consulta)
      : c.env.DB.prepare(`INSERT INTO documentos (id,paciente_id,consulta_id,tipo,datos,fecha,pdf_clave,pdf_sha256) SELECT ?,p.id,?,?,?,?,?,? FROM pacientes p WHERE p.id=? AND ${CONDICION} ON CONFLICT(id) DO NOTHING`)
      .bind(i.id,i.consulta,i.tipo,JSON.stringify(datos),fecha,clave,hash,p.id,i.consulta,i.consulta)
    const r = await sql.run()
    persistido = !!r.meta.changes
    if (!persistido) {
      // Dos pestañas pueden reenviar la misma anotación de MisRx al mismo tiempo.
      if (!contenido && await c.env.DB.prepare('SELECT id FROM documentos WHERE id=? AND paciente_id=? AND tipo=?').bind(i.id,p.id,i.tipo).first()) return respuesta(c,i,p)
      throw new ErrorDocumento('La ficha o la consulta pasó a solo lectura. No se emitió el documento.', 409)
    }
    await auditar(c, 'documento_creado', `${tabla}:${i.id} · paciente:${p.id}`)
  } finally { if (propio && !persistido && clave) await c.env.ARCHIVOS.delete(clave) }
  return respuesta(c, i, p)
}))

documentos.get('/documentos/nuevo', seguro(async c => {
  const p = await paciente(c, numero(c.req.query('paciente')), true), tipo = c.req.query('tipo') ?? 'certificado'
  if (!esTipo(tipo)) throw new ErrorDocumento('Elegí el tipo de documento.', 400)
  const consultaId = c.req.query('consulta') ? numero(c.req.query('consulta')) : undefined
  return pagina(c, TIPOS[tipo], <><Boton href={ficha(p.id)}>Volver a la ficha</Boton><Tarjeta titulo={`${TIPOS[tipo]} para ${p.nombre}`}><Formulario c={c} p={p} tipo={tipo} consultaId={consultaId} /><Resultado /></Tarjeta></>)
}))
async function archivoPrivado(c: C, clave: string, hash: string | null) {
  const obj = await c.env.ARCHIVOS.get(clave)
  if (!obj) throw new ErrorDocumento('No encontramos el archivo original.', 404)
  const bytes = new Uint8Array(await obj.arrayBuffer())
  if (!hash || await sha256(bytes) !== hash) throw new ErrorDocumento('La huella del archivo no coincide. No se entregó el archivo.', 409)
  return bytes
}
const descarga = (c: C, b: Uint8Array, nombre: string, mime: string) => {
  c.header('Content-Type', mime); c.header('Cache-Control','private, no-store'); c.header('X-Content-Type-Options','nosniff'); c.header('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(nombreSeguro(nombre))}`)
  return c.body(new Uint8Array(b).buffer)
}
for (const estudio of [false, true]) {
  const base = estudio ? '/documentos/estudios' : '/documentos'
  documentos.get(`${base}/:id{[0-9]+}/archivo`, seguro(async c => {
    const id = numero(c.req.param('id'))
    const r = estudio ? await c.env.DB.prepare('SELECT * FROM archivos WHERE id=?').bind(id).first<Archivo>() : await c.env.DB.prepare('SELECT * FROM documentos WHERE id=?').bind(id).first<Documento>()
    if (!r) return c.notFound()
    await paciente(c,r.paciente_id)
    const b = await archivoPrivado(c, estudio ? (r as Archivo).clave : (r as Documento).pdf_clave ?? '', estudio ? (r as Archivo).sha256 : (r as Documento).pdf_sha256)
    await auditar(c,'documento_descargado',`${estudio ? 'archivos' : 'documentos'}:${id}`)
    return descarga(c,b,`${r.anulado_en ? 'ANULADO_' : ''}${estudio ? (r as Archivo).nombre : `${r.tipo}_${id}.pdf`}`, estudio ? (['application/pdf','image/jpeg','image/png'].includes((r as Archivo).mime) ? (r as Archivo).mime : 'application/octet-stream') : 'application/pdf')
  }))
  documentos.post(`${base}/:id{[0-9]+}/anular`, seguro(async c => {
    const id = numero(c.req.param('id')), tabla = estudio ? 'archivos' : 'documentos', form = await c.req.formData(), motivo = texto(form,'motivo',200,true)
    const r = await c.env.DB.prepare(`SELECT paciente_id FROM ${tabla} WHERE id=?`).bind(id).first<{paciente_id:number}>()
    if (!r) return c.notFound()
    await paciente(c,r.paciente_id,true)
    const cambio = await c.env.DB.prepare(`UPDATE ${tabla} SET anulado_en=?, anulado_motivo=? WHERE id=? AND anulado_en IS NULL AND EXISTS(SELECT 1 FROM pacientes p WHERE p.id=${tabla}.paciente_id AND p.baja_en IS NULL)`).bind(ahoraISO(),motivo,id).run()
    if (!cambio.meta.changes) throw new ErrorDocumento('Ya está anulado o la ficha pasó a solo lectura.',409)
    await auditar(c,'documento_anulado',`${tabla}:${id}`)
    return c.redirect(ficha(r.paciente_id),303)
  }))
  documentos.get(`${base}/:id{[0-9]+}`, seguro(async c => {
    const id = numero(c.req.param('id'))
    const r = estudio ? await c.env.DB.prepare('SELECT * FROM archivos WHERE id=?').bind(id).first<Archivo>() : await c.env.DB.prepare('SELECT * FROM documentos WHERE id=?').bind(id).first<Documento>()
    if (!r) return c.notFound()
    const p = await paciente(c,r.paciente_id), datos = estudio ? {} : JSON.parse((r as Documento).datos), titulo = estudio ? (r as Archivo).nombre : TIPOS[r.tipo as Tipo]
    const historico = !estudio && datos.paciente ? datos.paciente as PacienteConsulta : p
    const e = enlaces(p,titulo,`${base}/${id}`), tieneArchivo = estudio || !!(r as Documento).pdf_clave
    return pagina(c,titulo,<><Boton href={ficha(p.id)}>Volver a la ficha</Boton><Tarjeta titulo={titulo}>
      {r.anulado_en && <Aviso tipo="error">Anulado el {fechaTexto(r.anulado_en)}: {r.anulado_motivo}</Aviso>}
      <p>{historico.nombre} {historico.apellido} · DNI {historico.dni}</p>{datos.dias && <p>{datos.dias} días de reposo</p>}{datos.profesional && <p>{datos.profesional.nombre} · {datos.profesional.matricula}</p>}<p class="documentos-texto">{datos.diagnostico ?? datos.medicamento ?? ''}</p><p class="documentos-texto">{Array.isArray(datos.estudios) ? datos.estudios.join('\n') : datos.indicaciones ?? ''}</p>
      <p>{r.consulta_id ? `De la consulta ${r.consulta_id}` : 'Desde la ficha'} · {fechaTexto(estudio ? (r as Archivo).creado_en : (r as Documento).fecha)}</p>
      {tieneArchivo && <Boton href={`${base}/${id}/archivo`} variante="borde">Descargar {estudio ? 'estudio' : 'PDF'}</Boton>}
      {!r.anulado_en && !p.baja_en && tieneArchivo && <><h3>¿Se lo mandás?</h3><div class="fila"><a class="boton claro" href={e.whatsapp} target="_blank" rel="noopener">Por WhatsApp</a><PorCorreo env={c.env} accion={`${base}/${id}/correo`} correo={p.correo} volver={`${base}/${id}`} /></div><p class="ayuda">Por WhatsApp, descargá el archivo y adjuntalo. Nada sale solo.</p></>}
      {!r.anulado_en && !p.baja_en && <details><summary class="boton texto">Anular con motivo</summary><form class="columna" method="post" action={`${base}/${id}/anular`}><Campo etiqueta="Motivo de anulación" nombre="motivo" requerido /><Boton type="submit" variante="peligro">Anular</Boton></form></details>}
    </Tarjeta></>)
  }))
}

// La pestaña pertenece al módulo; las otras pestañas siguen en sus rutas originales.
documentos.get('/pacientes/:id{[0-9]+}', async (c, next) => {
  if (c.req.query('tab') !== 'documentos') return next()
  if (!leerInstalacion(c.env).modulos.has('documentos')) return c.notFound()
  return seguro(async c => {
    const p = await paciente(c, numero(c.req.param('id'))), filtro = c.req.query('tipo') ?? 'todos'
    if (filtro !== 'todos' && !esTipo(filtro)) throw new ErrorDocumento('Revisá el filtro.',400)
    const [ds, as] = await Promise.all([
      c.env.DB.prepare('SELECT * FROM documentos WHERE paciente_id=? ORDER BY fecha DESC,id DESC').bind(p.id).all<Documento>(),
      c.env.DB.prepare('SELECT * FROM archivos WHERE paciente_id=? ORDER BY creado_en DESC,id DESC').bind(p.id).all<Archivo>(),
    ])
    const lista = [...ds.results.map(d => ({ ...d, titulo: TIPOS[d.tipo as Tipo], tipo: d.tipo, url: `/documentos/${d.id}`, cuando: d.fecha })), ...as.results.map(a => ({ ...a, titulo: a.nombre, tipo: 'estudio', url: `/documentos/estudios/${a.id}`, cuando: a.creado_en }))].filter(r => filtro === 'todos' || r.tipo === filtro).sort((a,b) => b.cuando.localeCompare(a.cuando) || b.id-a.id)
    const modulos = leerInstalacion(c.env).modulos
    return pagina(c,'Documentos',<>
      <a class="volver" href="/pacientes">← Pacientes</a>
      {p.baja_en && <Aviso>Paciente dado de baja: solo lectura.</Aviso>}
      <section class="tarjeta ficha-cabeza"><div class="columna-chica"><h1 class="titulo-ficha">{p.nombre} {p.apellido}</h1><p>DNI {p.dni} · {p.obra_social ?? p.cobertura} · {p.celular}</p></div><Boton href={`/pacientes/${p.id}/exportar`}>Exportar historia clínica</Boton></section>
      <nav class="fila" aria-label="Secciones de la ficha">{[['resumen','Resumen'],['historia','Historia clínica'],['turnos','Turnos'],['pagos','Pagos'],['documentos','Documentos']].filter(([id]) => (id !== 'turnos' || modulos.has('agenda')) && (id !== 'pagos' || modulos.has('cobros'))).map(([id,n]) => <Pastilla actual={id === 'documentos'} href={`/pacientes/${p.id}${id === 'resumen' ? '' : `?tab=${id}`}`}>{n}</Pastilla>)}</nav>
      {!p.baja_en && <Tarjeta titulo="Nuevo documento"><HerramientasDocumentos c={c} pacienteId={p.id} /><Boton abre="doc-estudio">Adjuntar estudio</Boton><Ventana id="doc-estudio" titulo="Adjuntar estudio"><Formulario c={c} p={p} tipo="estudio" /><Resultado /></Ventana></Tarjeta>}
      <Tarjeta titulo="Documentos de la ficha"><nav class="fila" aria-label="Filtrar documentos">{[['todos','Todos'], ...Object.entries(TIPOS)].map(([t,n]) => <Pastilla href={`${ficha(p.id)}&tipo=${t}`} actual={filtro===t}>{n}</Pastilla>)}</nav>
        {!lista.length && <p class="suave">Todavía no hay documentos en este filtro.</p>}
        <ul class="lista">{lista.map(r => <li class="apilado"><a href={r.url}>{r.anulado_en ? <del>{r.titulo}</del> : <strong>{r.titulo}</strong>}</a><span class="ayuda">{fechaTexto(r.cuando)} · {r.consulta_id ? <a href={`/consultas/${r.consulta_id}`}>Consulta</a> : 'Desde la ficha'}</span>{r.anulado_en ? <p>Anulado: {r.anulado_motivo}</p> : <a href={r.url}>Ver{r.tipo !== 'medicacion' ? ' y volver a mandar' : ' registro de MisRx'}</a>}</li>)}</ul>
      </Tarjeta>
    </>)
  })(c)
})

documentos.get('/pacientes/:id{[0-9]+}/exportar',seguro(async c => {
  const p = await paciente(c,numero(c.req.param('id')))
  return pagina(c,'Exportar historia clínica',<><Boton href={`/pacientes/${p.id}?tab=historia`}>Volver a la historia</Boton><Tarjeta titulo={`Historia clínica de ${p.nombre} ${p.apellido}`}>
    <p>El ZIP incluye la historia en PDF y JSON, las consultas con sus aclaraciones, los antecedentes, signos vitales y mediciones, los documentos emitidos y los estudios originales. Conserva también los registros anulados y descartados con sus motivos.</p>
    <p>El archivo LEEME incluye las huellas SHA-256 para comprobar los archivos.</p><Aviso>Contiene datos de salud. Guardalo en un lugar seguro y compartilo solo con quien corresponda. La descarga queda registrada.</Aviso>
    <form method="post" action={`/pacientes/${p.id}/exportar`}><Boton type="submit" variante="oscuro">Preparar ZIP</Boton></form>
  </Tarjeta></>)
}))

documentos.post('/pacientes/:id{[0-9]+}/exportar',seguro(async c => {
  const p = await paciente(c,numero(c.req.param('id')))
  // D1 ejecuta el lote en una transacción: todas las tablas corresponden a la misma foto.
  const tablas = ['consultas','antecedentes','mediciones','documentos','archivos','pacientes_cambios'] as const
  const resultados = await c.env.DB.batch<Record<string,unknown>>([
    c.env.DB.prepare('SELECT p.*,o.nombre obra_social FROM pacientes p LEFT JOIN obras_sociales o ON o.id=p.obra_social_id WHERE p.id=?').bind(p.id),
    ...tablas.map(t => c.env.DB.prepare(`SELECT * FROM ${t} WHERE paciente_id=? ORDER BY id`).bind(p.id)),
    c.env.DB.prepare('SELECT a.* FROM aclaraciones a JOIN consultas c ON c.id=a.consulta_id WHERE c.paciente_id=? ORDER BY a.id').bind(p.id),
  ])
  const leido = { paciente:resultados[0].results[0] as unknown as PacienteConsulta, consultas:resultados[1].results as unknown as Consulta[], antecedentes:resultados[2].results, mediciones:resultados[3].results, documentos:resultados[4].results as unknown as Documento[], archivos:resultados[5].results as unknown as Archivo[], pacientes_cambios:resultados[6].results, aclaraciones:resultados[7].results as unknown as {consulta_id:number;texto:string;creado_en:string}[] }
  const historia = {exportado_en:ahoraISO(),...leido}
  const consultas = {results:leido.consultas}, aclaraciones=leido.aclaraciones
  const pacienteFoto = historia.paciente
  const lineas = ['Historia clínica',`${pacienteFoto.nombre} ${pacienteFoto.apellido} · DNI ${pacienteFoto.dni}`,`Exportada el ${fechaTexto(historia.exportado_en)}`, '', 'Ficha actual',
    `Nacimiento: ${pacienteFoto.fecha_nacimiento ?? '-'}`,`Celular: ${pacienteFoto.celular}`,`Correo: ${pacienteFoto.correo ?? '-'}`,`Domicilio: ${pacienteFoto.domicilio ?? '-'}`,`Ocupación: ${pacienteFoto.ocupacion ?? '-'}`,`Cobertura: ${pacienteFoto.cobertura ?? '-'} · Afiliado: ${pacienteFoto.numero_afiliado ?? '-'}`,pacienteFoto.baja_en ? `Paciente dado de baja el ${fechaTexto(pacienteFoto.baja_en)}` : 'Paciente activo', '', 'Consultas (incluye borradores y descartadas)']
  const agregarClinicos = (clinicos: ReturnType<typeof datosDeConsulta>) => {
    for (const [k,n] of ANTECEDENTES) lineas.push(`${n}: ${clinicos.antecedentes[k] || '-'}`)
    for (const [k,n,u] of MEDICIONES) if (clinicos.signos[k]) lineas.push(`${n}: ${clinicos.signos[k]} ${u}`)
  }
  for (const q of consultas.results) {
    lineas.push('',`Consulta ${q.id} · ${fechaTexto(q.finalizada_en ?? q.creado_en)} · ${q.tipo === 'primera' ? 'Primera vez' : 'Control'} · ${q.estado}`, `Motivo: ${q.motivo ?? '-'}`, `Examen: ${q.examen ?? '-'}`, `Plan: ${q.plan ?? '-'}`, `Próximo control: ${q.proximo_control ?? '-'}`)
    if (q.descarte_motivo) lineas.push(`Motivo del descarte: ${q.descarte_motivo}`)
    agregarClinicos(datosDeConsulta(q))
    if (q.foto) {
      const f = JSON.parse(q.foto)
      if (f.paciente) lineas.push(`Al firmar: ${f.paciente.nombre} ${f.paciente.apellido}, DNI ${f.paciente.dni}; cobertura ${f.paciente.obra_social ?? f.paciente.cobertura ?? '-'}`)
      if (f.profesional) lineas.push(`Profesional: ${f.profesional.nombre ?? '-'} · ${f.profesional.matricula ?? '-'}`)
    }
    for (const a of aclaraciones.filter(a => a.consulta_id === q.id)) lineas.push(`Aclaración ${fechaTexto(a.creado_en)}: ${a.texto}`)
  }
  lineas.push('','Antecedentes: versiones de la ficha')
  for (const a of leido.antecedentes) {
    lineas.push(`Registrados el ${fechaTexto(String(a.registrado_en))}`)
    for (const [k,n] of ANTECEDENTES) lineas.push(`${n}: ${a[k] ?? '-'}`)
    lineas.push(`Grupo sanguíneo: ${a.grupo_sanguineo ?? '-'}`)
  }
  lineas.push('','Mediciones')
  for (const m of leido.mediciones) lineas.push(`${fechaTexto(String(m.fecha))} · ${MEDICIONES.find(t => t[0]===m.tipo)?.[1] ?? m.tipo}: ${m.valor} ${m.unidad ?? ''}${m.anulado_en ? ` · ANULADA: ${m.anulado_motivo}` : ''}`)
  lineas.push('','Documentos y medicación de MisRx')
  for (const d of leido.documentos) {
    const v = JSON.parse(d.datos)
    lineas.push('',`${TIPOS[d.tipo as Tipo]} ${d.id} · ${fechaTexto(d.fecha)} · ${d.consulta_id ? `Consulta ${d.consulta_id}` : 'Desde la ficha'}`)
    if (d.anulado_en) lineas.push(`ANULADO el ${fechaTexto(d.anulado_en)}: ${d.anulado_motivo}`)
    if (v.diagnostico) lineas.push(`Diagnóstico: ${v.diagnostico}`)
    if (v.dias) lineas.push(`Reposo: ${v.dias} días`)
    if (v.estudios) lineas.push('Estudios solicitados:',...v.estudios)
    if (v.medicamento) lineas.push(`Medicamento (MisRx): ${v.medicamento}`,`Indicaciones: ${v.indicaciones || '-'}`)
    if (v.profesional) lineas.push(`Profesional: ${v.profesional.nombre ?? '-'} · ${v.profesional.matricula ?? '-'}`)
  }
  lineas.push('','Estudios e imágenes originales')
  for (const a of leido.archivos) lineas.push(`${a.id} · ${a.nombre} · ${fechaTexto(a.creado_en)}${a.anulado_en ? ` · ANULADO: ${a.anulado_motivo}` : ''}`)
  lineas.push('','Historial de cambios de la ficha')
  for (const cambio of leido.pacientes_cambios) lineas.push(`${fechaTexto(String(cambio.en))} · ${String(cambio.campo).replaceAll('_',' ')}: ${cambio.antes ?? '-'} → ${cambio.despues ?? '-'}`)
  lineas.push('','El archivo historia.json conserva la totalidad de los datos y de las fotos al firmar. Los PDFs y estudios originales se incluyen por separado; las huellas están en LEEME.txt.')
  const historiaPdf = pdf(lineas,await fuente(c))
  const entradas: EntradaZip[] = [ {nombre:'historia.pdf',cargar:async()=>historiaPdf}, {nombre:'historia.json',cargar:async()=>bytesTexto(JSON.stringify(historia,null,2))} ]
  for (const d of leido.documentos) {
    if (d.tipo === 'medicacion') continue
    if (!d.pdf_clave || !d.pdf_sha256) throw new ErrorDocumento('Falta el PDF original de un documento. No se generó una exportación incompleta.',409)
    entradas.push({nombre:`documentos/${d.id}_${d.anulado_en ? 'ANULADO_' : ''}${nombreSeguro(d.tipo)}.pdf`,cargar:()=>archivoPrivado(c,d.pdf_clave!,d.pdf_sha256)})
  }
  for (const a of leido.archivos) {
    const extension = ({'application/pdf':'.pdf','image/jpeg':'.jpg','image/png':'.png'} as Record<string,string>)[a.mime] ?? '.bin'
    entradas.push({nombre:`estudios/${a.id}_${a.anulado_en ? 'ANULADO_' : ''}${nombreSeguro(a.nombre)}${extension}`,cargar:()=>archivoPrivado(c,a.clave,a.sha256)})
  }
  await auditar(c,'historia_exportacion_iniciada',`paciente:${p.id}`)
  c.header('Content-Type','application/zip'); c.header('Content-Disposition',`attachment; filename="historia_${p.id}.zip"`); c.header('Cache-Control','private, no-store'); c.header('X-Content-Type-Options','nosniff')
  return c.body(zip(entradas,()=>auditar(c,'historia_exportada',`paciente:${p.id} · archivos:${entradas.length+1}`)))
}))
