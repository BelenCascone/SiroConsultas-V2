// P2 · Agenda: vistas Día, Semana y Mes, consultorio, huecos libres, horas sin atención, bloqueos y feriados rayados,
// la ventana de cada turno con sus acciones y el modo «mover». Maqueta: docs/pantallas/Agenda.dc.html (sección 8).
import { Hono } from 'hono'
import type { C, Env } from '../tipos'
import { leerInstalacion, habilitado } from '../lib/instalacion'
import { ahoraAR, esFecha, sumarDias } from '../lib/fechas'
import {
  cargarAgenda, huecosDelDia, franjasDelDia, bloqueoEn, feriadoSinAtencion, estadoVisual, buscarChoques, hayChoques, textosChoques,
  lunesDe, primeroDelMes, sumarMeses, finDelMes, minutos, hhmm, minutosDeAtencion, nombreCorto,
  fechaConDia, fechaDia, diaCorto, nombreMes, TEXTO_ESTADO, MARCA_ESTADO, type DatosAgenda, type TurnoAgenda, type EstadoVisual,
} from '../lib/agenda'
import { Pagina } from '../ui/pagina'
import { Estado, Pastilla, Ventana } from '../ui/componentes'
import { datosProfesional, avisosSinLeer } from './inicio'

export const agenda = new Hono<Env>()

type Vista = 'dia' | 'semana' | 'mes'
type Estado = {
  vista: Vista; fecha: string; consultorio: number | null; turno?: number; mover?: number
  destino?: { fecha: string; hora: string; consultorio: number }; aviso?: string; choque: boolean; alcance?: string
}

function leerEstado(c: C, hoy: string): Estado {
  const q = (k: string) => c.req.query(k)
  const vista = (['dia', 'semana', 'mes'] as const).find((v) => v === q('vista')) ?? 'semana'
  const destino = /^(\d{4}-\d{2}-\d{2})_(\d{2}:\d{2})_(\d+)$/.exec(q('destino') ?? '')
  return {
    vista, fecha: esFecha(q('fecha') ?? '') ? q('fecha')! : hoy,
    consultorio: /^\d+$/.test(q('consultorio') ?? '') ? Number(q('consultorio')) : null,
    turno: /^\d+$/.test(q('turno') ?? '') ? Number(q('turno')) : undefined,
    mover: /^\d+$/.test(q('mover') ?? '') ? Number(q('mover')) : undefined,
    destino: destino ? { fecha: destino[1], hora: destino[2], consultorio: Number(destino[3]) } : undefined,
    aviso: q('aviso'), choque: q('choque') === '1', alcance: q('alcance'),
  }
}

function enlace(e: Estado, cambios: Partial<Record<'vista' | 'fecha' | 'consultorio' | 'turno' | 'mover' | 'destino', string | number | undefined>> = {}) {
  const v = {
    vista: e.vista, fecha: e.fecha, consultorio: e.consultorio ?? undefined, mover: e.mover,
    turno: undefined as number | string | undefined, destino: undefined as string | undefined, ...cambios,
  }
  const u = new URLSearchParams()
  if (v.vista && v.vista !== 'semana') u.set('vista', String(v.vista))
  if (v.fecha) u.set('fecha', String(v.fecha))
  for (const k of ['consultorio', 'mover', 'turno', 'destino'] as const) if (v[k] !== undefined && v[k] !== '') u.set(k, String(v[k]))
  return `/agenda?${u}`
}

