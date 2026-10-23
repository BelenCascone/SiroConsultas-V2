// X2 · Consulta e historia clínica. P2 entra por /consultas/nueva?turno=<id>.
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { Child } from 'hono/jsx'
import type { C, Env } from '../tipos'
import { leerInstalacion } from '../lib/instalacion'
import { ahoraAR, ahoraISO, sumarDias } from '../lib/fechas'
import {
  ErrorConsulta, ANTECEDENTES, MEDICIONES, ACTIVO, numero, texto, fechaValida, fichaIncompleta, leerPaciente, leerConsulta,
  datosDeConsulta, contextoFirmado, leerContexto, idNuevo, guardarBorrador, finalizarConsulta,
  pacienteActivo, validarMedicion, huella, fechaTexto, controlEnMeses, type PacienteConsulta, type Consulta, type ContextoConsulta,
} from '../lib/consultas'
import { Pagina } from '../ui/pagina'
import { Aviso, Boton, Campo, Estado, Pastilla, Tarjeta, Ventana, pesos } from '../ui/componentes'

export const consultas = new Hono<Env>()
const aFicha = (id: number) => `/pacientes/${id}?tab=historia`
const rutaNueva = (p: number, t: number | null) => `/consultas/nueva?${t ? `turno=${t}` : `paciente=${p}`}`
async function pagina(c: C, titulo: string, children: Child, estado: 200 | 400 | 404 | 409 | 422 = 200) {
  const prof = await c.env.DB.prepare('SELECT nombre FROM profesional WHERE id = 1').first<{ nombre: string | null }>()
  return c.html(<Pagina titulo={titulo} seccion="pacientes" inst={leerInstalacion(c.env)} email={c.get('email')!} nombre={prof?.nombre}>{children}</Pagina>, estado)
}
const seguro = (accion: (c: C) => Promise<Response>) => async (c: C) => {
  try { return await accion(c) } catch (e) {
    if (!(e instanceof ErrorConsulta)) throw e
    if (c.req.header('accept')?.includes('application/json')) return c.json({ error: e.message }, e.estado)
    return pagina(c, 'Revisá la consulta', <><Aviso tipo="error">{e.message}</Aviso><p>Si estabas escribiendo, volvé a la pantalla anterior para conservar lo que ingresaste.</p><div class="fila"><Boton href="/">Volver a Hoy</Boton><Boton href="/pacientes">Ver pacientes</Boton></div></>, e.estado)
  }
}
async function auditar(c: C, evento: string, id: number) {
  await c.env.DB.prepare('INSERT INTO auditoria (evento, detalle, usuario) VALUES (?, ?, ?)').bind(evento, `consulta:${id}`, c.get('email')!).run()
}
async function actual(c: C, form: FormData) {
  const contexto = await leerContexto(form, c.env.SESION_SECRETO)
  const consulta = await leerConsulta(c.env.DB, contexto.id)
  if (!consulta || consulta.paciente_id !== contexto.paciente || consulta.turno_id !== contexto.turno) throw new ErrorConsulta('No encontramos esta consulta.', 404)
  await pacienteActivo(c.env.DB, contexto.paciente, false)
  return { contexto, consulta, version: numero(form.get('version'), true) }
}
function Identidad({ contexto, firma, version }: { contexto: ContextoConsulta; firma: string; version: number }) {
  return <><input type="hidden" name="contexto" value={firma} /><input type="hidden" name="version" value={version} data-consulta-version={contexto.id} /></>
}
function Selector({ nombre, etiqueta, valor, opciones }: { nombre: string; etiqueta: string; valor?: string; opciones: { id: string | number; nombre: string }[] }) {
  return <div class="campo"><label for={`consulta-${nombre}`}>{etiqueta}</label><select id={`consulta-${nombre}`} name={nombre} class="entrada">{opciones.map(o => <option value={o.id} selected={String(o.id) === valor}>{o.nombre}</option>)}</select></div>
}
function CamposAntecedentes({ valores }: { valores: Record<string, string> }) {
  return <><div class="consulta-campos">{ANTECEDENTES.map(([k, nombre]) => <div class="columna-chica">
    <Campo etiqueta={nombre} nombre={k} valor={valores[k]} /><button type="button" class="boton texto" data-consulta-ninguno={k}>Ninguno<span class="oculto-visual"> en {nombre.toLowerCase()}</span></button>
  </div>)}</div><p class="ayuda">Al firmar se agrega una versión a la ficha. Las versiones anteriores se conservan.</p></>
}
function Cabecera({ p, sub, accion }: { p: PacienteConsulta; sub: string; accion?: Child }) {
  return <section class="tarjeta consulta-cabecera"><a href="/" class="boton texto" data-consulta-salir="">← Volver a Hoy</a><div class="columna-chica"><h1>{p.nombre} {p.apellido}</h1><p class="suave">DNI {p.dni} · {p.obra_social ?? (p.cobertura === 'particular' ? 'Particular' : 'Sin cobertura cargada')}</p><p class="chico">{sub}</p></div>{accion}</section>
}
async function fichaPendiente(c: C, p: PacienteConsulta, turno: number | null) {
  const obras = (await c.env.DB.prepare('SELECT id, nombre FROM obras_sociales WHERE en_uso = 1 OR id = ? ORDER BY nombre').bind(p.obra_social_id ?? -1).all<{ id: number; nombre: string }>()).results
  return pagina(c, 'Completar ficha', <><Cabecera p={p} sub="Todavía sin empezar" /><Tarjeta titulo={`Completá la ficha de ${p.nombre}`}>
    <p>Paso 1 de 2 · Antes de empezar la consulta</p><p class="suave">Ya tiene los datos del alta rápida. Falta completar lo siguiente.</p>
    <form method="post" action="/consultas/completar-ficha" class="columna">
      <input type="hidden" name="paciente" value={p.id} /><input type="hidden" name="turno" value={turno ?? ''} />
      <div class="consulta-campos"><Campo etiqueta="Nacimiento" nombre="fecha_nacimiento" tipo="date" valor={p.fecha_nacimiento ?? ''} requerido />
        <Selector etiqueta="Cobertura" nombre="cobertura" valor={p.obra_social_id ? `os:${p.obra_social_id}` : p.cobertura ?? ''} opciones={[{ id: '', nombre: 'Elegí la cobertura' }, { id: 'particular', nombre: 'Particular' }, ...obras.map(o => ({ id: `os:${o.id}`, nombre: o.nombre }))]} />
        <Campo etiqueta="N.º de afiliado" nombre="numero_afiliado" valor={p.numero_afiliado ?? ''} />
        <Campo etiqueta="Domicilio" nombre="domicilio" valor={p.domicilio ?? ''} requerido /><Campo etiqueta="Ocupación" nombre="ocupacion" valor={p.ocupacion ?? ''} requerido />
      </div><div class="consulta-pie"><Boton type="submit" variante="oscuro">Guardar y empezar la consulta</Boton></div>
    </form>
  </Tarjeta></>)
}
async function editor(c: C, p: PacienteConsulta, consulta: Consulta | null, contexto: ContextoConsulta) {
  const atencion = contexto.turno ? await c.env.DB.prepare('SELECT atencion FROM turnos WHERE id = ?').bind(contexto.turno).first<{ atencion: string | null }>() : null
  const tipo = consulta?.tipo ?? (['primera', 'control'].includes(atencion?.atencion ?? '') ? atencion!.atencion : null) ?? (await c.env.DB.prepare("SELECT id FROM consultas WHERE paciente_id = ? AND estado = 'finalizada' LIMIT 1").bind(p.id).first() ? 'control' : 'primera')
  const datos = datosDeConsulta(consulta)
  if (!consulta) {
    const ant = await c.env.DB.prepare('SELECT personales, alergias, medicacion, familiares FROM antecedentes WHERE paciente_id = ? ORDER BY id DESC LIMIT 1').bind(p.id).first<Record<string, string | null>>()
    for (const [k] of ANTECEDENTES) datos.antecedentes[k] = ant?.[k] ?? ''
  }
  const anterior = await c.env.DB.prepare("SELECT id, motivo, plan, finalizada_en FROM consultas WHERE paciente_id = ? AND estado = 'finalizada' ORDER BY finalizada_en DESC, id DESC LIMIT 1").bind(p.id).first<{ id: number; motivo: string; plan: string; finalizada_en: string }>()
  const consultorios = (await c.env.DB.prepare('SELECT id, nombre FROM consultorios WHERE activo = 1 OR id = ? ORDER BY orden, nombre').bind(consulta?.consultorio_id ?? -1).all<{ id: number; nombre: string }>()).results
  const archivos = consulta ? (await c.env.DB.prepare('SELECT id, nombre, sha256 FROM archivos WHERE consulta_id = ? AND anulado_en IS NULL ORDER BY id').bind(consulta.id).all<{ id: number; nombre: string; sha256: string }>()).results : []
  const firma = await contextoFirmado(contexto, c.env.SESION_SECRETO), version = consulta?.version ?? 0
  const identidad = { contexto, firma, version }
  const hoy = ahoraAR().fecha, proximo = consulta ? consulta.proximo_control ?? '' : tipo === 'primera' ? sumarDias(hoy, 14) : controlEnMeses(hoy, 1)
  return pagina(c, tipo === 'primera' ? 'Primera consulta' : 'Control', <div class="columna" data-consulta-editor="" data-consulta-id={contexto.id} data-consulta-historia={aFicha(p.id)}>
    <Cabecera p={p} sub={tipo === 'primera' ? 'Primera consulta' : 'Control'} accion={<button type="button" class="boton destacado" data-consulta-terminar="">Terminar consulta</button>} />
    <p role="status" data-consulta-estado="" class="aviso">{consulta ? `Borrador guardado · versión ${version}` : 'Todavía sin guardar: el borrador nace con el primer cambio.'}</p>
    <div role="alert" data-consulta-error="" class="aviso error" hidden />
    <div class="consulta-layout"><form id="consulta-formulario" method="post" action="/consultas/guardar" class="columna" data-consulta-formulario="">
      <Identidad {...identidad} />
      {!contexto.turno && <Selector etiqueta="Consultorio" nombre="consultorio_id" valor={String(consulta?.consultorio_id ?? '')} opciones={[{ id: '', nombre: 'Sin consultorio' }, ...consultorios]} />}
      <Tarjeta titulo={tipo === 'primera' ? '1 · ¿Por qué consulta?' : '1 · ¿Cómo sigue desde la última vez?'}>
        <Campo etiqueta={tipo === 'primera' ? 'Motivo de consulta y anamnesis' : 'Evolución'} nombre="motivo" multilinea valor={consulta?.motivo ?? ''} />
      </Tarjeta>
      {tipo === 'primera' ? <Tarjeta titulo="2 · Antecedentes"><CamposAntecedentes valores={datos.antecedentes} /></Tarjeta>
        : <details class="tarjeta"><summary class="boton texto">Antecedentes de su ficha</summary><CamposAntecedentes valores={datos.antecedentes} /></details>}
      <Tarjeta titulo={tipo === 'primera' ? '3 · Examen' : '2 · Examen'}>
        <details><summary class="boton texto">Signos vitales (opcionales)</summary><div class="consulta-signos">{MEDICIONES.map(([tipo, nombre, unidad]) => <Campo etiqueta={`${nombre} (${unidad})`} nombre={`signo_${tipo}`} valor={datos.signos[tipo] ?? ''} />)}</div></details>
        <Campo etiqueta="Examen" nombre="examen" multilinea valor={consulta?.examen ?? ''} />
      </Tarjeta>
      <Tarjeta titulo={tipo === 'primera' ? '4 · Plan e indicaciones' : '3 · Plan e indicaciones'}>
        {tipo === 'control' && anterior && <><button class="boton claro" type="button" data-consulta-copiar="">Copiar las de la vez anterior</button><textarea hidden data-consulta-plan-anterior="">{anterior.plan}</textarea></>}
        <Campo etiqueta="Plan e indicaciones" nombre="plan" multilinea valor={consulta?.plan ?? ''} />
        <div class="fila" aria-label="Sugerir próximo control">{[[sumarDias(hoy, 14), '2 semanas'], [controlEnMeses(hoy, 1), '1 mes'], [controlEnMeses(hoy, 3), '3 meses'], ['', 'Sin control']].map(([fecha, etiqueta]) => <button class="pastilla" type="button" data-consulta-control={fecha}>{etiqueta}</button>)}</div>
        <Campo etiqueta="Próximo control" nombre="proximo_control" tipo="date" valor={proximo} ayuda="Es una fecha sugerida; el turno se agenda después." />
      </Tarjeta>
      <div class="consulta-pie"><Boton type="submit">Guardar borrador</Boton></div>
    </form><aside class="columna">
      <Tarjeta titulo="Para hacer en la consulta"><Boton abre="consulta-estudio">Adjuntar estudio</Boton><p class="ayuda">Certificado, pedido y receta: próximamente.</p>
        <ul class="lista">{archivos.map(a => <li class="apilado"><a href={`/consultas/archivos/${a.id}`}>{a.nombre}</a><span class="ayuda">Huella SHA-256 guardada</span></li>)}</ul>
      </Tarjeta>
      {anterior && <Tarjeta titulo={`La vez anterior · ${fechaTexto(anterior.finalizada_en)}`}><p><strong>Evolución:</strong> {anterior.motivo}</p><p><strong>Indicaciones:</strong> {anterior.plan}</p><a href={`/consultas/${anterior.id}`}>Ver consulta anterior</a></Tarjeta>}
      <Tarjeta titulo="De su ficha"><dl class="datos"><dt>DNI</dt><dd>{p.dni}</dd><dt>Celular</dt><dd>{p.celular}</dd><dt>Ocupación</dt><dd>{p.ocupacion}</dd><dt>Alergias</dt><dd>{datos.antecedentes.alergias || 'Sin completar'}</dd></dl><a href={aFicha(p.id)} data-consulta-salir="">Ver toda la historia</a></Tarjeta>
      <details><summary class="boton texto">Descartar borrador</summary><form method="post" action="/consultas/descartar" data-consulta-mutacion="" class="columna"><Identidad {...identidad} /><Campo etiqueta="Motivo del descarte" nombre="descarte_motivo" requerido /><Boton type="submit" variante="peligro">Descartar con motivo</Boton></form></details>
    </aside></div>
    <Ventana id="consulta-terminar" titulo="¿Terminás la consulta?">
      <p>Queda firmada con la fecha de hoy y ya no se edita. Si hace falta corregir algo, le agregás una aclaración.</p><p>Completá el motivo y el plan antes de firmar.</p>
      <form method="post" action="/consultas/finalizar" data-consulta-mutacion="" class="columna"><Identidad {...identidad} /><Boton type="submit" variante="oscuro">Sí, terminar y firmar</Boton><Boton cierra>Seguir escribiendo</Boton></form>
    </Ventana>
    <Ventana id="consulta-estudio" titulo="Adjuntar estudio"><form method="post" action="/consultas/estudio" enctype="multipart/form-data" data-consulta-mutacion="" class="columna">
      <Identidad {...identidad} /><Campo etiqueta="Nombre del estudio" nombre="nombre" requerido /><label class="campo">Archivo del estudio<input type="file" name="archivo" accept="application/pdf,image/jpeg,image/png" class="entrada" required /></label>
      <p class="ayuda">PDF, JPG o PNG, hasta 20 MB. Primero se guarda el borrador; el archivo queda privado, con su huella.</p><Boton type="submit" variante="oscuro">Guardar estudio</Boton>
    </form></Ventana>
  </div>)
}

