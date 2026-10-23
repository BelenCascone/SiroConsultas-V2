// Hoy (armazón de la etapa 0): saludo, buscador, acciones y la lista del día leída de la base.
// El tablero completo (Ahora, Para resolver, Plata de hoy, Controles por agendar) se arma en la etapa 1.
import { Hono } from 'hono'
import type { C, Env } from '../tipos'
import { leerInstalacion } from '../lib/instalacion'
import { ahoraAR, fechaLarga, saludo } from '../lib/fechas'
import { Pagina } from '../ui/pagina'
import { Boton, Estado, Tarjeta } from '../ui/componentes'
import { Lupa, Mas } from '../ui/iconos'

type TurnoHoy = { id: number; hora: string; nombre: string; apellido: string; estado: string; prestacion: string | null; consultorio: string; primera: number }

export async function datosProfesional(c: C) {
  return (await c.env.DB.prepare('SELECT nombre FROM profesional WHERE id = 1').first<{ nombre: string | null }>()) ?? { nombre: null }
}
export async function avisosSinLeer(c: C) {
  return (await c.env.DB.prepare('SELECT COUNT(*) n FROM notificaciones WHERE leida_en IS NULL').first<{ n: number }>())?.n ?? 0
}

export const inicio = new Hono<Env>()

inicio.get('/', async (c) => {
  const inst = leerInstalacion(c.env)
  const email = c.get('email')!
  const { fecha, horaNum } = ahoraAR()
  const [prof, avisos, turnos] = await Promise.all([
    datosProfesional(c),
    avisosSinLeer(c),
    c.env.DB.prepare(
      `SELECT t.id, t.hora, p.nombre, p.apellido, t.estado, pr.nombre prestacion, co.nombre consultorio,
              NOT EXISTS (SELECT 1 FROM turnos t2 WHERE t2.paciente_id = t.paciente_id AND t2.estado = 'atendido') primera
         FROM turnos t JOIN pacientes p ON p.id = t.paciente_id JOIN consultorios co ON co.id = t.consultorio_id
         LEFT JOIN prestaciones pr ON pr.id = t.prestacion_id
        WHERE t.fecha = ? AND t.estado <> 'cancelado' ORDER BY t.hora`
    ).bind(fecha).all<TurnoHoy>(),
  ])
  const primerNombre = (prof.nombre ?? '').trim().split(/\s+/)[0]
  const lista = turnos.results ?? []
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
        <div class="fila centro">
          <Boton href="/turnos/nuevo" variante="destacado" data-modulo="agenda"><Mas />Dar turno</Boton>
          <Boton href="/cobros/nuevo" data-modulo="cobros">Cobrar</Boton>
          <Boton href="/bloqueos/nuevo" data-modulo="agenda">Bloquear agenda</Boton>
        </div>
      </section>
      <div class="grilla">
        <Tarjeta titulo="Turnos de hoy" accion={<a href="/agenda" data-modulo="agenda">Ver agenda</a>}>
          {lista.length === 0 ? (
            <p class="suave">Hoy no tenés turnos.</p>
          ) : (
            <ul class="lista">
              {lista.map((t) => (
                <li>
                  <span class="fila">
                    <span class="hora">{t.hora}</span>
                    <span>
                      <strong>{t.nombre} {t.apellido}</strong>
                      <br /><span class="chico suave">{[t.prestacion, t.consultorio].filter(Boolean).join(' · ')}</span>
                    </span>
                  </span>
                  <span class="fila">
                    {t.primera ? <Estado estado="primera" /> : null}
                    <Estado estado={t.estado} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>
      </div>
      <form method="post" action="/salir" class="fila centro">
        <Boton type="submit" variante="texto">Salir</Boton>
      </form>
    </Pagina>
  )
})