// ---------- Página ----------
agenda.get('/agenda', async (c) => {
  const ahora = ahoraAR()
  const e = leerEstado(c, ahora.fecha)
  const inst = leerInstalacion(c.env)
  const cobros = habilitado(inst, 'cobros')
  // Días que se muestran
  const desde = e.vista === 'dia' ? e.fecha : e.vista === 'semana' ? lunesDe(e.fecha) : lunesDe(primeroDelMes(e.fecha))
  const hasta = e.vista === 'dia' ? e.fecha : e.vista === 'semana' ? sumarDias(desde, 6) : sumarDias(lunesDe(finDelMes(e.fecha)), 6)
  const [d, prof, avisos, moviendo] = await Promise.all([
    cargarAgenda(c.env.DB, desde, hasta), datosProfesional(c), avisosSinLeer(c),
    e.mover ? leerTurnoAgenda(c, e.mover) : null,
  ])
  const enMover = moviendo && ['confirmado', 'solicitado'].includes(moviendo.estado) ? moviendo : null
  const conTurno = { ...d, turnos: enMover ? d.turnos.filter((t) => t.id !== enMover.id) : d.turnos }
  const consultorios = d.consultorios.filter((x) => x.activo)
  const visibles = (fecha: string) => d.turnos.filter((t) => t.fecha === fecha && (e.consultorio === null || t.consultorio_id === e.consultorio))
  const estadoDe = (t: TurnoAgenda): EstadoVisual =>
    estadoVisual(t, ahora, !!bloqueoEn(d.bloqueos, t.fecha, t.consultorio_id, minutos(t.hora), minutos(t.hora) + t.duracion_min) || !!feriadoSinAtencion(d.feriados, t.fecha), cobros)

  // Encabezado: título, flechas, resumen
  const titulo = e.vista === 'dia' ? fechaConDia(e.fecha).replace(/^./, (x) => x.toUpperCase())
    : e.vista === 'semana' ? `Semana del ${Number(desde.slice(8))}/${Number(desde.slice(5, 7))} al ${Number(sumarDias(desde, 5).slice(8))}/${Number(sumarDias(desde, 5).slice(5, 7))}`
      : nombreMes(e.fecha).replace(/^./, (x) => x.toUpperCase())
  const paso = (n: number) => e.vista === 'dia' ? sumarDias(e.fecha, n) : e.vista === 'semana' ? sumarDias(e.fecha, 7 * n) : sumarMeses(e.fecha, n)
  const enRango = (f: string) => e.vista === 'mes' ? f.slice(0, 7) === e.fecha.slice(0, 7) : f >= desde && f <= hasta
  const delPeriodo = d.turnos.filter((t) => enRango(t.fecha) && (e.consultorio === null || t.consultorio_id === e.consultorio))
  const cuenta = (...estados: EstadoVisual[]) => delPeriodo.filter((t) => estados.includes(estadoDe(t))).length
  const pedidos = [...d.pedidos].filter(([f]) => enRango(f)).reduce((s, [, n]) => s + n, 0)
  const resumen = [
    delPeriodo.length === 1 ? '1 turno' : `${delPeriodo.length} turnos`,
    `${cuenta('sin_confirmar')} sin confirmar`,
    pedidos === 1 ? '1 pedido online' : `${pedidos} pedidos online`,
    `${cuenta('no_puede', 'para_mover', 'para_cobrar', 'para_resolver')} para resolver`,
  ].join(' · ')

  const turnoAbierto = e.turno && !e.mover ? await leerTurnoAgenda(c, e.turno) : null

  return c.html(
    <Pagina titulo="Agenda" seccion="agenda" inst={inst} email={c.get('email')!} nombre={prof.nombre} avisos={avisos}>
      <section class="agenda-barra">
        <nav class="fila" aria-label="Vista">
          {(['dia', 'semana', 'mes'] as const).map((v) => (
            <Pastilla href={enlace(e, { vista: v })} actual={e.vista === v}>{v === 'dia' ? 'Día' : v === 'semana' ? 'Semana' : 'Mes'}</Pastilla>
          ))}
        </nav>
        {consultorios.length > 1 && (
          <form method="get" action="/agenda" class="fila">
            {e.vista !== 'semana' && <input type="hidden" name="vista" value={e.vista} />}
            <input type="hidden" name="fecha" value={e.fecha} />
            {e.mover && <input type="hidden" name="mover" value={e.mover} />}
            <label for="c-consultorio" class="etiqueta">Consultorio</label>
            <select id="c-consultorio" name="consultorio" class="entrada selector-chico" data-enviar="">
              <option value="">Todos</option>
              {consultorios.map((x) => <option value={x.id} selected={x.id === e.consultorio}>{x.nombre}</option>)}
            </select>
            <button type="submit" class="boton borde sin-js">Ver</button>
          </form>
        )}
      </section>
      <section class="agenda-titulo">
        <div class="fila">
          <a class="redondo" href={enlace(e, { fecha: paso(-1) })} aria-label="Anterior">‹</a>
          <h1>{titulo}</h1>
          <a class="redondo" href={enlace(e, { fecha: paso(1) })} aria-label="Siguiente">›</a>
        </div>
        <span class="portada-sub">
          {resumen}
          {!enRango(ahora.fecha) && <> · <a href={enlace(e, { fecha: ahora.fecha })}>{e.vista === 'dia' ? 'Volver a hoy' : e.vista === 'semana' ? 'Volver a esta semana' : 'Volver a este mes'}</a></>}
        </span>
      </section>

      {enMover && (
        <div class="aviso franja" role="status">
          <span><strong>Moviendo el turno de {enMover.nombre} {enMover.apellido}</strong> · tenía {fechaDia(enMover.fecha)} {enMover.hora}. Tocá un hueco libre de esta semana o de otra.</span>
          <a class="boton borde" href={enlace(e, { mover: undefined })}>No mover</a>
        </div>
      )}
      <AvisoAccion c={c} e={e} />

      {e.vista === 'mes'
        ? <Mes e={e} d={d} ahora={ahora} desde={desde} hasta={hasta} />
        : <Grilla e={e} d={conTurno} dias={diasDeGrilla(e, d, desde)} visibles={visibles} estadoDe={estadoDe} ahora={ahora} moviendo={enMover} />}

      {e.vista !== 'mes' && <Leyenda cobros={cobros} />}
      {turnoAbierto && !e.aviso && <VentanaTurno c={c} t={turnoAbierto} estado={estadoDe(turnoAbierto)} cobros={cobros} />}
      {enMover && e.destino && <VentanaDestino c={c} e={e} t={enMover} />}
    </Pagina>
  )
})