// Esta ruta se registra antes de Pacientes y solo atiende la pestaña Historia.
// Las otras pestañas siguen en P1; no se modifica su archivo.
consultas.get('/pacientes/:id{[0-9]+}', async (c, next) => {
  if (c.req.query('tab') !== 'historia') return next()
  return seguro(async c => {
    const p = await leerPaciente(c.env.DB, numero(c.req.param('id')))
    if (!p) return c.notFound()
    const [lista, mediciones, saldo] = await Promise.all([
      c.env.DB.prepare(`SELECT c.*, co.nombre lugar FROM consultas c LEFT JOIN consultorios co ON co.id = c.consultorio_id WHERE c.paciente_id = ? ORDER BY c.creado_en DESC, c.id DESC`).bind(p.id).all<Consulta & { lugar: string | null }>(),
      c.env.DB.prepare('SELECT id, tipo, valor, unidad, fecha FROM mediciones WHERE paciente_id = ? AND anulado_en IS NULL ORDER BY fecha DESC, id DESC').bind(p.id).all<{ id: number; tipo: string; valor: string; unidad: string; fecha: string }>(),
      c.env.DB.prepare('SELECT COALESCE(SUM(saldo), 0) saldo FROM v_cobros WHERE paciente_id = ?').bind(p.id).first<{ saldo: number }>(),
    ])
    const documentos = (await c.env.DB.prepare('SELECT consulta_id, tipo, anulado_en FROM documentos WHERE paciente_id = ?').bind(p.id).all<{ consulta_id: number; tipo: string; anulado_en: string | null }>()).results
    const modulos = leerInstalacion(c.env).modulos
    const tipos: Record<string, string> = { certificado: 'Certificado', pedido: 'Pedido de estudios', medicacion: 'Medicación' }
    return pagina(c, 'Historia clínica', <>
      <a class="volver" href="/pacientes">← Pacientes</a>
      {p.baja_en && <Aviso>Paciente dado de baja: la historia es de solo lectura.</Aviso>}
      <section class="tarjeta ficha-cabeza"><div class="columna-chica"><h1 class="titulo-ficha">{p.nombre} {p.apellido}</h1><p>DNI {p.dni} · {p.obra_social ?? p.cobertura} · {p.celular}</p></div>
        {!p.baja_en && <div class="fila">
          {modulos.has('cobros') && (saldo?.saldo ?? 0) > 0 && <a class="boton claro" data-modulo="cobros" href={`/cobros/nuevo?paciente=${p.id}`}>Cobrar {pesos(saldo!.saldo)}</a>}
          {modulos.has('agenda') && <a class="boton destacado" data-modulo="agenda" href={`/turnos/nuevo?paciente=${p.id}`}>Darle turno</a>}
          <Boton href={`/pacientes/${p.id}/editar`}>Editar datos</Boton>
        </div>}
      </section>
      <nav class="fila" aria-label="Secciones de la ficha">{[['resumen', 'Resumen'], ['historia', 'Historia clínica'], ['turnos', 'Turnos'], ['pagos', 'Pagos'], ['documentos', 'Documentos']].filter(([id]) => (id !== 'pagos' || modulos.has('cobros')) && (id !== 'turnos' || modulos.has('agenda')) && (id !== 'documentos' || modulos.has('documentos'))).map(([id, nombre]) => <Pastilla href={`/pacientes/${p.id}${id === 'resumen' ? '' : `?tab=${id}`}`} actual={id === 'historia'}>{nombre}</Pastilla>)}</nav>
      <div class="consulta-historia"><Tarjeta titulo="Consultas" accion={!p.baja_en ? <Boton href={rutaNueva(p.id, null)}>Empezar consulta sin turno</Boton> : undefined}>
        <p class="ayuda">Exportar historia clínica: próximamente.</p>
        {!lista.results.length && <p class="suave">Todavía no tiene consultas.</p>}
        <ul class="lista">{lista.results.map(x => <li class="apilado">
          <a href={`/consultas/${x.id}`}><strong>{fechaTexto(x.finalizada_en ?? x.creado_en)} · {x.tipo === 'primera' ? 'Primera consulta' : 'Control'}</strong></a>
          <span class="fila"><Estado estado={x.estado === 'borrador' ? 'debe' : x.estado === 'descartada' ? 'gris' : 'atendido'} texto={x.estado === 'borrador' ? 'Borrador' : x.estado === 'descartada' ? 'Descartada' : 'Finalizada'} />{x.lugar && <span class="suave chico">{x.lugar}</span>}</span>
          <p class="consulta-texto">{x.estado === 'descartada' ? x.descarte_motivo : (x.plan ?? x.motivo ?? '').slice(0, 240)}</p>
          {documentos.some(d => d.consulta_id === x.id) && <p class="ayuda">En esta consulta: {documentos.filter(d => d.consulta_id === x.id).map(d => `${tipos[d.tipo] ?? d.tipo}${d.anulado_en ? ' (anulado)' : ''}`).join(' · ')}</p>}
        </li>)}</ul>
      </Tarjeta><div class="columna"><Tarjeta titulo="Mediciones">
        {!mediciones.results.length && <p class="suave">Sin mediciones.</p>}
        <ul class="lista">{mediciones.results.map(m => <li class="apilado"><strong>{MEDICIONES.find(t => t[0] === m.tipo)?.[1] ?? m.tipo}: {m.valor} {m.unidad}</strong><span class="ayuda">{fechaTexto(m.fecha)}</span></li>)}</ul>
      </Tarjeta>{!p.baja_en && <Tarjeta titulo="Registrar medición"><form class="columna" method="post" action="/consultas/medicion">
        <input type="hidden" name="paciente" value={p.id} /><input type="hidden" name="operacion" value={await contextoFirmado({ id: idNuevo(), paciente: p.id, turno: null }, c.env.SESION_SECRETO)} />
        <Selector etiqueta="Medición" nombre="tipo" opciones={MEDICIONES.map(([id, nombre, unidad]) => ({ id, nombre: `${nombre} (${unidad})` }))} /><Campo etiqueta="Valor" nombre="valor" requerido /><Campo etiqueta="Fecha de la medición" nombre="fecha" tipo="date" valor={ahoraAR().fecha} requerido /><Boton type="submit" variante="oscuro">Guardar medición</Boton>
      </form></Tarjeta>}</div></div>
    </>)
  })(c)
})

