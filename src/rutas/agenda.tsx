// P2b · Agenda Día / Semana / Mes y la ventana del turno (Atender, No vino, Mover, Cancelar y avisar, Darle otro turno, Ver ficha).
// Maqueta: docs/pantallas/Agenda.dc.html · docs/DISENO_APROBADO.md, sección 8. Todo se abre en ventanas sobre la agenda.
import { Hono } from 'hono'
import type { Child } from 'hono/jsx'
import type { C, Env } from '../tipos'
import { leerInstalacion } from '../lib/instalacion'
import { DIAS, MESES, ahoraAR, ahoraISO, esFecha, esHora, fechaLarga, sumarDias } from '../lib/fechas'
import { registrar } from '../lib/sesion'
import { enlaceWhatsapp } from '../lib/pacientes'
import { textoRecordatorio } from '../lib/recordatorios'
import { PASO_MIN, aHora, aMinutos, cargarAgenda, controlar, diaDe, huecos, type DatosAgenda, type Dia } from '../lib/turnos'
import {
  CLAVE_ESTADO, VISTAS, estadoMostrado, lunesDe, limitesDelTablero, moverTurno, nombreCorto, rangoDe, turnosDelRango, vecina, type TurnoAgenda, type Vista,
} from '../lib/agenda'
import { Pagina } from '../ui/pagina'
import { Aviso, Boton, Estado, Tarjeta } from '../ui/componentes'
import { Cruz, Flecha, Volver } from '../ui/iconos'
import { datosProfesional, avisosSinLeer } from './inicio'

export const agenda = new Hono<Env>()

async function pagina(c: C, titulo: string, hijos: Child, status: 200 | 404 | 409 | 422 = 200) {
  const [prof, avisos] = await Promise.all([datosProfesional(c), avisosSinLeer(c)])
  return c.html(
    <Pagina titulo={titulo} seccion="agenda" inst={leerInstalacion(c.env)} email={c.get('email')!} nombre={prof.nombre} avisos={avisos}>
      {hijos}
    </Pagina>, status)
}

// ---------- Enlaces ----------
type Q = { vista: Vista; fecha: string; consultorio: string; turno?: string; mover?: string; destino?: string; volver?: string }
const url = (q: Partial<Q>) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(q)) if (v) p.set(k, v)
  return `/agenda?${p}`
}
/** A dónde se puede volver después de una acción: la agenda, Hoy o la lista de un bloqueo (nunca un sitio de afuera). */
export const volverValido = (v: unknown, otro = '/agenda') =>
  typeof v === 'string' && (v === '/' || v.startsWith('/agenda') || /^\/bloqueos\/\d+(\?[\w=&%,.:-]*)?$/.test(v)) ? v : otro
const entero = (v: unknown) => (typeof v === 'string' && /^\d{1,9}$/.test(v) ? Number(v) : 0)

type Consultorio = { id: number; nombre: string; modalidad: string }

/** Datos de un turno con lo que hace falta para la ventana y para los avisos. */
type Detalle = TurnoAgenda & {
  celular: string; dni: string; cobertura: string; obra_social: string | null; veces: number; faltas: number; incompleta: number
  direccion: string | null; enlace_video: string | null
  correo: string | null; recordatorios_baja: number; recordatorio_whatsapp_en: string | null; recordatorio_correo_en: string | null; plantilla: string | null
}
const leerDetalle = (db: D1Database, id: number) => db.prepare(
  `SELECT t.id, t.fecha, t.hora, t.duracion_min, t.estado, t.confirmacion, t.consultorio_id, co.nombre consultorio, co.direccion, t.modalidad, t.enlace_video,
          t.paciente_id, p.nombre, p.apellido, p.celular, p.dni, p.correo, p.recordatorios_baja, t.recordatorio_whatsapp_en, t.recordatorio_correo_en, (SELECT recordatorio_mensaje FROM profesional WHERE id = 1) plantilla, t.cobertura, os.nombre obra_social, pr.nombre prestacion,
          (SELECT COUNT(*) FROM turnos x WHERE x.paciente_id = p.id AND x.estado = 'atendido') veces,
          (SELECT COUNT(*) FROM turnos x WHERE x.paciente_id = p.id AND x.estado = 'ausente') faltas,
          (p.fecha_nacimiento IS NULL OR p.domicilio IS NULL OR p.ocupacion IS NULL OR p.cobertura IS NULL) incompleta
     FROM turnos t JOIN pacientes p ON p.id = t.paciente_id JOIN consultorios co ON co.id = t.consultorio_id
     LEFT JOIN prestaciones pr ON pr.id = t.prestacion_id LEFT JOIN obras_sociales os ON os.id = t.obra_social_id WHERE t.id = ?`).bind(id).first<Detalle>()

const historial = (d: Pick<Detalle, 'veces' | 'faltas'>) =>
  d.veces === 0 ? 'Primera consulta' : `Ya vino ${d.veces === 1 ? '1 vez' : `${d.veces} veces`}${d.faltas ? ` · ${d.faltas === 1 ? '1 falta' : `${d.faltas} faltas`}` : ''}`