/** Lunes a sábado (y el domingo solo si se atiende o hay turnos ese día). */
function diasDeGrilla(e: Estado, d: DatosAgenda, desde: string) {
  if (e.vista === 'dia') return [e.fecha]
  const dias = Array.from({ length: 6 }, (_, i) => sumarDias(desde, i))
  const domingo = sumarDias(desde, 6)
  if (d.franjas.some((f) => f.dia === 7) || d.turnos.some((t) => t.fecha === domingo)) dias.push(domingo)
  return dias
}

const leerTurnoAgenda = (c: C, id: number) => c.env.DB.prepare(
  `SELECT t.id, t.paciente_id, p.nombre, p.apellido, p.celular, t.consultorio_id, c.nombre consultorio, t.fecha, t.hora, t.duracion_min,
          pr.nombre prestacion, t.estado, t.confirmacion, t.cancelado_por, t.modalidad, t.serie_id,
          (SELECT COUNT(*) FROM turnos t2 WHERE t2.paciente_id = t.paciente_id AND t2.estado = 'atendido' AND t2.id <> t.id) veces,
          COALESCE((SELECT SUM(vc.saldo) FROM v_cobros vc WHERE vc.turno_id = t.id), 0) saldo,
          EXISTS (SELECT 1 FROM cobros cb WHERE cb.turno_id = t.id AND cb.anulado_en IS NULL) con_cobro
     FROM turnos t JOIN pacientes p ON p.id = t.paciente_id JOIN consultorios c ON c.id = t.consultorio_id
     LEFT JOIN prestaciones pr ON pr.id = t.prestacion_id WHERE t.id = ?`
).bind(id).first<TurnoAgenda & { faltas?: number }>()