consultas.get('/consultas/nueva', seguro(async c => {
  let turno: { id: number; paciente_id: number; estado: string } | null = null
  if (c.req.query('turno')) {
    turno = await c.env.DB.prepare('SELECT id, paciente_id, estado FROM turnos WHERE id = ?').bind(numero(c.req.query('turno'))).first()
    if (!turno) return c.notFound()
  }
  const id = turno?.paciente_id ?? numero(c.req.query('paciente'))
  const p = await pacienteActivo(c.env.DB, id, false)
  const existente = turno ? await c.env.DB.prepare('SELECT id FROM consultas WHERE turno_id = ?').bind(turno.id).first<{ id: number }>()
    : await c.env.DB.prepare("SELECT id FROM consultas WHERE paciente_id = ? AND turno_id IS NULL AND estado = 'borrador' ORDER BY creado_en DESC LIMIT 1").bind(id).first<{ id: number }>()
  if (existente) return c.redirect(`/consultas/${existente.id}`)
  if (turno && !['confirmado', 'atendido'].includes(turno.estado)) throw new ErrorConsulta('Solo podés atender un turno confirmado; este turno ya está cerrado.', 409)
  if (fichaIncompleta(p)) return fichaPendiente(c, p, turno?.id ?? null)
  if (turno?.estado === 'confirmado') return pagina(c, 'Atender', <><Cabecera p={p} sub="Turno confirmado" /><Tarjeta titulo="¿Empezás a atender?">
    <p>El turno queda atendido y no se puede deshacer. El borrador se crea recién cuando guardás lo que escribiste.</p><form method="post" action="/consultas/atender"><input type="hidden" name="turno" value={turno.id} /><Boton type="submit" variante="oscuro">Sí, atender y empezar</Boton></form>
  </Tarjeta></>)
  return editor(c, p, null, { id: idNuevo(), paciente: id, turno: turno?.id ?? null })
}))
consultas.post('/consultas/atender', seguro(async c => {
  const form = await c.req.formData(), id = numero(form.get('turno'))
  const turno = await c.env.DB.prepare('SELECT paciente_id, estado FROM turnos WHERE id = ?').bind(id).first<{ paciente_id: number; estado: string }>()
  if (!turno) return c.notFound()
  await pacienteActivo(c.env.DB, turno.paciente_id)
  if (turno.estado === 'confirmado') await c.env.DB.prepare(`UPDATE turnos SET estado = 'atendido', cerrado_en = ?, actualizado_en = ? WHERE id = ? AND estado = 'confirmado' AND EXISTS (SELECT 1 FROM pacientes p WHERE p.id = turnos.paciente_id AND p.baja_en IS NULL)`).bind(ahoraISO(), ahoraISO(), id).run()
  else if (turno.estado !== 'atendido') throw new ErrorConsulta('El turno ya está cerrado.', 409)
  return c.redirect(rutaNueva(turno.paciente_id, id), 303)
}))
consultas.post('/consultas/completar-ficha', seguro(async c => {
  const form = await c.req.formData(), id = numero(form.get('paciente')), turnoId = texto(form, 'turno', 16)
  const p = await pacienteActivo(c.env.DB, id, false)
  const nacimiento = texto(form, 'fecha_nacimiento', 10, true), domicilio = texto(form, 'domicilio', 200, true), ocupacion = texto(form, 'ocupacion', 120, true), cobertura = texto(form, 'cobertura', 30, true), afiliado = texto(form, 'numero_afiliado', 60)
  if (!fechaValida(nacimiento) || nacimiento > ahoraAR().fecha || nacimiento < '1900-01-01') throw new ErrorConsulta('Revisá la fecha de nacimiento.')
  let os: number | null = null
  if (cobertura !== 'particular') {
    if (!/^os:\d+$/.test(cobertura)) throw new ErrorConsulta('Elegí la cobertura.')
    os = numero(cobertura.slice(3))
    if (!await c.env.DB.prepare('SELECT id FROM obras_sociales WHERE id = ? AND (en_uso = 1 OR id = ?)').bind(os, p.obra_social_id ?? -1).first()) throw new ErrorConsulta('Elegí una obra social en uso.')
  }
  if (turnoId && !await c.env.DB.prepare('SELECT id FROM turnos WHERE id = ? AND paciente_id = ?').bind(numero(turnoId), id).first()) throw new ErrorConsulta('El turno no pertenece a esta ficha.', 409)
  await c.env.DB.prepare('UPDATE pacientes SET fecha_nacimiento = ?, domicilio = ?, ocupacion = ?, cobertura = ?, obra_social_id = ?, numero_afiliado = ?, actualizado_en = ? WHERE id = ? AND baja_en IS NULL')
    .bind(nacimiento, domicilio, ocupacion, os ? 'obra_social' : 'particular', os, os ? afiliado || null : null, ahoraISO(), id).run()
  return c.redirect(rutaNueva(id, turnoId ? numero(turnoId) : null), 303)
}))
consultas.post('/consultas/guardar', seguro(async c => {
  const form = await c.req.formData(), contexto = await leerContexto(form, c.env.SESION_SECRETO), version = numero(form.get('version'), true)
  const resultado = await guardarBorrador(c.env.DB, contexto, version, form)
  if (version === 0) await auditar(c, 'consulta_borrador_creado', contexto.id)
  return c.req.header('accept')?.includes('application/json') ? c.json({ ...resultado, url: `/consultas/${resultado.id}` }) : c.redirect(`/consultas/${resultado.id}`, 303)
}))
consultas.post('/consultas/finalizar', seguro(async c => {
  const form = await c.req.formData(), { consulta, version } = await actual(c, form)
  await finalizarConsulta(c.env.DB, consulta, version, c.get('email')!)
  await auditar(c, 'consulta_finalizada', consulta.id)
  return c.redirect(`/consultas/${consulta.id}?terminada=1`, 303)
}))
consultas.post('/consultas/descartar', seguro(async c => {
  const form = await c.req.formData(), { consulta, version } = await actual(c, form), motivo = texto(form, 'descarte_motivo', 200, true)
  const r = await c.env.DB.prepare(`UPDATE consultas SET estado = 'descartada', descarte_motivo = ?, descartada_en = ?, version = version + 1, actualizado_en = ? WHERE id = ? AND estado = 'borrador' AND version = ? AND ${ACTIVO}`)
    .bind(motivo, ahoraISO(), ahoraISO(), consulta.id, version).run()
  if (!r.meta.changes) throw new ErrorConsulta('La consulta cambió o ya está cerrada.', 409)
  await auditar(c, 'consulta_descartada', consulta.id)
  return c.redirect(aFicha(consulta.paciente_id), 303)
}))
consultas.post('/consultas/aclarar', seguro(async c => {
  const form = await c.req.formData(), { consulta } = await actual(c, form), aclaracion = texto(form, 'aclaracion', 4000, true)
  const r = await c.env.DB.prepare(`INSERT INTO aclaraciones (consulta_id, texto) SELECT id, ? FROM consultas WHERE id = ? AND estado = 'finalizada' AND ${ACTIVO}`).bind(aclaracion, consulta.id).run()
  if (!r.meta.changes) throw new ErrorConsulta('Solo podés aclarar una consulta finalizada.', 409)
  await auditar(c, 'consulta_aclarada', consulta.id)
  return c.redirect(`/consultas/${consulta.id}`, 303)
}))
consultas.post('/consultas/medicion', seguro(async c => {
  const form = await c.req.formData()
  const contextoForm = new FormData(); contextoForm.set('contexto', texto(form, 'operacion', 1000, true))
  const contexto = await leerContexto(contextoForm, c.env.SESION_SECRETO)
  const paciente = numero(form.get('paciente')), tipo = texto(form, 'tipo', 30, true), valor = texto(form, 'valor', 40, true), fecha = texto(form, 'fecha', 10, true)
  if (paciente !== contexto.paciente) throw new ErrorConsulta('La medición no coincide con esta ficha.', 400)
  await pacienteActivo(c.env.DB, paciente, false)
  validarMedicion(tipo, valor)
  if (!fechaValida(fecha) || fecha > ahoraAR().fecha || fecha < '1900-01-01') throw new ErrorConsulta('Revisá la fecha de la medición.')
  const guardada = await c.env.DB.prepare('INSERT INTO mediciones (id, paciente_id, tipo, valor, unidad, fecha) SELECT ?, id, ?, ?, ?, ? FROM pacientes WHERE id = ? AND baja_en IS NULL ON CONFLICT(id) DO NOTHING')
    .bind(contexto.id, tipo, valor, MEDICIONES.find(m => m[0] === tipo)![2], fecha, paciente).run()
  if (!guardada.meta.changes && !await c.env.DB.prepare('SELECT id FROM mediciones WHERE id = ? AND paciente_id = ?').bind(contexto.id, paciente).first()) throw new ErrorConsulta('El paciente pasó a solo lectura; no se guardó la medición.', 409)
  if (guardada.meta.changes) await c.env.DB.prepare('INSERT INTO auditoria (evento, detalle, usuario) VALUES (?, ?, ?)').bind('medicion_registrada', `medicion:${contexto.id}`, c.get('email')!).run()
  return c.redirect(aFicha(paciente), 303)
}))