/** Qué recordatorios recibió: el correo automático 48 h antes y el WhatsApp que se manda con un toque. */
function recordatorioTexto(t: Pick<Detalle, 'recordatorios_baja' | 'recordatorio_whatsapp_en' | 'recordatorio_correo_en'>) {
  if (t.recordatorios_baja) return 'Pidió no recibir recordatorios'
  const hechos = [t.recordatorio_correo_en && 'por correo', t.recordatorio_whatsapp_en && 'por WhatsApp'].filter(Boolean)
  if (hechos.length) return `Ya se lo mandaste ${hechos.join(' y ')}`
  return 'Todavía no se lo mandaste'
}

const cuandoDe = (fecha: string, hora: string) => `${fechaLarga(fecha).toLowerCase()} · ${hora}`

// ---------- Vista ----------
const titulo = (vista: Vista, fecha: string) => {
  if (vista === 'dia') return fechaLarga(fecha)
  if (vista === 'mes') return `${MESES[Number(fecha.slice(5, 7)) - 1][0].toUpperCase()}${MESES[Number(fecha.slice(5, 7)) - 1].slice(1)} ${fecha.slice(0, 4)}`
  const l = lunesDe(fecha), f = sumarDias(l, 5)
  return `Semana del ${Number(l.slice(8))}${l.slice(5, 7) === f.slice(5, 7) ? '' : `/${Number(l.slice(5, 7))}`} al ${Number(f.slice(8))}/${Number(f.slice(5, 7))}`
}
const etiquetaDia = (f: string) => `${DIAS[new Date(f + 'T00:00:00Z').getUTCDay()].slice(0, 3)} ${Number(f.slice(8))}`
const may = (s: string) => s[0].toUpperCase() + s.slice(1)
const ETIQUETA_VISTA: Record<Vista, string> = { dia: 'Día', semana: 'Semana', mes: 'Mes' }