// ---------- Avisos después de una acción ----------
async function AvisoAccion({ c, e }: { c: C; e: Estado }) {
  if (!e.aviso || !e.turno) return <></>
  const t = await leerTurnoAgenda(c, e.turno)
  if (!t) return <></>
  const avisar = (tipo: string, texto: string) => (
    <form method="post" action={`/turnos/${t.id}/avisar`} target="_blank">
      <input type="hidden" name="tipo" value={tipo} />
      <button type="submit" class="boton oscuro">{texto}</button>
    </form>
  )
  const textos: Record<string, [string, any?]> = {
    cancelado: [`Se canceló el turno de ${t.nombre} ${t.apellido} del ${fechaDia(t.fecha)} a las ${t.hora}.`, avisar('cancelado', 'Avisarle por WhatsApp')],
    movido: [`El turno de ${t.nombre} ${t.apellido} pasó al ${fechaDia(t.fecha)} a las ${t.hora}.`, avisar('movido', 'Avisarle por WhatsApp')],
    ausente: [`${t.nombre} ${t.apellido} quedó como ausente.`, <a class="boton oscuro" href={`/turnos/nuevo?paciente=${t.paciente_id}&volver=${encodeURIComponent(enlace(e, { turno: undefined }))}`}>Darle otro turno</a>],
    cerrado: ['Ese turno ya estaba cerrado: no se puede cambiar.'],
    futuro: ['Todavía no es el día del turno.'],
  }
  const x = textos[e.aviso]
  if (!x) return <></>
  return (
    <div class={`aviso franja${['cerrado', 'futuro'].includes(e.aviso) ? ' ambar' : ' ok'}`} role="status">
      <span>{x[0]}</span>
      <span class="fila">{x[1]}<a class="boton texto" href={enlace(e, { turno: undefined })}>Listo</a></span>
    </div>
  )
}

// ---------- Grilla de día y semana ----------
const PASO = 15 // minutos por fila

