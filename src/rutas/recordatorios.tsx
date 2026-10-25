// P5 · Configuración → Recordatorios (maqueta `Configuracion`, sección «Recordatorios») y el recordatorio por WhatsApp con un toque.
import { Hono } from 'hono'
import type { C, Env } from '../tipos'
import { leerInstalacion } from '../lib/instalacion'
import { ahoraAR, ahoraISO, sumarDias } from '../lib/fechas'
import { SIN_CORREO, modoCorreo } from '../lib/correo'
import { MAX_MENSAJE, MENSAJE_ORIGINAL, diaRecordatorio, lugar, revisarMensaje, textoRecordatorio } from '../lib/recordatorios'
import { SECCIONES } from './configuracion'
import { Pagina } from '../ui/pagina'
import { Aviso, Boton, Interruptor, Tarjeta } from '../ui/componentes'

export const recordatorios = new Hono<Env>()
const RUTA = '/configuracion/recordatorios'
type Perfil = { nombre: string | null; recordatorio_mensaje: string | null; recordatorio_correo_activo: number }

async function pantalla(c: C, opciones: { mensaje?: string; correo?: boolean; error?: string; aviso?: string } = {}) {
  const [prof, consultorio, avisos] = await Promise.all([
    c.env.DB.prepare('SELECT nombre, recordatorio_mensaje, recordatorio_correo_activo FROM profesional WHERE id = 1').first<Perfil>(),
    c.env.DB.prepare("SELECT nombre, modalidad, direccion FROM consultorios WHERE activo = 1 ORDER BY modalidad = 'videollamada', orden, id LIMIT 1")
      .first<{ nombre: string; modalidad: string; direccion: string | null }>(),
    c.env.DB.prepare('SELECT COUNT(*) n FROM notificaciones WHERE leida_en IS NULL').first<{ n: number }>(),
  ])
  const inst = leerInstalacion(c.env)
  const mensaje = opciones.mensaje ?? (prof?.recordatorio_mensaje || MENSAJE_ORIGINAL)
  const correo = opciones.correo ?? !!prof?.recordatorio_correo_activo
  // La vista previa usa un paciente de ejemplo y el primer consultorio: nunca datos de un paciente real.
  const ejemplo = { nombre: 'Diego', fecha: sumarDias(ahoraAR().fecha, 1), hora: '17:00', modalidad: consultorio?.modalidad ?? 'presencial', consultorio: consultorio?.nombre ?? 'Centro', direccion: consultorio?.direccion ?? null, enlace_video: null }
  const modo = modoCorreo(c.env)
  return c.html(<Pagina titulo="Configuración" seccion="configuracion" inst={inst} email={c.get('email')!} nombre={prof?.nombre} avisos={avisos?.n ?? 0}>
    <div class="config-layout">
      <aside class="columna"><h1>Configuración</h1>
        <nav class="config-menu" aria-label="Secciones de configuración">{SECCIONES.filter(([id]) => (id !== 'cobros' || inst.modulos.has('cobros')) && (id !== 'recordatorios' || inst.modulos.has('agenda'))).map(([id, titulo, sub]) => (
          <a href={`/configuracion/${id}`} aria-current={id === 'recordatorios' ? 'page' : undefined} data-modulo={id === 'cobros' ? 'cobros' : id === 'recordatorios' ? 'agenda' : undefined}><strong>{titulo}</strong><span class="ayuda">{sub}</span></a>
        ))}</nav>
      </aside>
      <div class="columna config-contenido">
        {opciones.error && <Aviso tipo="error">{opciones.error}</Aviso>}
        {!opciones.error && opciones.aviso && <Aviso>{opciones.aviso}</Aviso>}
        {!opciones.error && !opciones.aviso && c.req.query('guardado') === '1' && <Aviso tipo="ok">Guardaste los cambios.</Aviso>}
        <Tarjeta titulo="Recordatorio de turno">
          <form class="columna" method="post" action={RUTA}>
            <p class="suave">Lo que le llega al paciente para confirmar. Solo lleva nombre, día, hora y lugar: nunca el motivo ni datos clínicos.</p>
            <div class="campo">
              <label for="r-mensaje">Mensaje</label>
              <textarea id="r-mensaje" class="entrada" name="mensaje" rows={5} maxLength={MAX_MENSAJE} required aria-describedby="r-ayuda" data-recordatorio="r-previa">{mensaje}</textarea>
              <span class="ayuda" id="r-ayuda">Podés usar: {'{nombre}'} · {'{dia}'} · {'{hora}'} · {'{lugar}'}</span>
            </div>
            <div class="fila"><Boton type="submit" variante="texto" name="accion" value="original">Volver al mensaje original</Boton></div>
            <div class="columna-chica">
              <span class="chico suave">Así lo ve {ejemplo.nombre} ({ejemplo.modalidad === 'videollamada' ? 'videollamada' : 'presencial'})</span>
              <pre class="mensaje-previa" id="r-previa" aria-live="polite" data-nombre={ejemplo.nombre} data-dia={diaRecordatorio(ejemplo.fecha)} data-hora={ejemplo.hora} data-lugar={lugar(ejemplo)}>{textoRecordatorio(mensaje, ejemplo)}</pre>
            </div>
            <Interruptor etiqueta="Mandar el recordatorio por correo, solo" nombre="correo_activo" marcado={correo}
              ayuda={`${48} horas antes del turno, a los pacientes que dejaron su correo y no pidieron dejar de recibirlos.`} />
            {!modo && <Aviso tipo="ambar">{SIN_CORREO} Hasta entonces, mandá los recordatorios por WhatsApp desde la agenda.</Aviso>}
            {modo === 'demo' && <p class="ayuda">En la demo no sale ningún correo de verdad.</p>}
            <p class="ayuda">Por WhatsApp lo mandás vos con un toque, desde el turno en la agenda.</p>
            <div class="config-pie"><Boton type="submit" variante="oscuro">Guardar cambios</Boton></div>
          </form>
        </Tarjeta>
      </div>
    </div>
  </Pagina>, opciones.error ? 422 : 200)
}