agenda.get('/agenda', async (c) => {
  const q = c.req.query()
  const { fecha: hoy, hora: ahora } = ahoraAR()
  const ahoraMin = aMinutos(ahora)
  const vista: Vista = (VISTAS as readonly string[]).includes(q.vista) ? (q.vista as Vista) : 'semana'
  const fecha = esFecha(q.fecha ?? '') ? q.fecha! : hoy
  const db = c.env.DB

  const consultorios = ((await db.prepare('SELECT id, nombre, modalidad FROM consultorios WHERE activo = 1 ORDER BY orden, nombre').all<Consultorio>()).results ?? [])
  const filtro = consultorios.find((x) => x.id === entero(q.consultorio))
  const elegidos = filtro ? [filtro] : consultorios
  const consultorio = filtro ? String(filtro.id) : 'todos'
  const volver = q.volver ? volverValido(q.volver, '') : ''
  const base: Q = { vista, fecha, consultorio, volver }

  const { desde, hasta } = rangoDe(vista, fecha)
  const [datos, todosLosTurnos] = await Promise.all([cargarAgenda(db, desde, hasta, ahoraISO()), turnosDelRango(db, desde, hasta)])
  const turnos = todosLosTurnos.filter((t) => !filtro || t.consultorio_id === filtro.id)

  // Mover: el turno que se está moviendo y, si ya eligió un hueco, a dónde.
  const moviendo = entero(q.mover) ? await leerDetalle(db, entero(q.mover)) : null
  const mueve = moviendo && moviendo.estado === 'confirmado' ? moviendo : null
  const datosLibres: DatosAgenda = mueve ? { ...datos, turnos: datos.turnos.filter((t) => t.id !== mueve.id) } : datos
  const [dc, df, dh] = (q.destino ?? '').split(',')
  const destino = mueve && entero(dc) && esFecha(df ?? '') && esHora(dh ?? '') ? { consultorio_id: entero(dc), fecha: df, hora: dh } : null

  const abierto = !mueve && entero(q.turno) ? await leerDetalle(db, entero(q.turno)) : null

  // Resumen en una línea
  const vivos = turnos.filter((t) => t.estado !== 'ausente')
  const sinConfirmar = vivos.filter((t) => t.estado === 'confirmado' && !t.confirmacion && t.fecha >= hoy).length
  const pedidos = turnos.filter((t) => t.estado === 'solicitado').length
  const aResolver = turnos.filter((t) => ['no_puede', 'pendiente'].includes(estadoMostrado(t, hoy, ahoraMin).clave)).length
  const resumen = [
    `${vivos.length} ${vivos.length === 1 ? 'turno' : 'turnos'}`, `${sinConfirmar} sin confirmar`, `${pedidos} ${pedidos === 1 ? 'pedido online' : 'pedidos online'}`, `${aResolver} para resolver`,
  ].join(' · ')

  const volverA = hoy === fecha || (vista === 'semana' && lunesDe(hoy) === lunesDe(fecha)) || (vista === 'mes' && hoy.slice(0, 7) === fecha.slice(0, 7))
    ? null : { dia: 'Volver a hoy', semana: 'Volver a esta semana', mes: 'Volver a este mes' }[vista]

  const duracion = mueve?.duracion_min ?? PASO_MIN
  const vistaDatos = { vista, fecha, hoy, ahoraMin, elegidos, datos: datosLibres, turnos, base, mueve, duracion, desde }

  return pagina(c, 'Agenda', (
    <>
      <div class="agenda-cabeza">
        <div class="columna-chica">
          <h1>{titulo(vista, fecha)}</h1>
          <p class="suave chico">{resumen}</p>
        </div>
        <div class="fila agenda-controles">
          <nav class="fila-marcas" aria-label="Vista">
            {VISTAS.map((v) => <a class="pastilla" href={url({ ...base, vista: v, mover: q.mover })} aria-current={v === vista ? 'true' : undefined}>{ETIQUETA_VISTA[v]}</a>)}
          </nav>
          <nav class="fila" aria-label="Fechas">
            <a class="redondo" href={url({ ...base, fecha: vecina(vista, fecha, -1), mover: q.mover })} aria-label="Anterior" title="Anterior"><Volver /></a>
            <a class="redondo" href={url({ ...base, fecha: vecina(vista, fecha, 1), mover: q.mover })} aria-label="Siguiente" title="Siguiente"><Flecha /></a>
            {volverA && <a class="boton borde" href={url({ ...base, fecha: hoy, mover: q.mover })}>{volverA}</a>}
          </nav>
        </div>
      </div>
      <nav class="fila-marcas" aria-label="Consultorio">
        <a class="pastilla" href={url({ ...base, consultorio: 'todos', mover: q.mover })} aria-current={!filtro ? 'true' : undefined}>Todos</a>
        {consultorios.map((x) => <a class="pastilla" href={url({ ...base, consultorio: String(x.id), mover: q.mover })} aria-current={filtro?.id === x.id ? 'true' : undefined}>{x.nombre}</a>)}
      </nav>
      {mueve && (
        <div class="aviso franja">
          <span>Moviendo el turno de {mueve.nombre} {mueve.apellido} · tenía {cuandoDe(mueve.fecha, mueve.hora)}. Tocá un hueco libre (en verde) de esta semana o de otra.</span>
          <a class="boton borde" href={volver || url({ ...base })}>No mover</a>
        </div>
      )}
      {moviendo && !mueve && <Aviso tipo="ambar">Ese turno ya no se puede mover.</Aviso>}
      {q.error && <Aviso tipo="error">{q.error.slice(0, 300)}</Aviso>}
      {vista === 'mes' ? <Mes {...vistaDatos} /> : <Tablero {...vistaDatos} />}
      {abierto && <VentanaTurno t={abierto} hoy={hoy} ahoraMin={ahoraMin} base={base} />}
      {mueve && destino && <VentanaMover t={mueve} destino={destino} consultorios={consultorios} base={base} datos={datosLibres} hoy={hoy} ahoraMin={ahoraMin} />}
      <div class="fila-marcas leyenda" aria-label="Colores">
        <Estado estado="confirmado" texto="Confirmó" /><Estado estado="sin_respuesta" texto="Sin respuesta" /><Estado estado="ausente" texto="No vino / no puede" />
        <Estado estado="atendido" texto="Atendido" /><Estado estado="solicitado" texto="Pedido online" /><span class="estado primera">Feriado</span>
      </div>
    </>
  ))
})

type VistaDatos = {
  vista: Vista; fecha: string; hoy: string; ahoraMin: number; elegidos: Consultorio[]; datos: DatosAgenda; turnos: TurnoAgenda[]; base: Q
  mueve: Detalle | null; duracion: number; desde: string
}

/** El día de cada consultorio mostrado, juntando el horario y viendo si el día entero está cerrado. */
function diaCombinado(d: VistaDatos, fecha: string) {
  const dias: Dia[] = d.elegidos.map((x) => diaDe(d.datos, x.id, fecha))
  const franjas = dias.flatMap((x) => x.franjas)
  const atienden = dias.filter((x) => x.franjas.length)
  const cerrado = atienden.length && atienden.every((x) => x.cerrado) ? atienden[0].cerrado : null
  // Huecos libres del día: la primera hora de cada consultorio que lo permita.
  const libres = new Map<string, number>()
  for (const [i, x] of dias.entries()) for (const h of huecos(x, d.duracion, d.hoy, d.ahoraMin)) if (!libres.has(h)) libres.set(h, d.elegidos[i].id)
  return { fecha, dias, franjas, cerrado, libres, parciales: dias.flatMap((x) => x.parciales) }
}