function Grilla({ e, d, dias, visibles, estadoDe, ahora, moviendo }: {
  e: Estado; d: DatosAgenda; dias: string[]; visibles: (f: string) => TurnoAgenda[]; estadoDe: (t: TurnoAgenda) => EstadoVisual
  ahora: { fecha: string; hora: string }; moviendo: TurnoAgenda | null
}) {
  // Rango de horas: de 8 a 20, estirado si hay horarios o turnos antes o después.
  const franjas = d.franjas.filter((f) => e.consultorio === null || f.consultorio_id === e.consultorio)
  const turnos = dias.flatMap(visibles)
  const inicio = Math.max(5 * 60, Math.floor(Math.min(8 * 60, ...franjas.map((f) => minutos(f.desde)), ...turnos.map((t) => minutos(t.hora))) / 60) * 60)
  const fin = Math.min(24 * 60, Math.ceil(Math.max(20 * 60, ...franjas.map((f) => minutos(f.hasta)), ...turnos.map((t) => minutos(t.hora) + t.duracion_min)) / 60) * 60)
  const filas = (fin - inicio) / PASO
  const fila = (m: number) => 2 + Math.max(0, Math.floor((m - inicio) / PASO))
  const alto = (desde: number, hasta: number) => Math.max(1, Math.min(fila(hasta - 1) + 1, 2 + filas) - fila(desde))
  const col = (i: number) => i + 2
  const unDia = dias.length === 1
  return (
    <section class={`tarjeta agenda-tarjeta`} aria-label={`Agenda ${unDia ? fechaConDia(dias[0]) : 'de la semana'}`}>
      <div class={`grilla-agenda cols-${dias.length}`}>
        {dias.map((dia, i) => {
          const feriado = d.feriados.get(dia)
          const bloqueoDia = bloqueoEn(d.bloqueos, dia, e.consultorio)
          return (
            <a class={`gc-${col(i)} gf-1 cabeza-dia${dia === ahora.fecha ? ' hoy' : ''}`} href={enlace(e, { vista: 'dia', fecha: dia })} aria-current={dia === ahora.fecha ? 'date' : undefined}>
              <span>{diaCorto(dia)} {Number(dia.slice(8))}</span>
              <span class="chico">{feriado ? (feriado.atiende === 1 ? 'Feriado · atendés' : 'Feriado') : bloqueoDia && bloqueoDia.hora_desde === null ? 'Bloqueado' : ''}</span>
            </a>
          )
        })}
        {Array.from({ length: (fin - inicio) / 60 }, (_, h) => (
          <span class={`gc-1 gf-${fila(inicio + h * 60)} ga-4 hora-etiqueta`}>{hhmm(inicio + h * 60)}</span>
        ))}
        {dias.map((dia, i) => <div class={`gc-${col(i)} gf-2 ga-${filas} fondo-dia${dia === ahora.fecha ? ' hoy' : ''}`} aria-hidden="true" />)}
        {dias.flatMap((dia, i) => {
          // Lo que no se ofrece: feriado sin atención, horas sin atención y bloqueos.
          const feriado = feriadoSinAtencion(d.feriados, dia)
          if (feriado) return [<div class={`gc-${col(i)} gf-2 ga-${filas} rayado feriado`}><span>Feriado</span><span class="chico">{feriado.nombre}</span></div>]
          const libres = franjasDelDia(d.franjas, dia, e.consultorio).map((f) => [minutos(f.desde), minutos(f.hasta)] as const).sort((a, b) => a[0] - b[0])
          const huecosSin: [number, number][] = []
          let cursor = inicio
          for (const [a, b] of libres) { if (a > cursor) huecosSin.push([cursor, Math.min(a, fin)]); cursor = Math.max(cursor, b) }
          if (cursor < fin) huecosSin.push([cursor, fin])
          const fuera = huecosSin.filter(([a, b]) => b > a).map(([a, b]) => (
            <div class={`gc-${col(i)} gf-${fila(a)} ga-${alto(a, b)} rayado`} aria-hidden="true">{b - a >= 120 ? <span class="chico">No atendés</span> : null}</div>
          ))
          const bloqueos = d.bloqueos.filter((b) => b.desde <= dia && b.hasta >= dia && (b.consultorio_id === null || e.consultorio === null || b.consultorio_id === e.consultorio)).map((b) => {
            const a = b.hora_desde ? minutos(b.hora_desde) : inicio
            const z = b.hora_hasta ? minutos(b.hora_hasta) : fin
            return <div class={`gc-${col(i)} gf-${fila(a)} ga-${alto(a, z)} rayado bloqueo`}><span>Bloqueado</span>{b.motivo && <span class="chico">{b.motivo}</span>}</div>
          })
          return [...fuera, ...bloqueos]
        })}
        {dias.flatMap((dia, i) => huecosDelDia(d, dia, e.consultorio, ahora, 30, moviendo?.duracion_min ?? 30).map((h) => {
          const m = minutos(h.hora)
          const cuando = `${fechaConDia(dia)} a las ${h.hora}`
          const href = moviendo
            ? enlace(e, { destino: `${dia}_${h.hora}_${h.consultorio_id}` })
            : `/turnos/nuevo?${new URLSearchParams({ fecha: dia, hora: h.hora, consultorio: String(h.consultorio_id), volver: enlace(e) })}`
          return (
            <a class={`gc-${col(i)} gf-${fila(m)} ga-2 hueco${moviendo ? ' destino' : ''}`} href={href} aria-label={moviendo ? `Mover al ${cuando}` : `Hueco libre el ${cuando}`}>
              <span aria-hidden="true">{moviendo ? `Mover ${h.hora}` : `+ ${h.hora}`}</span>
            </a>
          )
        }))}
        {dias.flatMap((dia, i) => visibles(dia).map((t) => {
          const m = minutos(t.hora)
          const est = estadoDe(t)
          return (
            <a class={`gc-${col(i)} gf-${fila(m)} ga-${alto(m, m + t.duracion_min)} turno t-${est}${t.id === e.turno ? ' elegido' : ''}`}
              href={enlace(e, { turno: t.id, mover: undefined })} aria-label={`${t.hora} ${t.nombre} ${t.apellido}, ${TEXTO_ESTADO[est]}`} title={`${t.hora} · ${t.nombre} ${t.apellido}`}>
              <span class="turno-nombre">{unDia ? `${t.hora} · ${t.nombre} ${t.apellido}` : nombreCorto(t.nombre, t.apellido)}</span>
              {unDia && <span class="chico">{[t.prestacion, t.consultorio, TEXTO_ESTADO[est]].filter(Boolean).join(' · ')}</span>}
              {t.modalidad === 'videollamada' && <span class="oculto-visual"> (videollamada)</span>}
            </a>
          )
        }))}
        {dias.includes(ahora.fecha) && minutos(ahora.hora) >= inicio && minutos(ahora.hora) < fin && (
          <div class={`gc-${col(dias.indexOf(ahora.fecha))} gf-${fila(minutos(ahora.hora))} linea-ahora`} aria-label={`Ahora, ${ahora.hora}`} role="img" />
        )}
      </div>
    </section>
  )
}