consultas.use('/consultas/estudio', bodyLimit({ maxSize: 21 * 1024 * 1024, onError: c => c.text('El estudio puede pesar hasta 20 MB.', 413) }))
consultas.post('/consultas/estudio', seguro(async c => {
  const form = await c.req.formData(), { consulta, version } = await actual(c, form)
  if (consulta.estado !== 'borrador') throw new ErrorConsulta('El estudio se adjunta durante la consulta, antes de firmarla.', 409)
  const nombre = texto(form, 'nombre', 200, true).replace(/[\r\n\x00-\x1f/\\]/g, '_')
  const archivo = form.get('archivo')
  if (!archivo || typeof archivo === 'string' || !archivo.size || archivo.size > 20 * 1024 * 1024) throw new ErrorConsulta('Elegí un estudio PDF, JPG o PNG de hasta 20 MB.')
  const bytes = await archivo.arrayBuffer(), firma = new Uint8Array(bytes)
  const empieza = (...v: number[]) => v.every((b, i) => firma[i] === b)
  const mime = empieza(37,80,68,70,45) ? 'application/pdf' : empieza(137,80,78,71,13,10,26,10) ? 'image/png' : empieza(255,216,255) ? 'image/jpeg' : null
  if (!mime || mime !== archivo.type) throw new ErrorConsulta('El contenido no coincide con un PDF, JPG o PNG válido.')
  const hash = await huella(bytes), clave = `estudios/${consulta.paciente_id}/${crypto.randomUUID()}`
  await c.env.ARCHIVOS.put(clave, bytes, { httpMetadata: { contentType: mime } })
  let creado = false
  try {
    const r = await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO archivos (paciente_id, consulta_id, nombre, clave, mime, tamano, sha256)
        SELECT paciente_id, id, ?, ?, ?, ?, ? FROM consultas WHERE id = ? AND estado = 'borrador' AND version = ? AND ${ACTIVO}`)
        .bind(nombre, clave, mime, archivo.size, hash, consulta.id, version),
      c.env.DB.prepare(`UPDATE consultas SET version = version + 1, actualizado_en = ? WHERE id = ? AND estado = 'borrador' AND version = ? AND EXISTS (SELECT 1 FROM archivos a WHERE a.consulta_id = consultas.id AND a.clave = ?)`)
        .bind(ahoraISO(), consulta.id, version, clave),
    ])
    creado = !!r[0].meta.changes
    if (!creado) throw new ErrorConsulta('La consulta cambió en otra pestaña. El archivo no se adjuntó; revisá la versión guardada.', 409)
  } finally { if (!creado) await c.env.ARCHIVOS.delete(clave) }
  await auditar(c, 'consulta_estudio_adjuntado', consulta.id)
  return c.redirect(`/consultas/${consulta.id}`, 303)
}))
consultas.get('/consultas/archivos/:id{[0-9]+}', seguro(async c => {
  const archivo = await c.env.DB.prepare('SELECT * FROM archivos WHERE id = ? AND anulado_en IS NULL').bind(numero(c.req.param('id'))).first<{ id: number; clave: string; mime: string; nombre: string; sha256: string; consulta_id: number }>()
  if (!archivo) return c.notFound()
  const objeto = await c.env.ARCHIVOS.get(archivo.clave)
  if (!objeto) return c.notFound()
  const bytes = await objeto.arrayBuffer()
  if (await huella(bytes) !== archivo.sha256) throw new ErrorConsulta('La huella del archivo no coincide con la registrada. No se descargó el estudio.', 409)
  c.header('Content-Type', ['application/pdf', 'image/png', 'image/jpeg'].includes(archivo.mime) ? archivo.mime : 'application/octet-stream')
  c.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(archivo.nombre)}`)
  c.header('Cache-Control', 'private, no-store')
  c.header('X-Content-Type-Options', 'nosniff')
  await auditar(c, 'consulta_estudio_descargado', archivo.consulta_id)
  return c.body(bytes)
}))
consultas.get('/consultas/:id{[0-9]+}', seguro(async c => {
  const consulta = await leerConsulta(c.env.DB, numero(c.req.param('id')))
  if (!consulta) return c.notFound()
  const p = await leerPaciente(c.env.DB, consulta.paciente_id)
  if (!p) return c.notFound()
  if (consulta.estado === 'borrador' && !p.baja_en) {
    if (fichaIncompleta(p)) return fichaPendiente(c, p, consulta.turno_id)
    return editor(c, p, consulta, { id: consulta.id, paciente: p.id, turno: consulta.turno_id })
  }
  let foto: { paciente?: Partial<PacienteConsulta>; antecedentes?: Record<string, string>; signos?: Record<string, string>; firmada_por?: string; profesional?: { nombre?: string; matricula?: string } } = {}
  try { foto = JSON.parse(consulta.foto ?? '{}') } catch { /* Consultas previas sin foto estructurada: se conserva el texto original. */ }
  const historico = { ...p, ...foto.paciente }
  const datos = datosDeConsulta(consulta)
  const [aclaraciones, archivos, mediciones] = await Promise.all([
    c.env.DB.prepare('SELECT texto, creado_en FROM aclaraciones WHERE consulta_id = ? ORDER BY id').bind(consulta.id).all<{ texto: string; creado_en: string }>(),
    c.env.DB.prepare('SELECT id, nombre, sha256 FROM archivos WHERE consulta_id = ? AND anulado_en IS NULL ORDER BY id').bind(consulta.id).all<{ id: number; nombre: string; sha256: string }>(),
    c.env.DB.prepare('SELECT tipo, valor, unidad FROM mediciones WHERE consulta_id = ? AND anulado_en IS NULL ORDER BY id').bind(consulta.id).all<{ tipo: string; valor: string; unidad: string }>(),
  ])
  const contexto = { id: consulta.id, paciente: p.id, turno: consulta.turno_id }, firma = await contextoFirmado(contexto, c.env.SESION_SECRETO)
  return pagina(c, consulta.estado === 'finalizada' ? 'Consulta finalizada' : 'Consulta de solo lectura', <>
    <Cabecera p={historico} sub={`${consulta.tipo === 'primera' ? 'Primera consulta' : 'Control'} · ${consulta.estado} · ${fechaTexto(consulta.finalizada_en ?? consulta.creado_en)}`} />
    {p.baja_en && <Aviso>Paciente dado de baja: solo lectura.</Aviso>}
    {consulta.estado === 'descartada' && <Aviso>Borrador descartado: {consulta.descarte_motivo}</Aviso>}
    {c.req.query('terminada') === '1' && consulta.estado === 'finalizada' && <Tarjeta titulo="Consulta terminada">
      <p>Quedó guardada en la historia de {historico.nombre}. ¿Qué sigue?</p>
      <div class="fila">{!p.baja_en && leerInstalacion(c.env).modulos.has('cobros') && <Boton href={`/cobros/nuevo?paciente=${p.id}&consulta=${consulta.id}`} data-modulo="cobros">Cobrar la consulta</Boton>}
        {!p.baja_en && consulta.proximo_control && leerInstalacion(c.env).modulos.has('agenda') && <Boton href={`/turnos/nuevo?paciente=${p.id}&fecha=${consulta.proximo_control}`} data-modulo="agenda">Darle el turno del control</Boton>}
        <Boton href="/">Volver a Hoy</Boton></div><p class="ayuda">Próximo control: {fechaTexto(consulta.proximo_control)}. El turno se agenda aparte.</p>
    </Tarjeta>}
    <div class="consulta-layout"><div class="columna"><Tarjeta titulo="Registro de la consulta">
      {consulta.estado === 'finalizada' && <p class="ayuda">Firmada el {consulta.finalizada_en} por {foto.profesional?.nombre ?? foto.firmada_por ?? 'la profesional'}{foto.profesional?.matricula ? ` · ${foto.profesional.matricula}` : ''}. Los datos corresponden al momento de la firma.</p>}
      <h3>{consulta.tipo === 'primera' ? 'Motivo y anamnesis' : 'Evolución'}</h3><p class="consulta-texto">{consulta.motivo || 'Sin completar'}</p>
      <h3>Antecedentes</h3><dl class="datos">{ANTECEDENTES.map(([k, nombre]) => <><dt>{nombre}</dt><dd class="consulta-texto">{(foto.antecedentes?.[k] ?? datos.antecedentes[k]) || 'Sin completar'}</dd></>)}</dl>
      <h3>Examen</h3><p class="consulta-texto">{consulta.examen || 'Sin completar'}</p><h3>Plan e indicaciones</h3><p class="consulta-texto">{consulta.plan || 'Sin completar'}</p>
      <p>Próximo control: {fechaTexto(consulta.proximo_control)}</p>
      <a href={aFicha(p.id)}>Ver toda la historia clínica</a>
    </Tarjeta><Tarjeta titulo="Aclaraciones">
      {!aclaraciones.results.length && <p class="suave">Sin aclaraciones.</p>}
      <ul class="lista">{aclaraciones.results.map(a => <li class="apilado"><span class="ayuda">{a.creado_en}</span><p class="consulta-texto">{a.texto}</p></li>)}</ul>
      {consulta.estado === 'finalizada' && !p.baja_en && <form method="post" action="/consultas/aclarar" class="columna"><Identidad contexto={contexto} firma={firma} version={consulta.version} /><Campo etiqueta="Aclaración" nombre="aclaracion" multilinea requerido /><Boton type="submit" variante="oscuro">Agregar aclaración</Boton></form>}
    </Tarjeta></div><aside class="columna"><Tarjeta titulo="Mediciones"><ul class="lista">{mediciones.results.map(m => <li>{MEDICIONES.find(t => t[0] === m.tipo)?.[1] ?? m.tipo}: {m.valor} {m.unidad}</li>)}</ul>
      {consulta.estado === 'borrador' && <dl class="datos">{Object.entries(datos.signos).map(([k, v]) => <><dt>{MEDICIONES.find(t => t[0] === k)?.[1] ?? k}</dt><dd>{v}</dd></>)}</dl>}
    </Tarjeta><Tarjeta titulo="Estudios adjuntos"><ul class="lista">{archivos.results.map(a => <li class="apilado"><a href={`/consultas/archivos/${a.id}`}>{a.nombre}</a><span class="ayuda consulta-huella">SHA-256: {a.sha256}</span></li>)}</ul></Tarjeta></aside></div>
  </>)
}))