// ---------- Día y semana: el tablero ----------
function Tablero(d: VistaDatos) {
  const { vista, fecha, hoy, ahoraMin, base, mueve } = d
  const lunes = lunesDe(fecha)
  let fechas = vista === 'dia' ? [fecha] : [0, 1, 2, 3, 4, 5].map((i) => sumarDias(lunes, i))
  const domingo = sumarDias(lunes, 6)
  const conDomingo = vista === 'semana' && (d.turnos.some((t) => t.fecha === domingo) || d.datos.horarios.some((h) => h.dia === 7 && d.elegidos.some((e) => e.id === h.consultorio_id)))
  if (conDomingo) fechas = [...fechas, domingo]
  const dias = fechas.map((f) => diaCombinado(d, f))
  const { ini, fin, filas } = limitesDelTablero(dias.flatMap((x) => x.franjas), d.turnos.filter((t) => fechas.includes(t.fecha)))
  const fila = (min: number) => 2 + Math.floor((min - ini) / PASO_MIN)
  const columnas = fechas.length === 1 ? 'una' : fechas.length === 7 ? 'siete' : 'seis'

  const horas = []
  for (let m = ini; m < fin; m += 60) horas.push(<div class={`ag-hora ag-r${fila(m)} ag-s2 ag-c1`}><span>{aHora(m)}</span></div>)

  const celdas: Child[] = []
  dias.forEach((dia, i) => {
    const col = i + 2
    const esHoy = dia.fecha === hoy
    celdas.push(<div class={`ag-fondo ag-r2 ag-s${filas} ag-c${col}${esHoy ? ' hoy' : ''}`} aria-hidden="true" />)
    // Horas en que no atendés
    if (!dia.cerrado) {
      let desdeFila: number | null = null
      const cierra = (hastaFila: number) => {
        if (desdeFila === null) return
        const largo = hastaFila - desdeFila
        celdas.push(<div class={`ag-zona ag-r${desdeFila} ag-s${largo} ag-c${col}`} aria-hidden="true">{largo >= 4 ? 'No atendés' : ''}</div>)
        desdeFila = null
      }
      for (let m = ini; m < fin; m += PASO_MIN) {
        const dentro = dia.franjas.some((f) => m >= f.desde && m + PASO_MIN <= f.hasta)
        if (!dentro && desdeFila === null) desdeFila = fila(m)
        if (dentro) cierra(fila(m))
      }
      cierra(2 + filas)
      for (const p of dia.parciales) {
        celdas.push(<div class={`ag-zona bloqueo ag-r${fila(p.desde)} ag-s${Math.max(1, Math.ceil((p.hasta - p.desde) / PASO_MIN))} ag-c${col}`} aria-hidden="true">{p.quien}</div>)
      }
    } else {
      celdas.push(<div class={`ag-zona cerrado ${dia.cerrado.tipo} ag-r2 ag-s${filas} ag-c${col}`}>{dia.cerrado.tipo === 'feriado' ? `Feriado · ${dia.cerrado.texto}` : `Bloqueado · ${dia.cerrado.texto}`}</div>)
    }
    // Huecos libres: se tocan para dar un turno (o para mover uno)
    if (!dia.cerrado) {
      for (const [hora, cid] of dia.libres) {
        // Al mover, no se ofrece el lugar que ocupa el propio turno: queda tapado por él y no se puede tocar.
        if (mueve && mueve.fecha === dia.fecha && aMinutos(hora) < aMinutos(mueve.hora) + mueve.duracion_min && aMinutos(mueve.hora) < aMinutos(hora) + PASO_MIN) continue
        const href = mueve ? url({ ...base, mover: String(mueve.id), destino: `${cid},${dia.fecha},${hora}` })
          : `/turnos/nuevo?${new URLSearchParams({ consultorio: String(cid), fecha: dia.fecha, hora })}`
        celdas.push(<a class={`ag-hueco${mueve ? ' verde' : ''} ag-r${fila(aMinutos(hora))} ag-c${col}`} href={href} aria-label={`Hueco libre ${etiquetaDia(dia.fecha)} a las ${hora}`}><span aria-hidden="true">{hora}</span></a>)
      }
    }
    // Turnos
    const delDia = d.turnos.filter((t) => t.fecha === dia.fecha)
    delDia.forEach((t, j) => {
      const e = estadoMostrado(t, hoy, ahoraMin)
      const solapa = delDia.slice(0, j).some((o) => aMinutos(o.hora) < aMinutos(t.hora) + t.duracion_min && aMinutos(t.hora) < aMinutos(o.hora) + o.duracion_min)
      const largo = Math.min(16, Math.max(1, Math.ceil(t.duracion_min / PASO_MIN)))
      const clase = `ag-turno e-${e.clave}${solapa ? ' encima' : ''}${mueve?.id === t.id ? ' moviendo' : ''} ag-r${fila(aMinutos(t.hora))} ag-s${largo} ag-c${col}`
      const contenido = (
        <>
          <span class="t-hora">{t.hora}</span>
          <strong>{vista === 'dia' ? `${t.nombre} ${t.apellido}` : nombreCorto(t)}</strong>
          {vista === 'dia' && <span class="chico">{t.prestacion ? `${t.prestacion} · ` : ''}{t.consultorio} · {e.texto}</span>}
          {vista !== 'dia' && <span class="oculto-visual"> {e.texto}</span>}
        </>
      )
      celdas.push(mueve
        ? <div class={clase}>{contenido}</div>
        : <a class={clase} href={url({ ...base, turno: String(t.id) })} title={`${t.nombre} ${t.apellido} · ${t.hora} · ${e.texto}`}>{contenido}</a>)
    })
    // Hora actual
    if (esHoy && ahoraMin >= ini && ahoraMin < fin) celdas.push(<div class={`ag-ahora ag-r${fila(ahoraMin)} ag-c${col}`} aria-hidden="true" />)
  })

  return (
    <>
      <div class={`ag-tablero ${columnas}${vista === 'semana' ? ' solo-grande' : ''}`} role="region" aria-label={vista === 'dia' ? 'Turnos del día' : 'Turnos de la semana'}>
        <div class="ag-grilla">
          {dias.map((dia, i) => (
            <a class={`ag-cab ag-r1 ag-c${i + 2}${dia.fecha === hoy ? ' hoy' : ''}`} href={url({ ...base, vista: 'dia', fecha: dia.fecha, mover: mueve ? String(mueve.id) : undefined })} aria-current={dia.fecha === hoy ? 'date' : undefined}>
              <strong>{etiquetaDia(dia.fecha)}</strong>
              <span class="chico">{dia.cerrado ? (dia.cerrado.tipo === 'feriado' ? 'Feriado' : 'Bloqueado') : cuenta(d.turnos.filter((t) => t.fecha === dia.fecha && t.estado !== 'ausente').length)}</span>
            </a>
          ))}
          {horas}
          {celdas}
        </div>
      </div>
      {vista === 'semana' && <ListaSemana {...d} dias={dias.map((x) => x.fecha)} cerrados={dias.map((x) => x.cerrado)} />}
    </>
  )
}
const cuenta = (n: number) => (n ? `${n} ${n === 1 ? 'turno' : 'turnos'}` : 'Libre')