function Leyenda({ cobros }: { cobros: boolean }) {
  const estados: EstadoVisual[] = ['confirmo', 'sin_confirmar', 'pedido', 'no_puede', 'atendido', ...(cobros ? ['para_cobrar' as const] : []), 'ausente']
  return (
    <ul class="leyenda" aria-label="Qué significa cada color">
      {estados.map((x) => <li><span class={`muestra t-${x}`} aria-hidden="true" />{TEXTO_ESTADO[x]}</li>)}
      <li><span class="muestra rayado feriado" aria-hidden="true" />Feriado</li>
      <li><span class="muestra rayado" aria-hidden="true" />Bloqueado o no atendés</li>
    </ul>
  )
}

// ---------- Mes ----------
function Mes({ e, d, ahora, desde, hasta }: { e: Estado; d: DatosAgenda; ahora: { fecha: string; hora: string }; desde: string; hasta: string }) {
  const dias: string[] = []
  for (let f = desde; f <= hasta; f = sumarDias(f, 1)) dias.push(f)
  return (
    <section class="tarjeta" aria-label={nombreMes(e.fecha)}>
      <div class="grilla-mes">
        {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((x) => <span class="cabeza-mes" aria-hidden="true">{x}</span>)}
        {dias.map((dia) => {
          const delMes = dia.slice(0, 7) === e.fecha.slice(0, 7)
          const turnos = d.turnos.filter((t) => t.fecha === dia && (e.consultorio === null || t.consultorio_id === e.consultorio))
          const feriado = feriadoSinAtencion(d.feriados, dia)
          const bloqueo = bloqueoEn(d.bloqueos, dia, e.consultorio)
          const atencion = minutosDeAtencion(d.franjas, dia, e.consultorio)
          const texto = feriado ? `Feriado · ${feriado.nombre}` : bloqueo && bloqueo.hora_desde === null ? 'Bloqueado' : atencion === 0 && !turnos.length ? 'No atendés'
            : turnos.length ? (turnos.length === 1 ? '1 turno' : `${turnos.length} turnos`) : 'Sin turnos'
          const libres = dia >= ahora.fecha && atencion > 0 && !feriado ? huecosDelDia(d, dia, e.consultorio, ahora).length : 0
          const ocupado = atencion ? Math.min(10, Math.round((turnos.reduce((s, t) => s + t.duracion_min, 0) / atencion) * 10)) : 0
          const pedidos = d.pedidos.get(dia) ?? 0
          return (
            <a class={`dia-mes${delMes ? '' : ' fuera-mes'}${dia === ahora.fecha ? ' hoy' : ''}${feriado || (bloqueo && bloqueo.hora_desde === null) ? ' rayado' : ''}`}
              href={enlace(e, { vista: 'dia', fecha: dia })} aria-label={`${fechaConDia(dia)}: ${texto}${pedidos ? `, ${pedidos} pedido online` : ''}`}>
              <span class="fila entre-todo"><strong class="num-dia">{Number(dia.slice(8))}</strong>{pedidos > 0 && <span class="punto-pedido" title="Pedido online" />}</span>
              <span class="chico">{texto}</span>
              {dia >= ahora.fecha && atencion > 0 && !feriado && <>
                <span class="barra" aria-hidden="true"><span class={`ocupa-${ocupado}`} /></span>
                <span class="chico suave">{libres === 1 ? '1 hueco libre' : `${libres} huecos libres`}</span>
              </>}
            </a>
          )
        })}
      </div>
    </section>
  )
}

