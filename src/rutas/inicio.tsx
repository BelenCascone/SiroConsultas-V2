// Hoy: saludo, buscador y acciones; lo que hay que resolver; «Ahora» con el turno que sigue (Atender y No vino), la lista del día
// y los controles por agendar. Maqueta: docs/pantallas/Main.dc.html · docs/DISENO_APROBADO.md, sección 2.
// «Plata de hoy»: cobrado hoy y lo que te deben (P4).
// En el celular (P6, docs/pantallas/HoyCel.dc.html): «Llegó» en vez de Atender, porque las notas clínicas se escriben en la compu.
import { Hono } from 'hono'
import type { C, Env } from '../tipos'
import { leerInstalacion } from '../lib/instalacion'
import { ahoraAR, fechaLarga, saludo } from '../lib/fechas'
import { aMinutos } from '../lib/turnos'
import { CLAVE_ESTADO, estadoMostrado } from '../lib/agenda'
import { controlesPorAgendar, cuandoControl, elegirAhora, paraResolver, turnosDeHoy, type TurnoHoy } from '../lib/hoy'
import { Pagina } from '../ui/pagina'
import { Boton, Estado, Tarjeta, pesos } from '../ui/componentes'
import { Lupa, Mas } from '../ui/iconos'
import { plataDeHoy } from '../lib/cobros'

export async function datosProfesional(c: C) {
  return (await c.env.DB.prepare('SELECT nombre FROM profesional WHERE id = 1').first<{ nombre: string | null }>()) ?? { nombre: null }
}
export async function avisosSinLeer(c: C) {
  return (await c.env.DB.prepare('SELECT COUNT(*) n FROM notificaciones WHERE leida_en IS NULL').first<{ n: number }>())?.n ?? 0
}

export const inicio = new Hono<Env>()

const detalleTurno = (t: TurnoHoy) =>
  [t.primera ? 'Primera consulta' : t.prestacion, t.hora, t.cobertura === 'obra_social' ? t.obra_social : null, t.modalidad === 'videollamada' ? 'videollamada' : null].filter(Boolean).join(' · ')