/** En el celular la semana no entra en una grilla: se lee día por día. */
function ListaSemana(d: VistaDatos & { dias: string[]; cerrados: (Dia['cerrado'])[] }) {
  return (
    <div class="ag-semana-lista solo-celular-bloque">
      {d.dias.map((f, i) => {
        const delDia = d.turnos.filter((t) => t.fecha === f)
        return (
          <Tarjeta titulo={`${may(fechaLarga(f))}`} accion={<a href={url({ ...d.base, vista: 'dia', fecha: f, mover: d.mueve ? String(d.mueve.id) : undefined })}>Ver el día</a>}>
            {d.cerrados[i] ? <p class="suave">{d.cerrados[i]!.tipo === 'feriado' ? `Feriado · ${d.cerrados[i]!.texto}` : `Bloqueado · ${d.cerrados[i]!.texto}`}</p>
              : delDia.length ? (
                <ul class="lista">
                  {delDia.map((t) => {
                    const e = estadoMostrado(t, d.hoy, d.ahoraMin)
                    const dentro = <><span class="hora">{t.hora}</span><span class="columna-chica"><strong>{t.nombre} {t.apellido}</strong><span class="chico suave">{t.prestacion ?? 'Turno'} · {t.consultorio}</span></span><Estado estado={e.clave === 'ahora' ? 'primera' : e.clave === 'confirmo' ? 'confirmado' : e.clave === 'no_puede' || e.clave === 'pendiente' ? 'debe' : e.clave} texto={e.texto} /></>
                    return <li>{d.mueve ? <div class="fila-enlace">{dentro}</div> : <a class="fila-enlace" href={url({ ...d.base, turno: String(t.id) })}>{dentro}</a>}</li>
                  })}
                </ul>
              ) : <p class="suave">Sin turnos.</p>}
            {d.mueve && !d.cerrados[i] && (
              <div class="fila-marcas">
                {[...diaCombinado(d, f).libres].map(([hora, cid]) => (
                  <a class="pastilla hueco verde-pastilla" href={url({ ...d.base, mover: String(d.mueve!.id), destino: `${cid},${f},${hora}` })} aria-label={`Hueco libre ${etiquetaDia(f)} a las ${hora}`}>{hora}</a>
                ))}
              </div>
            )}
          </Tarjeta>
        )
      })}
    </div>
  )
}