recordatorios.get(RUTA, (c) => pantalla(c))
recordatorios.post(RUTA, async (c) => {
  const f = await c.req.parseBody()
  const mensaje = (typeof f.mensaje === 'string' ? f.mensaje : '').replace(/\r\n/g, '\n')
  const correo = f.correo_activo === '1'
  if (f.accion === 'original') return pantalla(c, { mensaje: MENSAJE_ORIGINAL, correo, aviso: 'Volviste al mensaje original. Guardá los cambios para usarlo.' })
  const error = revisarMensaje(mensaje)
  if (error) return pantalla(c, { mensaje, correo, error })
  const guardado = mensaje.trim() === MENSAJE_ORIGINAL ? null : mensaje.trim()
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE profesional SET recordatorio_mensaje = ?, recordatorio_correo_activo = ?, actualizado_en = ? WHERE id = 1').bind(guardado, correo ? 1 : 0, ahoraISO()),
    c.env.DB.prepare("INSERT INTO auditoria (evento, usuario) VALUES ('recordatorios_guardados', ?)").bind(c.get('email')!),
  ])
  return c.redirect(`${RUTA}?guardado=1`, 303)
})

// Recordatorio por WhatsApp desde el turno: el enlace abre WhatsApp y app.js avisa acá para dejarlo anotado.
recordatorios.post('/turnos/:id{[0-9]+}/recordatorio', async (c) => {
  const id = Number(c.req.param('id'))
  const r = await c.env.DB.prepare(
    `UPDATE turnos SET recordatorio_whatsapp_en = ? WHERE id = ? AND estado = 'confirmado'
       AND (SELECT recordatorios_baja FROM pacientes WHERE id = turnos.paciente_id) = 0`).bind(ahoraISO(), id).run()
  if (!r.meta.changes) return c.notFound()
  await c.env.DB.prepare("INSERT INTO envios (que, objeto_id, paciente_id, canal) SELECT 'recordatorio', id, paciente_id, 'whatsapp' FROM turnos WHERE id = ?").bind(id).run()
  return c.body(null, 204)
})