// ---------- Ventana del turno ----------
function VentanaTurno({ c, t, estado, cobros }: { c: C; t: TurnoAgenda; estado: EstadoVisual; cobros: boolean }) {
  const volver = encodeURIComponent(c.req.path + '?' + new URLSearchParams(Object.entries(c.req.query()).filter(([k]) => k !== 'turno')).toString())
  const historial = t.veces === 0 ? 'Sería su primera consulta' : t.veces === 1 ? 'Vino 1 vez' : `Vino ${t.veces} veces`
  const cancelado = t.estado === 'cancelado'
  const futuro = ['confirmo', 'sin_confirmar', 'no_puede', 'para_mover'].includes(estado) && !cancelado
  const delDia = ['ahora', 'para_resolver'].includes(estado) && !cancelado
  const Cancelar = () => (
    <details class="desplegable">
      <summary>Cancelar y avisar</summary>
      <form method="post" action={`/turnos/${t.id}/cancelar`} class="columna" data-confirmar="¿Cancelar el turno?">
        <fieldset class="opciones">
          <legend>¿Quién cancela?</legend>
          <label class="opcion"><input type="radio" name="quien" value="profesional" checked /><span>Cancelo yo</span></label>
          <label class="opcion"><input type="radio" name="quien" value="paciente" /><span>Avisó que no viene</span></label>
        </fieldset>
        {t.serie_id && (
          <fieldset class="opciones">
            <legend>Se repite</legend>
            <label class="opcion"><input type="radio" name="alcance" value="este" checked /><span>Solo este</span></label>
            <label class="opcion"><input type="radio" name="alcance" value="siguientes" /><span>Este y los siguientes</span></label>
          </fieldset>
        )}
        <button type="submit" class="boton peligro">Cancelar el turno</button>
      </form>
    </details>
  )
  return (
    <Ventana id="ventana-turno" titulo={`${t.nombre} ${t.apellido}`} sub={`${fechaConDia(t.fecha)} · ${t.hora} · ${t.duracion_min} min`}>
      <span data-config-abrir="ventana-turno" hidden />
      <div class="fila">
        <Estado estado={cancelado ? 'cancelado' : MARCA_ESTADO[estado]} texto={cancelado ? (t.cancelado_por === 'paciente' ? 'Canceló el paciente' : 'Cancelado') : TEXTO_ESTADO[estado]} />
        <Estado estado={t.veces === 0 ? 'primera' : 'confirmado'} texto={historial} />
      </div>
      <dl class="datos">
        <dt>Prestación</dt><dd>{t.prestacion ?? 'Sin prestación'}</dd>
        <dt>Consultorio</dt><dd>{t.consultorio}{t.modalidad === 'videollamada' ? ' (videollamada)' : ''}</dd>
        <dt>Celular</dt><dd>{t.celular}</dd>
        {t.serie_id && <><dt>Se repite</dt><dd>Sí</dd></>}
      </dl>
      <div class="columna acciones-turno">
        {delDia && <>
          <form method="post" action={`/turnos/${t.id}/atender`} data-confirmar="Marcar como atendido no se deshace. ¿Seguimos?">
            <button type="submit" class="boton oscuro ancho">Atender</button>
          </form>
          <div class="fila">
            <form method="post" action={`/turnos/${t.id}/ausente`} data-confirmar="¿Marcar que no vino?"><button type="submit" class="boton borde">No vino</button></form>
            <form method="post" action={`/turnos/${t.id}/cancelar`}><input type="hidden" name="quien" value="paciente" /><button type="submit" class="boton borde">Avisó que no viene</button></form>
          </div>
        </>}
        {futuro && <>
          <a class="boton oscuro ancho" href={`/agenda?mover=${t.id}&fecha=${t.fecha}`}>Mover</a>
          <form method="post" action={`/turnos/${t.id}/avisar`} target="_blank">
            <input type="hidden" name="tipo" value="recordatorio" />
            <button type="submit" class="boton borde ancho">Mandar recordatorio</button>
          </form>
          <Cancelar />
        </>}
        {t.estado === 'ausente' && (
          <a class="boton oscuro ancho" href={`/turnos/nuevo?paciente=${t.paciente_id}&volver=${volver}`}>Darle otro turno</a>
        )}
        {t.estado === 'atendido' && cobros && (estado === 'para_cobrar') && (
          <a class="boton oscuro ancho" href={`/cobros/nuevo?turno=${t.id}`} data-modulo="cobros">Cobrar</a>
        )}
        <a class="boton texto" href={`/pacientes/${t.paciente_id}`}>Ver ficha</a>
      </div>
    </Ventana>
  )
}