// ---------- Mes ----------
function Mes(d: VistaDatos) {
  const { hasta } = rangoDe('mes', d.fecha)
  const dias: string[] = []
  for (let f = d.desde; f <= hasta; f = sumarDias(f, 1)) dias.push(f)
  return (
    <div class="ag-mes" role="region" aria-label="Turnos del mes">
      {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((n) => <div class="ag-mes-cab">{n}</div>)}
      {dias.map((f) => {
        const dia = diaCombinado(d, f)
        const delDia = d.turnos.filter((t) => t.fecha === f && t.estado !== 'ausente')
        const libres = dia.cerrado ? 0 : dia.libres.size
        const ocupacion = delDia.length + libres ? Math.round((delDia.length / (delDia.length + libres)) * 10) : 0
        const pedido = delDia.some((t) => t.estado === 'solicitado')
        const fuera = f.slice(5, 7) !== d.fecha.slice(5, 7)
        const atiende = dia.franjas.length > 0
        return (
          <a class={`ag-mes-dia${fuera ? ' fuera' : ''}${f === d.hoy ? ' hoy' : ''}${dia.cerrado ? ` rayado ${dia.cerrado.tipo}` : ''}`} href={url({ ...d.base, vista: 'dia', fecha: f })}
            aria-label={`${fechaLarga(f)}: ${dia.cerrado ? (dia.cerrado.tipo === 'feriado' ? 'feriado' : 'bloqueado') : `${cuenta(delDia.length)}, ${libres} huecos libres`}`}>
            <strong>{Number(f.slice(8))}</strong>
            {pedido && <span class="punto-pedido" title="Pedido online" />}
            {delDia.length > 0 && <span class="punto-turnos" aria-hidden="true" />}
            {dia.cerrado ? <span class="chico">{dia.cerrado.tipo === 'feriado' ? 'Feriado' : 'Bloqueado'}</span> : atiende || delDia.length ? (
              <>
                <span class="chico">{cuenta(delDia.length)}</span>
                <span class="barra" aria-hidden="true"><span class={`ocup-${ocupacion}`} /></span>
                <span class="chico suave">{libres} {libres === 1 ? 'libre' : 'libres'}</span>
              </>
            ) : <span class="chico suave">No atendés</span>}
          </a>
        )
      })}
    </div>
  )
}

// ---------- Ventanas ----------
function VentanaAbierta({ id, titulo, sub, volver, children }: { id: string; titulo: string; sub?: string; volver: string; children: Child }) {
  return (
    <dialog id={id} class="ventana" open data-volver={volver} aria-labelledby={`${id}-titulo`}>
      <div class="ventana-cuerpo">
        <div class="ventana-cabeza">
          <div><h2 id={`${id}-titulo`}>{titulo}</h2>{sub && <p class="suave chico">{sub}</p>}</div>
          <a class="redondo" href={volver} data-cierra="" aria-label="Cerrar"><Cruz /></a>
        </div>
        {children}
      </div>
    </dialog>
  )
}

function VentanaTurno({ t, hoy, ahoraMin, base }: { t: Detalle; hoy: string; ahoraMin: number; base: Q }) {
  const e = estadoMostrado(t, hoy, ahoraMin)
  const volver = url(base)
  const abierto = t.estado === 'confirmado'
  const yaPaso = t.fecha <= hoy
  const accion = (ruta: string, texto: string, variante: 'oscuro' | 'borde' | 'peligro', pregunta?: string) => (
    <form method="post" action={`/turnos/${t.id}/${ruta}`} data-confirmar={pregunta}>
      <input type="hidden" name="volver" value={volver} />
      <Boton type="submit" variante={variante}>{texto}</Boton>
    </form>
  )
  return (
    <VentanaAbierta id="v-turno" titulo={`${t.nombre} ${t.apellido}`} sub={`${may(fechaLarga(t.fecha))} · ${t.hora} · ${t.consultorio}`} volver={volver}>
      <div class="fila-marcas">
        <Estado estado={CLAVE_ESTADO[e.clave] ?? 'gris'} texto={e.texto} />
        {t.veces === 0 && <Estado estado="primera" />}
        {t.incompleta === 1 && <Estado estado="incompleta" />}
      </div>
      <dl class="datos">
        <dt>Prestación</dt><dd>{t.prestacion ?? '—'} · {t.duracion_min} min</dd>
        <dt>Cobertura</dt><dd>{t.cobertura === 'obra_social' ? t.obra_social : 'Particular'}</dd>
        <dt>Historial</dt><dd>{historial(t)}</dd>
        <dt>Celular</dt><dd><a href={enlaceWhatsapp(t.celular)}>{t.celular}</a></dd>
        {t.modalidad === 'videollamada' && <><dt>Modalidad</dt><dd>Videollamada</dd></>}
        {abierto && t.fecha >= hoy && <><dt>Recordatorio</dt><dd>{recordatorioTexto(t)}</dd></>}
      </dl>
      {abierto && t.confirmacion === 'no_puedo' && <Aviso tipo="ambar">{t.nombre} avisó que no puede venir. Podés moverlo o cancelarlo.</Aviso>}
      {abierto && t.incompleta === 1 && <Aviso>La ficha está incompleta: se completa antes de la primera consulta.</Aviso>}
      <div class="ventana-pie entre">
        <div class="fila">
          <Boton href={`/pacientes/${t.paciente_id}`} variante="borde">Ver ficha</Boton>
          <Boton href={`/turnos/nuevo?paciente=${t.paciente_id}`} variante="borde">Darle otro turno</Boton>
          {t.estado === 'atendido' && <Boton href={`/cobros/nuevo?turno=${t.id}`} variante="borde" data-modulo="cobros">Cobrar</Boton>}
          {abierto && t.fecha >= hoy && !t.recordatorios_baja && (
            // Un enlace y no un formulario: la CSP («form-action 'self'») no deja que un formulario termine en wa.me. app.js lo anota.
            <a class="boton borde" href={enlaceWhatsapp(t.celular, textoRecordatorio(t.plantilla, t))} target="_blank" rel="noopener" data-anotar={`/turnos/${t.id}/recordatorio`}>Mandar recordatorio</a>
          )}
        </div>
        {abierto && (
          <div class="fila">
            {accion('cancelar', 'Cancelar y avisar', 'peligro', `¿Cancelar el turno de ${t.nombre}? Después te dejamos el mensaje listo para avisarle.`)}
            <Boton href={url({ ...base, mover: String(t.id) })} variante="borde">Mover</Boton>
            {yaPaso && accion('ausente', 'No vino', 'borde', `¿Marcar que ${t.nombre} no vino? No se puede deshacer.`)}
            {yaPaso && accion('atender', 'Atender', 'oscuro')}
          </div>
        )}
      </div>
    </VentanaAbierta>
  )
}