inicio.get('/', async (c) => {
  const inst = leerInstalacion(c.env)
  const email = c.get('email')!
  const db = c.env.DB
  const { fecha, hora, horaNum } = ahoraAR()
  const ahoraMin = aMinutos(hora)
  const conCobros = inst.modulos.has('cobros')
  const [prof, avisos, lista, pendientes, controles, plata] = await Promise.all([
    datosProfesional(c), avisosSinLeer(c), turnosDeHoy(db, fecha), paraResolver(db, fecha, ahoraMin), controlesPorAgendar(db, fecha),
    conCobros ? plataDeHoy(db, fecha) : null,
  ])
  const primerNombre = (prof.nombre ?? '').trim().split(/\s+/)[0]
  const ahora = elegirAhora(lista, ahoraMin)
  const t = ahora?.turno
  const ausenteId = Number(/^\d{1,9}$/.test(c.req.query('ausente') ?? '') ? c.req.query('ausente') : 0)
  const ausente = ausenteId ? lista.find((x) => x.id === ausenteId && x.estado === 'ausente') : null
  const llegoId = Number(/^\d{1,9}$/.test(c.req.query('llego') ?? '') ? c.req.query('llego') : 0)
  const llego = llegoId ? lista.find((x) => x.id === llegoId && x.estado === 'atendido') : null
  const verControles = controles.slice(0, 5)

  return c.html(
    <Pagina titulo="Hoy" seccion="hoy" inst={inst} email={email} nombre={prof.nombre} avisos={avisos}>
      <section class="portada">
        <div class="columna">
          <span class="portada-sub">{fechaLarga(fecha)}</span>
          <h1>{saludo(horaNum)}{primerNombre ? `, ${primerNombre}` : ''}</h1>
        </div>
        <form class="buscador" method="get" action="/pacientes" role="search">
          <Lupa />
          <label for="busca" class="oculto-visual">Buscar paciente</label>
          <input id="busca" name="q" type="search" placeholder="Buscar paciente por nombre, DNI o celular" />
        </form>
        <div class="fila centro acciones-hoy">
          <Boton href="/turnos/nuevo" variante="destacado" data-modulo="agenda" aria-label="Dar turno"><Mas /><span class="solo-compu">Dar turno</span><span class="solo-celular">Turno</span></Boton>
          <Boton href="/cobros/nuevo" data-modulo="cobros">Cobrar</Boton>
          <Boton href="/bloqueos/nuevo" data-modulo="agenda" aria-label="Bloquear agenda">Bloquear<span class="solo-compu">&nbsp;agenda</span></Boton>
        </div>
      </section>

      {pendientes.length > 0 && (
        <section class="fila centro para-resolver" aria-label="Para resolver">
          {pendientes.map((p) => <a class="pastilla" href={p.href} data-modulo="agenda"><span class={`punto-tono ${p.tono}`} aria-hidden="true" />{p.texto}</a>)}
        </section>
      )}

      <div class="grilla hoy-grilla">
        <Tarjeta etiqueta="Ahora">
          {!ahora && <p class="suave">{lista.length === 0 ? 'Hoy no tenés turnos.' : 'No quedan turnos por atender hoy.'}</p>}
          {ahora && t && (
            <>
              <div class="entre-todo">
                <span class="chico suave fuerte">{ahora.tipo === 'consulta' ? `Atendido a las ${t.hora}` : ahora.cuando}</span>
                <Estado estado={ahora.tipo === 'consulta' ? 'confirmado' : ahora.tipo === 'curso' ? 'primera' : ahora.tipo === 'sin_resolver' ? 'debe' : 'gris'}
                  texto={ahora.tipo === 'consulta' ? 'En consulta' : ahora.tipo === 'curso' ? 'Ahora' : ahora.tipo === 'sin_resolver' ? 'Sin resolver' : 'Próximo'} />
              </div>
              <div class="columna-chica">
                <strong class="ahora-nombre">{t.nombre} {t.apellido}</strong>
                <span class="suave">{detalleTurno(t)}</span>
              </div>
              {ahora.tipo === 'consulta' ? (
                <div class="columna">
                  <div class="columna solo-compu">
                    <p class="suave chico">La consulta está abierta y el borrador se guarda solo.</p>
                    <Boton href={`/consultas/nueva?turno=${t.id}`} variante="oscuro" ancho>Ir a la consulta</Boton>
                  </div>
                  <p class="suave chico solo-celular-bloque">Está en consulta. Las notas clínicas las escribís en la compu.</p>
                </div>
              ) : (
                <div class="columna">
                  {t.incompleta === 1 && <p class="aviso ambar chico">Ficha incompleta: completala antes de empezar.</p>}
                  <form method="post" action={`/turnos/${t.id}/atender`} class="solo-compu">
                    <Boton type="submit" variante="oscuro" ancho>Atender</Boton>
                  </form>
                  <form method="post" action={`/turnos/${t.id}/atender`} class="solo-celular-bloque">
                    <input type="hidden" name="volver" value="/" />
                    <input type="hidden" name="llego" value="1" />
                    <Boton type="submit" variante="oscuro" ancho>Llegó</Boton>
                  </form>
                  <form method="post" action={`/turnos/${t.id}/ausente`} data-confirmar={`¿Marcar que ${t.nombre} no vino? No se puede deshacer.`}>
                    <input type="hidden" name="volver" value="/" />
                    <Boton type="submit" ancho>No vino</Boton>
                  </form>
                </div>
              )}
            </>
          )}
          {llego && (
            <p class="aviso ok" role="status">{llego.nombre} quedó en consulta. Las notas clínicas las escribís en la compu.</p>
          )}
          {ausente && (
            <p class="aviso" role="status">
              <span>{ausente.nombre} quedó como ausente. <a href={`/turnos/nuevo?paciente=${ausente.paciente_id}`} data-modulo="agenda">Darle otro turno</a></span>
            </p>
          )}
        </Tarjeta>

        <Tarjeta titulo="Hoy" etiqueta="Turnos de hoy" accion={<span class="chico suave">{lista.length === 0 ? 'Sin turnos' : lista.length === 1 ? '1 turno' : `${lista.length} turnos`} · <a href="/agenda" data-modulo="agenda">Ver agenda</a></span>}>
          {lista.length === 0 ? (
            <p class="suave">Hoy no tenés turnos.</p>
          ) : (
            <ul class="lista">
              {lista.map((x) => {
                const e = estadoMostrado(x, fecha, ahoraMin)
                const ahoraMismo = ahora?.turno.id === x.id && (ahora.tipo === 'curso' || ahora.tipo === 'consulta')
                return (
                  <li class={ahoraMismo ? 'en-curso' : undefined}>
                    <a class="fila-enlace" href={`/agenda?${new URLSearchParams({ vista: 'dia', fecha, turno: String(x.id), volver: '/' })}`} data-modulo="agenda">
                      <span class="hora">{x.hora}</span>
                      <span class="columna-chica">
                        <strong>{x.nombre} {x.apellido}</strong>
                        <span class="chico suave">{[x.prestacion, x.consultorio].filter(Boolean).join(' · ')}</span>
                      </span>
                    </a>
                    <span class="fila">
                      {x.primera && x.estado === 'confirmado' ? <Estado estado="primera" /> : null}
                      <Estado estado={CLAVE_ESTADO[e.clave] ?? 'gris'} texto={e.clave === 'atendido' && x.consulta_estado === 'borrador' ? 'En consulta' : e.texto} />
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </Tarjeta>

        {plata && (
          <Tarjeta titulo="Plata de hoy" accion={<a href="/cobros" data-modulo="cobros">Ver cobros</a>}>
            <div class="resumen-turno" data-modulo="cobros">
              <div class="dato-tarjeta"><span class="chico suave">Cobrado</span><strong class="dato-grande">{pesos(plata.cobrado)}</strong></div>
              <a class="dato-tarjeta enlace-tarjeta" href="/cobros?filtro=deben"><span class="chico suave">Te deben</span><strong class="dato-grande debe-texto">{pesos(plata.teDeben)}</strong></a>
            </div>
          </Tarjeta>
        )}

        <Tarjeta titulo="Controles por agendar" tono="suave">
          {controles.length === 0 ? <p class="suave">No hay controles pendientes.</p> : (
            <ul class="lista">
              {verControles.map((k) => {
                const cuando = cuandoControl(k.control, fecha)
                return (
                  <li>
                    <span class="columna-chica">
                      <strong>{k.nombre} {k.apellido}</strong>
                      <span class={cuando.vencido ? 'chico control-vencido' : 'chico suave'}>{cuando.texto}</span>
                    </span>
                    <Boton href={`/turnos/nuevo?paciente=${k.paciente_id}&fecha=${k.control < fecha ? fecha : k.control}`} data-modulo="agenda">Agendar</Boton>
                  </li>
                )
              })}
            </ul>
          )}
          {controles.length > verControles.length && <a href="/pacientes?filtro=sin_turno">Ver los {controles.length} pacientes sin próximo turno</a>}
        </Tarjeta>
      </div>
      <p class="solo-celular-bloque suave chico nota-compu">Historia clínica, certificados, recetas, estadísticas, configuración y exportar se hacen desde la compu.</p>
      <form method="post" action="/salir" class="fila centro">
        <Boton type="submit" variante="texto">Salir</Boton>
      </form>
    </Pagina>
  )
})