async function VentanaDestino({ c, e, t }: { c: C; e: Estado; t: TurnoAgenda }) {
  const dest = e.destino!
  const consultorio = await c.env.DB.prepare('SELECT nombre FROM consultorios WHERE id = ?').bind(dest.consultorio).first<{ nombre: string }>()
  const choques = await buscarChoques(c.env.DB, { fecha: dest.fecha, hora: dest.hora, duracion: t.duracion_min, consultorio_id: dest.consultorio, excluir: [t.id] }, ahoraAR())
  const textos = hayChoques(choques) ? textosChoques(choques, dest.fecha) : []
  return (
    <Ventana id="ventana-mover" titulo={`Mover el turno de ${t.nombre} ${t.apellido}`}>
      <span data-config-abrir="ventana-mover" hidden />
      <div class="resumen-turno">
        <div class="dato-tarjeta"><span class="chico suave">Tenía</span><strong>{fechaDia(t.fecha)} · {t.hora}</strong></div>
        <div class="dato-tarjeta elegida"><span class="chico suave">Pasa a</span><strong>{fechaDia(dest.fecha)} · {dest.hora}{consultorio ? ` · ${consultorio.nombre}` : ''}</strong></div>
      </div>
      <form method="post" action={`/turnos/${t.id}/mover`} class="columna">
        <input type="hidden" name="fecha" value={dest.fecha} />
        <input type="hidden" name="hora" value={dest.hora} />
        <input type="hidden" name="consultorio" value={dest.consultorio} />
        {t.serie_id && (
          <fieldset class="opciones">
            <legend>Se repite</legend>
            <label class="opcion"><input type="radio" name="alcance" value="este" checked={e.alcance !== 'siguientes'} /><span>Solo este</span></label>
            <label class="opcion"><input type="radio" name="alcance" value="siguientes" checked={e.alcance === 'siguientes'} /><span>Este y los siguientes</span></label>
          </fieldset>
        )}
        {textos.length > 0 && (
          <div class="aviso ambar columna-chica" role="alert">
            {textos.map((x) => <span>{x}</span>)}
            <label class="fila"><input type="checkbox" name="forzar" value="1" required /> Es mi agenda: moverlo igual</label>
          </div>
        )}
        <p class="chico suave">Después te dejamos el mensaje listo para avisarle por WhatsApp.</p>
        <div class="ventana-pie">
          <a class="boton texto" href={enlace(e, { destino: undefined })}>Elegir otro hueco</a>
          <button type="submit" class="boton oscuro">Mover</button>
        </div>
      </form>
    </Ventana>
  )
}