function VentanaMover({ t, destino, consultorios, base, datos, hoy, ahoraMin }: {
  t: Detalle; destino: { consultorio_id: number; fecha: string; hora: string }; consultorios: Consultorio[]; base: Q; datos: DatosAgenda; hoy: string; ahoraMin: number
}) {
  const seguir = url({ ...base, mover: String(t.id) })
  const lugar = consultorios.find((x) => x.id === destino.consultorio_id)
  const dia = diaDe(datos, destino.consultorio_id, destino.fecha)
  const control = lugar ? controlar(dia, destino.hora, t.duracion_min, hoy, ahoraMin) : { errores: ['Ese consultorio ya no está disponible.'], avisos: [] }
  const libre = !control.errores.length && !control.avisos.length
  return (
    <VentanaAbierta id="v-mover" titulo={`Mover el turno de ${t.nombre}`} sub={`Tenía ${cuandoDe(t.fecha, t.hora)}`} volver={seguir}>
      <p>Pasa a <strong>{cuandoDe(destino.fecha, destino.hora)}</strong>{lugar ? ` · ${lugar.nombre}` : ''}</p>
      {[...control.errores, ...control.avisos.map((a) => a.texto)].map((m) => <Aviso tipo="error">{m}</Aviso>)}
      <p class="suave chico">Después te dejamos el mensaje listo para avisarle por WhatsApp con el nuevo día y hora.</p>
      <div class="ventana-pie entre">
        <a class="boton texto" href={base.volver || url(base)}>No mover</a>
        <div class="fila">
          <Boton href={seguir} variante="borde">Elegir otro hueco</Boton>
          {libre && (
            <form method="post" action={`/turnos/${t.id}/mover`}>
              <input type="hidden" name="consultorio" value={destino.consultorio_id} />
              <input type="hidden" name="fecha" value={destino.fecha} />
              <input type="hidden" name="hora" value={destino.hora} />
              {base.volver && <input type="hidden" name="volver" value={base.volver} />}
              <Boton type="submit" variante="oscuro">Mover y avisar</Boton>
            </form>
          )}
        </div>
      </div>
    </VentanaAbierta>
  )
}

// ---------- Acciones sobre un turno ----------
agenda.post('/turnos/:id{[0-9]+}/atender', async (c) => {
  const id = Number(c.req.param('id'))
  const { fecha: hoy } = ahoraAR()
  const r = await c.env.DB.prepare("UPDATE turnos SET estado = 'atendido', cerrado_en = ?, actualizado_en = ? WHERE id = ? AND estado = 'confirmado' AND fecha <= ?")
    .bind(ahoraISO(), ahoraISO(), id, hoy).run()
  if (r.meta.changes) await registrar(c, 'turno_atendido', `turno:${id}`, c.get('email'))
  // La consulta la arma X2; si el turno ya estaba atendido, igual se abre.
  return c.redirect(`/consultas/nueva?turno=${id}`)
})

agenda.post('/turnos/:id{[0-9]+}/ausente', async (c) => {
  const id = Number(c.req.param('id'))
  const { fecha: hoy } = ahoraAR()
  const f = await c.req.parseBody()
  const r = await c.env.DB.prepare("UPDATE turnos SET estado = 'ausente', cerrado_en = ?, actualizado_en = ? WHERE id = ? AND estado = 'confirmado' AND fecha <= ?")
    .bind(ahoraISO(), ahoraISO(), id, hoy).run()
  if (r.meta.changes) await registrar(c, 'turno_ausente', `turno:${id}`, c.get('email'))
  const volver = volverValido(f.volver)
  return c.redirect(volver === '/' ? `/?ausente=${id}` : volver)
})

agenda.post('/turnos/:id{[0-9]+}/cancelar', async (c) => {
  const id = Number(c.req.param('id'))
  const volver = volverValido((await c.req.parseBody()).volver, '')
  const r = await c.env.DB.prepare("UPDATE turnos SET estado = 'cancelado', cancelado_por = 'profesional', cerrado_en = ?, actualizado_en = ? WHERE id = ? AND estado = 'confirmado'")
    .bind(ahoraISO(), ahoraISO(), id).run()
  if (!r.meta.changes) return c.redirect('/agenda')
  await c.env.DB.prepare("UPDATE propuestas SET estado = 'liberada' WHERE turno_id = ? AND estado = 'reservada'").bind(id).run()
  await registrar(c, 'turno_cancelado', `turno:${id}`, c.get('email'))
  return c.redirect(`/turnos/${id}/aviso?${new URLSearchParams({ que: 'cancelado', ...(volver && { volver }) })}`)
})

agenda.post('/turnos/:id{[0-9]+}/mover', async (c) => {
  const id = Number(c.req.param('id'))
  const f = await c.req.parseBody()
  const t = await leerDetalle(c.env.DB, id)
  const cid = entero(f.consultorio), fecha = typeof f.fecha === 'string' ? f.fecha : '', hora = typeof f.hora === 'string' ? f.hora : ''
  const { fecha: hoy, hora: ahora } = ahoraAR()
  const volver = volverValido(f.volver, '')
  const fallo = (mensaje: string) => c.redirect(`/agenda?${new URLSearchParams({ mover: String(id), error: mensaje, ...(volver && { volver }) })}`)
  if (!t || t.estado !== 'confirmado' || !cid || !esFecha(fecha) || !esHora(hora)) return fallo('No se pudo mover el turno.')
  const r = await moverTurno(c.env.DB, t, { consultorio_id: cid, fecha, hora }, hoy, aMinutos(ahora))
  if (r.error) return fallo(r.error)
  await registrar(c, 'turno_movido', `turno:${id} · ${t.fecha} ${t.hora} → ${fecha} ${hora}`, c.get('email'))
  return c.redirect(`/turnos/${id}/aviso?${new URLSearchParams({ que: 'movido', antes: `${t.fecha} ${t.hora}`, ...(volver && { volver }) })}`)
})

// ---------- Listo: el mensaje para avisarle ----------
agenda.get('/turnos/:id{[0-9]+}/aviso', async (c) => {
  const t = await leerDetalle(c.env.DB, Number(c.req.param('id')))
  if (!t) return c.notFound()
  const movido = c.req.query('que') === 'movido'
  if (!movido && t.estado !== 'cancelado') return c.redirect(volverValido(c.req.query('volver')))
  const antes = (c.req.query('antes') ?? '').split(' ')
  const viejo = esFecha(antes[0]) && esHora(antes[1] ?? '') ? cuandoDe(antes[0], antes[1]) : null
  const prof = await datosProfesional(c)
  const firma = prof.nombre ? ` ${prof.nombre}.` : ''
  const vuelta = volverValido(c.req.query('volver'))
  const aBloqueo = vuelta.startsWith('/bloqueos/')
  const mensaje = movido
    ? `Hola ${t.nombre}, ${viejo ? `tu turno del ${viejo} ` : 'tu turno '}pasó al ${cuandoDe(t.fecha, t.hora)} en ${t.consultorio}${t.direccion ? ` (${t.direccion})` : ''}.${firma} ¡Te esperamos!`
    : `Hola ${t.nombre}, tuvimos que cancelar tu turno del ${cuandoDe(t.fecha, t.hora)}.${firma} Escribinos y buscamos otro horario.`
  return pagina(c, movido ? 'Turno movido' : 'Turno cancelado', (
    <div class="angosto columna">
      <a class="volver" href={vuelta}><Volver />{aBloqueo ? 'Bloqueo' : vuelta === '/' ? 'Hoy' : 'Agenda'}</a>
      <h1>{movido ? 'Turno movido' : 'Turno cancelado'}</h1>
      <Tarjeta titulo={`${t.nombre} ${t.apellido}`}>
        <p>{movido ? <>Ahora es el <strong>{cuandoDe(t.fecha, t.hora)}</strong> · {t.consultorio}.</> : <>Se canceló el turno del {cuandoDe(t.fecha, t.hora)}.</>}</p>
        <p class="suave">Te dejamos el mensaje listo para avisarle por WhatsApp.</p>
        <div class="ventana-pie entre">
          <Boton href={`/turnos/nuevo?paciente=${t.paciente_id}`} variante="borde">{movido ? 'Darle otro turno' : 'Darle un turno nuevo'}</Boton>
          <div class="fila">
            <Boton href={vuelta} variante="borde">{aBloqueo ? 'Seguir con los turnos' : vuelta === '/' ? 'Volver a Hoy' : 'Volver a la agenda'}</Boton>
            <Boton href={enlaceWhatsapp(t.celular, mensaje)} variante="destacado">Avisarle por WhatsApp</Boton>
          </div>
        </div>
      </Tarjeta>
    </div>
  ))
})
