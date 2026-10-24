// P3 · Bloqueos de agenda, feriados con «¿Atendés?» y Hoy completo, contra la app real.
import { describe, it, expect, vi } from 'vitest'
import { entorno, CLAVE_PRUEBA } from './ayuda'
import { baseNueva } from '../base/base'
import { ahoraAR, sumarDias } from '../../src/lib/fechas'
import { diaDeSemana, type DatosAgenda } from '../../src/lib/turnos'
import { cuandoCorto, leerBloqueo, mensajeParaElegir, rangoCorto, sugerirHorarios } from '../../src/lib/bloqueos'
import { controlesPorAgendar, cuandoControl, duracionTxt, elegirAhora, type TurnoHoy } from '../../src/lib/hoy'
import { lunesDe } from '../../src/lib/agenda'
import { volverValido } from '../../src/rutas/agenda'

async function conSesion() {
  const e = entorno()
  await e.navegador.pedir('/ingresar/prueba', { form: { clave: CLAVE_PRUEBA } })
  return e
}
type Base = ReturnType<typeof entorno>['db']
const todos = (db: Base, sql: string, ...args: any[]) => db.prepare(sql).all(...args) as any[]
const proximo = (dia: number, desde = 7) => { let f = sumarDias(ahoraAR().fecha, desde); while (diaDeSemana(f) !== dia) f = sumarDias(f, 1); return f }
const { fecha: HOY } = ahoraAR()
const error = (r: Response) => new URL(r.headers.get('location')!, 'http://x').searchParams.get('error') ?? ''
const turno = (db: Base, paciente: number, fecha: string, hora: string, extra = '') =>
  Number(db.prepare(`INSERT INTO turnos (paciente_id, consultorio_id, fecha, hora, duracion_min, prestacion_id, atencion${extra ? ', ' + extra.split('=')[0] : ''}) VALUES (?, 1, ?, ?, 30, 2, 'control'${extra ? ', ' + extra.split('=')[1] : ''})`).run(paciente, fecha, hora).lastInsertRowid)

describe('Armar el bloqueo', () => {
  it('pide fechas válidas, no pasadas, y horas en orden', () => {
    const f = { desde: '2030-01-07', hasta: '2030-01-11', alcance: 'dia', consultorio: 'todos', motivo: 'congreso' }
    expect(leerBloqueo(f, '2030-01-01').datos).toEqual({ desde: '2030-01-07', hasta: '2030-01-11', hora_desde: null, hora_hasta: null, consultorio_id: null, motivo: 'congreso' })
    expect(leerBloqueo({ ...f, hasta: '2030-01-06' }, '2030-01-01').error).toContain('antes')
    expect(leerBloqueo(f, '2030-02-01').error).toContain('ya pasaron')
    expect(leerBloqueo({ ...f, desde: 'x' }, '2030-01-01').error).toContain('Elegí')
    expect(leerBloqueo({ ...f, desde: '2030-99-99' }, '2030-01-01').error).toContain('Elegí')
    expect(leerBloqueo({ ...f, motivo: '__proto__' }, '2030-01-01').error).toContain('motivo')
    expect(leerBloqueo({ ...f, hasta: '2032-01-01' }, '2030-01-01').error).toContain('un año')
    expect(leerBloqueo({ ...f, motivo: 'viaje' }, '2030-01-01').error).toContain('motivo')
    expect(leerBloqueo({ ...f, alcance: 'franja', hora_desde: '15:00', hora_hasta: '13:00' }, '2030-01-01').error).toContain('después')
    expect(leerBloqueo({ ...f, alcance: 'franja', hora_desde: '13:00', hora_hasta: '15:00', consultorio: '2', motivo: '' }, '2030-01-01').datos)
      .toMatchObject({ hora_desde: '13:00', hora_hasta: '15:00', consultorio_id: 2, motivo: null })
  })
  it('los textos cortos salen como en la maqueta', () => {
    expect(rangoCorto('2030-11-10', '2030-11-14')).toBe('10 al 14/11')
    expect(rangoCorto('2030-10-30', '2030-11-03')).toBe('30/10 al 3/11')
    expect(rangoCorto('2030-11-10', '2030-11-10')).toBe('10/11')
    expect(cuandoCorto('2030-01-07', '09:00')).toBe('lun 7/1 · 9:00')
  })
})

describe('Horarios sugeridos', () => {
  const datos = (cambios: Partial<DatosAgenda> = {}): DatosAgenda => ({
    horarios: [{ consultorio_id: 1, dia: 1, desde: '08:00', hasta: '12:00' }, { consultorio_id: 1, dia: 3, desde: '08:00', hasta: '12:00' }],
    turnos: [], propuestas: [], feriados: [], bloqueos: [{ desde: '2030-01-07', hasta: '2030-01-07', hora_desde: null, hora_hasta: null, consultorio_id: null, motivo: 'congreso', detalle: null }], ...cambios,
  })
  it('un horario por día, de los primeros días con lugar, lo más cerca de la hora de siempre', () => {
    expect(sugerirHorarios(datos(), 1, 30, '2030-01-07', '11:00', '2029-01-01', 0)).toEqual([
      { fecha: '2030-01-09', hora: '11:00' }, { fecha: '2030-01-14', hora: '11:00' }, { fecha: '2030-01-16', hora: '11:00' },
    ])
  })
  it('esquiva lo ocupado y busca el hueco más cercano; sin lugar devuelve menos', () => {
    const ocupado = datos({ turnos: [{ id: 9, fecha: '2030-01-09', hora: '11:00', duracion_min: 30, paciente: 'X' }] })
    expect(sugerirHorarios(ocupado, 1, 30, '2030-01-07', '11:00', '2029-01-01', 0, 1)).toEqual([{ fecha: '2030-01-09', hora: '10:30' }])
    expect(sugerirHorarios(datos(), 1, 30, '2030-01-07', '11:00', '2029-01-01', 0, 3, 3)).toEqual([{ fecha: '2030-01-09', hora: '11:00' }])
  })
  it('arma el mensaje con las opciones numeradas', () => {
    expect(mensajeParaElegir('Ana', 'lun 7/1 · 9:00', ['mié 9/1 · 9:00', 'vie 11/1 · 9:00'], ' Julia.')).toBe(
      'Hola Ana, tuvimos que mover tu turno del lun 7/1 · 9:00. ¿Cuál de estos horarios te queda mejor? 1) mié 9/1 · 9:00 · 2) vie 11/1 · 9:00. Respondeme con el número. Julia. ¡Gracias!')
  })
})

describe('Bloquear y resolver turno por turno', () => {
  const bloquear = async (e: Awaited<ReturnType<typeof conSesion>>, cambios: Record<string, string> = {}) => {
    const lunes = proximo(1)
    const r = await e.navegador.pedir('/bloqueos', { form: { desde: lunes, hasta: lunes, alcance: 'dia', consultorio: 'todos', motivo: 'congreso', ...cambios } })
    return { lunes, r, id: Number(/\/bloqueos\/(\d+)/.exec(r.headers.get('location') ?? '')?.[1]) }
  }

  it('avisa cuántos turnos caen adentro y, al bloquear, lleva a resolverlos', async () => {
    const e = await conSesion()
    const lunes = proximo(1)
    turno(e.db, 1, lunes, '09:00'); turno(e.db, 2, lunes, '17:00')
    const antes = await (await e.navegador.pedir(`/bloqueos/nuevo?desde=${lunes}&hasta=${lunes}`)).text()
    expect(antes).toContain('Ya tenés 2 turnos en esos días')
    expect(antes).toContain('Bloquear el ')
    const { r, id } = await bloquear(e)
    expect(r.status).toBe(302)
    expect(todos(e.db, 'SELECT desde, hasta, motivo, consultorio_id FROM bloqueos')).toEqual([{ desde: lunes, hasta: lunes, motivo: 'congreso', consultorio_id: null }])
    const lista = await (await e.navegador.pedir(`/bloqueos/${id}`)).text()
    expect(lista).toContain('Faltan resolver 2 turnos')
    expect(lista).toContain('Tomás Ferreyra')
    expect(lista).toContain('Ana Gómez')
    expect(lista).toContain('Agenda bloqueada')
    expect(lista).toContain('congreso')
    // el bloqueo no cancela nada solo
    expect(todos(e.db, "SELECT 1 FROM turnos WHERE fecha = ? AND estado = 'confirmado'", lunes).length).toBe(2)
    expect(todos(e.db, "SELECT 1 FROM auditoria WHERE evento = 'bloqueo_creado'").length).toBe(1)
  })

  it('una franja de un consultorio solo alcanza a los turnos de esas horas y ese lugar', async () => {
    const e = await conSesion()
    const lunes = proximo(1)
    turno(e.db, 1, lunes, '09:30'); turno(e.db, 2, lunes, '11:00')
    const url = `/bloqueos/nuevo?desde=${lunes}&hasta=${lunes}&alcance=franja&hora_desde=09:00&hora_hasta=10:00&consultorio=1`
    const html = await (await e.navegador.pedir(url)).text()
    expect(html).toContain('Ya tenés 1 turno en esas horas')
    const { id } = await bloquear(e, { alcance: 'franja', hora_desde: '09:00', hora_hasta: '10:00', consultorio: '1', motivo: '' })
    const lista = await (await e.navegador.pedir(`/bloqueos/${id}`)).text()
    expect(lista).toContain('Falta resolver 1 turno')
    expect(lista).toContain('Tomás Ferreyra')
    expect(lista).not.toContain('Ana Gómez')
    const otroLugar = await (await e.navegador.pedir(`/bloqueos/nuevo?desde=${lunes}&hasta=${lunes}&consultorio=2`)).text()
    expect(otroLugar).toContain('No tenés turnos en esos días')
  })

  it('no deja bloquear con datos malos y vuelve al formulario con el motivo', async () => {
    const e = await conSesion()
    const r = await e.navegador.pedir('/bloqueos', { form: { desde: proximo(1), hasta: sumarDias(proximo(1), -1), alcance: 'dia', consultorio: 'todos' } })
    expect(r.headers.get('location')).toContain('/bloqueos/nuevo?')
    const html = await (await e.navegador.pedir(r.headers.get('location')!)).text()
    expect(html).toContain('no puede ser antes')
    const noExiste = await e.navegador.pedir('/bloqueos', { form: { desde: proximo(1), hasta: proximo(1), alcance: 'dia', consultorio: '99' } })
    expect(error(noExiste)).toContain('no está disponible')
    expect(todos(e.db, 'SELECT 1 FROM bloqueos').length).toBe(0)
  })

  it('Mover ofrece 3 horarios, mueve el elegido y deja el aviso con la vuelta a la lista', async () => {
    const e = await conSesion()
    const lunes = proximo(1)
    const t1 = turno(e.db, 1, lunes, '09:00'); turno(e.db, 2, lunes, '17:00')
    const { id } = await bloquear(e)
    const panel = await (await e.navegador.pedir(`/bloqueos/${id}?mover=${t1}`)).text()
    expect(panel).toContain('Primeros huecos libres después del bloqueo')
    expect(panel).toContain('Otro día en la agenda')
    expect(panel).toContain('Que elija el paciente')
    expect(panel).toContain('Elegí un horario')
    const sugeridos = [...panel.matchAll(/elegido=1%2C(\d{4}-\d{2}-\d{2})%2C(\d\d)%3A(\d\d)/g)].map((m) => [m[1], `${m[2]}:${m[3]}`])
    expect(sugeridos.length).toBe(3)
    expect(sugeridos[0]).toEqual([sumarDias(lunes, 2), '09:00'])
    const elegido = await (await e.navegador.pedir(`/bloqueos/${id}?mover=${t1}&elegido=1,${sugeridos[0][0]},${sugeridos[0][1]}`)).text()
    expect(elegido).toContain('y avisar')
    expect(elegido).toContain(`Mover al ${cuandoCorto(sugeridos[0][0], sugeridos[0][1])}`)
    const r = await e.navegador.pedir(`/bloqueos/${id}/mover`, { form: { turno: String(t1), consultorio: '1', fecha: sugeridos[0][0], hora: sugeridos[0][1] } })
    expect(r.status).toBe(302)
    expect(r.headers.get('location')).toContain(`/turnos/${t1}/aviso?que=movido`)
    expect(r.headers.get('location')).toContain(`volver=%2Fbloqueos%2F${id}`)
    expect(todos(e.db, 'SELECT fecha, hora, confirmacion FROM turnos WHERE id = ?', t1)[0]).toEqual({ fecha: sugeridos[0][0], hora: sugeridos[0][1], confirmacion: null })
    const aviso = await (await e.navegador.pedir(r.headers.get('location')!)).text()
    expect(aviso).toContain('Seguir con los turnos')
    expect(aviso).toContain(`href="/bloqueos/${id}"`)
    expect(aviso).toContain('https://wa.me/')
    expect(await (await e.navegador.pedir(`/bloqueos/${id}`)).text()).toContain('Falta resolver 1 turno')
  })

  it('no mueve un turno que ya no está en el bloqueo ni a un horario ocupado', async () => {
    const e = await conSesion()
    const lunes = proximo(1)
    const t1 = turno(e.db, 1, lunes, '09:00')
    const { id } = await bloquear(e)
    const miercoles = sumarDias(lunes, 2)
    turno(e.db, 2, miercoles, '09:00')
    const ocupado = await e.navegador.pedir(`/bloqueos/${id}/mover`, { form: { turno: String(t1), consultorio: '1', fecha: miercoles, hora: '09:00' } })
    expect(error(ocupado)).toContain('Se superpone')
    expect(todos(e.db, 'SELECT fecha FROM turnos WHERE id = ?', t1)[0].fecha).toBe(lunes)
    const ajeno = await e.navegador.pedir(`/bloqueos/${id}/mover`, { form: { turno: '9999', consultorio: '1', fecha: miercoles, hora: '10:00' } })
    expect(error(ajeno)).toContain('ya no está en el bloqueo')
  })

  it('«Que elija el paciente» reserva 3 horarios y deja el WhatsApp; al elegir, el turno se mueve y los otros se liberan', async () => {
    const e = await conSesion()
    const lunes = proximo(1)
    const t2 = turno(e.db, 2, lunes, '17:00')
    const { id } = await bloquear(e)
    const r = await e.navegador.pedir(`/bloqueos/${id}/proponer`, { form: { turno: String(t2) } })
    expect(r.status).toBe(302)
    const props = todos(e.db, "SELECT id, fecha, hora, estado, vence_en FROM propuestas WHERE turno_id = ? ORDER BY fecha", t2)
    expect(props.length).toBe(3)
    expect(props.every((p) => p.estado === 'reservada')).toBe(true)
    for (const p of props) expect(p.vence_en).toBe(new Date(`${p.fecha}T${p.hora}:00-03:00`).toISOString().replace('.000Z','Z'))
    const lista = await (await e.navegador.pedir(`/bloqueos/${id}`)).text()
    expect(lista).toContain('Todo resuelto')
    expect(lista).toContain('Eligió el')
    expect(lista).toContain('https://wa.me/5493432222222?text=')
    // mientras tanto esos huecos no se ofrecen a nadie más
    const ocupa = await (await e.navegador.pedir(`/turnos/nuevo?paciente=1&consultorio=1&fecha=${props[0].fecha}`)).text()
    expect(ocupa).not.toContain(`hora=${props[0].hora}`)
    // una segunda vez no duplica
    await e.navegador.pedir(`/bloqueos/${id}/proponer`, { form: { turno: String(t2) } })
    expect(todos(e.db, 'SELECT 1 FROM propuestas WHERE turno_id = ?', t2).length).toBe(3)
    const elegir = await e.navegador.pedir(`/bloqueos/${id}/elegir`, { form: { turno: String(t2), propuesta: String(props[1].id) } })
    expect(elegir.headers.get('location')).toContain(`/turnos/${t2}/aviso?que=movido`)
    expect(todos(e.db, 'SELECT fecha, hora FROM turnos WHERE id = ?', t2)[0]).toEqual({ fecha: props[1].fecha, hora: props[1].hora })
    expect(todos(e.db, 'SELECT estado FROM propuestas WHERE turno_id = ? ORDER BY fecha', t2).map((p) => p.estado)).toEqual(['liberada', 'elegida', 'liberada'])
    const otra = await e.navegador.pedir(`/bloqueos/${id}/elegir`, { form: { turno: String(t2), propuesta: String(props[0].id) } })
    expect(otra.headers.get('location')).toContain('/bloqueos/')
  })

  it('si el destino se bloqueó después de ofrecerlo, elegir no mueve ni libera las reservas', async () => {
    const e=await conSesion(),lunes=proximo(1),tid=turno(e.db,2,lunes,'17:00')
    const {id}=await bloquear(e)
    await e.navegador.pedir(`/bloqueos/${id}/proponer`,{form:{turno:String(tid)}})
    const props=todos(e.db,'SELECT id,fecha FROM propuestas WHERE turno_id=? ORDER BY fecha',tid)
    e.db.prepare('INSERT INTO bloqueos(desde,hasta) VALUES (?,?)').run(props[0].fecha,props[0].fecha)
    const r=await e.navegador.pedir(`/bloqueos/${id}/elegir`,{form:{turno:String(tid),propuesta:String(props[0].id)}})
    expect(error(r)).toContain('bloqueada')
    expect(todos(e.db,'SELECT fecha FROM turnos WHERE id=?',tid)[0].fecha).toBe(lunes)
    expect(todos(e.db,"SELECT id FROM propuestas WHERE turno_id=? AND estado='reservada'",tid)).toHaveLength(3)
  })

  it('una franja propone horarios después de terminar el bloqueo, aunque haya huecos anteriores más cercanos', async () => {
    const e=await conSesion(),lunes=proximo(1),tid=turno(e.db,2,lunes,'09:00')
    const {id}=await bloquear(e,{alcance:'franja',hora_desde:'09:00',hora_hasta:'11:00'})
    await e.navegador.pedir(`/bloqueos/${id}/proponer`,{form:{turno:String(tid)}})
    const props=todos(e.db,'SELECT fecha,hora FROM propuestas WHERE turno_id=? ORDER BY fecha',tid)
    expect(props).toHaveLength(3)
    expect(props[0]).toEqual({fecha:lunes,hora:'11:00'})
  })

  it('permite resolver una propuesta cuando el paciente contesta después de la fecha bloqueada',async()=>{
    const e=await conSesion(),lunes=proximo(1),tid=turno(e.db,2,lunes,'17:00')
    const {id}=await bloquear(e)
    await e.navegador.pedir(`/bloqueos/${id}/proponer`,{form:{turno:String(tid)}})
    const propuesta=todos(e.db,'SELECT id,fecha FROM propuestas WHERE turno_id=? ORDER BY fecha',tid)[0]
    vi.useFakeTimers({toFake:['Date']})
    try {
      vi.setSystemTime(new Date(`${sumarDias(lunes,1)}T12:00:00-03:00`))
      await e.navegador.pedir('/ingresar/prueba',{form:{clave:CLAVE_PRUEBA}})
      const lista=await(await e.navegador.pedir(`/bloqueos/${id}`)).text()
      expect(lista).toContain('Eligió el')
      expect(await(await e.navegador.pedir('/')).text()).toContain(`href="/bloqueos/${id}"`)
      expect(await(await e.navegador.pedir('/bloqueos/nuevo')).text()).toContain(`action="/bloqueos/${id}/quitar"`)
      const r=await e.navegador.pedir(`/bloqueos/${id}/elegir`,{form:{turno:String(tid),propuesta:String(propuesta.id)}})
      expect(r.headers.get('location')).toContain(`/turnos/${tid}/aviso?que=movido`)
      expect(todos(e.db,'SELECT fecha FROM turnos WHERE id=?',tid)[0].fecha).toBe(propuesta.fecha)
    } finally {vi.useRealTimers()}
  })

  it('si los horarios vencen, el turno vuelve a quedar por resolver', async () => {
    const e = await conSesion()
    const lunes = proximo(1)
    const t2 = turno(e.db, 2, lunes, '17:00')
    const { id } = await bloquear(e)
    await e.navegador.pedir(`/bloqueos/${id}/proponer`, { form: { turno: String(t2) } })
    e.db.exec("UPDATE propuestas SET vence_en = '2020-01-01T00:00:00Z'")
    expect(await (await e.navegador.pedir(`/bloqueos/${id}`)).text()).toContain('Falta resolver 1 turno')
  })

  it('Cancelar y avisar vuelve a la lista, libera lo reservado y no acepta vueltas a sitios de afuera', async () => {
    const e = await conSesion()
    const lunes = proximo(1)
    const t1 = turno(e.db, 1, lunes, '09:00')
    const { id } = await bloquear(e)
    await e.navegador.pedir(`/bloqueos/${id}/proponer`, { form: { turno: String(t1) } })
    const afuera = await e.navegador.pedir(`/turnos/${t1}/cancelar`, { form: { volver: '//evil.example' } })
    expect(afuera.headers.get('location')).not.toContain('evil')
    expect(todos(e.db, 'SELECT estado FROM turnos WHERE id = ?', t1)[0].estado).toBe('cancelado')
    expect(todos(e.db, "SELECT 1 FROM propuestas WHERE turno_id = ? AND estado = 'reservada'", t1).length).toBe(0)
    const t2 = turno(e.db, 2, lunes, '17:00')
    const r = await e.navegador.pedir(`/turnos/${t2}/cancelar`, { form: { volver: `/bloqueos/${id}` } })
    expect(r.headers.get('location')).toContain(`volver=%2Fbloqueos%2F${id}`)
    const aviso = await (await e.navegador.pedir(r.headers.get('location')!)).text()
    expect(aviso).toContain('Turno cancelado')
    expect(aviso).toContain('Seguir con los turnos')
    expect(await (await e.navegador.pedir(`/bloqueos/${id}`)).text()).toContain('Todo resuelto')
  })

  it('un bloqueo se quita (no se borra) y el hueco vuelve a ofrecerse', async () => {
    const e = await conSesion()
    const lunes = proximo(1)
    const { id } = await bloquear(e)
    const cerrado = await (await e.navegador.pedir(`/turnos/nuevo?paciente=1&consultorio=1&fecha=${lunes}`)).text()
    expect(cerrado).toContain('Esta fecha está bloqueada (Congreso)')
    expect(cerrado).toContain('Ver o quitar bloqueos')
    const vigentes = await (await e.navegador.pedir('/bloqueos/nuevo')).text()
    expect(vigentes).toContain('Bloqueos vigentes')
    const r = await e.navegador.pedir(`/bloqueos/${id}/quitar`, { form: {} })
    expect(r.headers.get('location')).toBe('/bloqueos/nuevo?quitado=1')
    expect(todos(e.db, 'SELECT quitado_en FROM bloqueos WHERE id = ?', id)[0].quitado_en).not.toBeNull()
    expect(await (await e.navegador.pedir(`/turnos/nuevo?paciente=1&consultorio=1&fecha=${lunes}`)).text()).toContain('class="pastilla hueco"')
    expect(await (await e.navegador.pedir(`/bloqueos/${id}`)).text()).toContain('se quitó')
    expect((await e.navegador.pedir('/bloqueos/9999')).status).toBe(404)
  })

  it('«Bloquear este horario» llega desde Dar turno con el horario cargado', async () => {
    const e = await conSesion()
    const lunes = proximo(1)
    const paso3 = await (await e.navegador.pedir(`/turnos/nuevo?paciente=1&consultorio=1&prestacion=2&fecha=${lunes}&hora=10:00`)).text()
    expect(paso3).toContain('Bloquear este horario')
    expect(paso3).toContain(`desde=${lunes}&amp;hasta=${lunes}&amp;alcance=franja&amp;hora_desde=10%3A00&amp;hora_hasta=10%3A30`)
    const form = await (await e.navegador.pedir(`/bloqueos/nuevo?desde=${lunes}&hasta=${lunes}&alcance=franja&hora_desde=10:00&hora_hasta=10:30&consultorio=1`)).text()
    expect(form).toContain('value="10:00"')
    expect(form).toContain('value="10:30"')
  })

  it('pide sesión y respeta el módulo de agenda', async () => {
    const { navegador } = entorno()
    expect((await navegador.pedir('/bloqueos/nuevo')).status).toBe(302)
    const sin = entorno({ MODULOS: 'documentos' })
    await sin.navegador.pedir('/ingresar/prueba', { form: { clave: CLAVE_PRUEBA } })
    expect((await sin.navegador.pedir('/bloqueos/nuevo')).status).toBe(404)
  })
})

describe('Feriados', () => {
  it('muestra los próximos con la cantidad de turnos y guarda si atendés o no', async () => {
    const e = await conSesion()
    const lunes = proximo(1)
    e.db.prepare("INSERT INTO feriados (fecha, nombre) VALUES (?, 'Feriado de prueba')").run(lunes)
    turno(e.db, 1, lunes, '09:00')
    const html = await (await e.navegador.pedir('/bloqueos/nuevo')).text()
    expect(html).toContain('Próximos feriados')
    expect(html).toContain('Feriado de prueba · tenés 1 turno')
    expect(html).toContain('¿Atendés?')
    expect(html).toContain(`/agenda?vista=dia&amp;fecha=${lunes}`)
    await e.navegador.pedir('/bloqueos/feriado', { form: { fecha: lunes, atiende: '1' } })
    expect(todos(e.db, 'SELECT atiende FROM feriados WHERE fecha = ?', lunes)[0].atiende).toBe(1)
    await e.navegador.pedir('/bloqueos/feriado', { form: { fecha: lunes, atiende: '0' } })
    expect(todos(e.db, 'SELECT atiende FROM feriados WHERE fecha = ?', lunes)[0].atiende).toBe(0)
    await e.navegador.pedir('/bloqueos/feriado', { form: { fecha: lunes, atiende: '7' } })
    expect(todos(e.db, 'SELECT atiende FROM feriados WHERE fecha = ?', lunes)[0].atiende).toBe(0)
    expect(todos(e.db, "SELECT 1 FROM auditoria WHERE evento IN ('feriado_atiende', 'feriado_no_atiende')").length).toBe(2)
  })
  it('los feriados nacionales de 2026 vienen cargados sin decidir, con sus fines de semana largos', () => {
    const db = baseNueva()
    const f = db.prepare('SELECT fecha, nombre, atiende FROM feriados ORDER BY fecha').all() as { fecha: string; nombre: string; atiende: number | null }[]
    expect(f.length).toBe(19)
    expect(f.every((x) => x.atiende === null && x.fecha.startsWith('2026-'))).toBe(true)
    expect(f.map((x) => x.fecha)).toEqual(expect.arrayContaining(['2026-01-01', '2026-05-25', '2026-07-09', '2026-11-23', '2026-12-25']))
  })
})

describe('Hoy', () => {
  const turnoHoy = (cambios: Partial<TurnoHoy>): TurnoHoy => ({
    id: 1, fecha: HOY, hora: '10:00', duracion_min: 30, estado: 'confirmado', confirmacion: null, paciente_id: 1, nombre: 'Ana', apellido: 'Gómez', prestacion: 'Control',
    consultorio: 'Centro', modalidad: 'presencial', cobertura: 'particular', obra_social: null, incompleta: 0, primera: 0, consulta_id: null, consulta_estado: null, ...cambios,
  })
  it('«Ahora» es la consulta abierta, el turno que pasa, el que sigue o el que quedó sin resolver', () => {
    const min = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3))
    const a = turnoHoy({ id: 1, hora: '09:00' }), b = turnoHoy({ id: 2, hora: '10:00' }), c = turnoHoy({ id: 3, hora: '11:00' })
    expect(elegirAhora([], min('10:00'))).toBeNull()
    expect(elegirAhora([a, b, c], min('10:10'))).toMatchObject({ tipo: 'curso', turno: { id: 2 }, cuando: 'Empezó hace 10 minutos' })
    expect(elegirAhora([a, b, c], min('10:45'))).toMatchObject({ tipo: 'proximo', turno: { id: 3 }, cuando: 'En 15 minutos' })
    expect(elegirAhora([a, b, c], min('08:00'))).toMatchObject({ tipo: 'proximo', turno: { id: 1 }, cuando: 'En 1 h' })
    expect(elegirAhora([a, b], min('12:00'))).toMatchObject({ tipo: 'sin_resolver', turno: { id: 1 }, cuando: 'Era a las 09:00' })
    expect(elegirAhora([turnoHoy({ id: 4, estado: 'atendido', consulta_estado: 'borrador', consulta_id: 7 }), b], min('10:10'))).toMatchObject({ tipo: 'consulta', turno: { id: 4 } })
    expect(elegirAhora([turnoHoy({ id: 4, estado: 'atendido' }), b], min('10:10'))).toMatchObject({ tipo: 'consulta' })
    expect(elegirAhora([turnoHoy({ id: 4, estado: 'atendido', consulta_estado: 'finalizada', consulta_id: 7 })], min('10:10'))).toBeNull()
    expect(duracionTxt(1)).toBe('1 minuto')
    expect(duracionTxt(80)).toBe('1 h 20 min')
  })
  it('un control vencido se marca; uno futuro dice la semana', () => {
    expect(cuandoControl('2030-10-15', '2030-10-23')).toEqual({ texto: 'Venció el 15/10', vencido: true })
    expect(cuandoControl('2030-11-05', '2030-10-23')).toEqual({ texto: 'Semana del 4/11', vencido: false })
  })
  it('a Hoy se vuelve solo desde sitios propios', () => {
    expect(volverValido('/')).toBe('/')
    expect(volverValido('/agenda?vista=dia')).toBe('/agenda?vista=dia')
    expect(volverValido('/bloqueos/12')).toBe('/bloqueos/12')
    expect(volverValido('/bloqueos/12?mover=3&elegido=1,2030-01-09,09:00')).toBe('/bloqueos/12?mover=3&elegido=1,2030-01-09,09:00')
    for (const mal of ['//evil.example', 'https://evil.example', '/bloqueos/x', '/bloqueos/12/../../x', undefined, 5]) expect(volverValido(mal)).toBe('/agenda')
  })

  it('muestra el turno que sigue con Atender y No vino, y la lista del día', async () => {
    const e = await conSesion()
    // Los turnos de hoy de los datos ficticios (9:30, 10:30, 11:30) se cierran como ausentes para que el resultado
    // no dependa de la hora en que corre la prueba: el único abierto es el de las 23:30.
    e.db.prepare("UPDATE turnos SET estado = 'ausente', cerrado_en = '2026-01-01T00:00:00Z' WHERE fecha = ? AND estado = 'confirmado'").run(HOY)
    const t = turno(e.db, 2, HOY, '23:30')
    const html = await (await e.navegador.pedir('/')).text()
    expect(html).toContain('aria-label="Ahora"')
    expect(html).toContain(`action="/turnos/${t}/atender"`)
    expect(html).toContain(`action="/turnos/${t}/ausente"`)
    expect(html).toContain('No vino')
    expect(html).toContain('Controles por agendar')
    expect(html).toContain('Tomás Ferreyra')
    // No vino deja el turno cerrado y avisa en Hoy
    const r = await e.navegador.pedir(`/turnos/${t}/ausente`, { form: { volver: '/' } })
    expect(r.headers.get('location')).toBe(`/?ausente=${t}`)
    expect(todos(e.db, 'SELECT estado FROM turnos WHERE id = ?', t)[0].estado).toBe('ausente')
    const despues = await (await e.navegador.pedir(r.headers.get('location')!)).text()
    expect(despues).toContain('quedó como ausente')
    expect(despues).toContain('Darle otro turno')
  })

  it('«Para resolver» junta lo que pide una decisión', async () => {
    const e = await conSesion()
    const lunes = proximo(1)
    const t = turno(e.db, 4, sumarDias(HOY, 3), '10:00', "confirmacion='no_puedo'")
    e.db.prepare("INSERT INTO feriados (fecha, nombre) VALUES (?, 'Feriado de prueba')").run(sumarDias(HOY, 10))
    const bloqueo = Number(e.db.prepare("INSERT INTO bloqueos (desde, hasta, motivo) VALUES (?, ?, 'congreso')").run(lunes, lunes).lastInsertRowid)
    turno(e.db, 1, lunes, '09:00')
    const html = await (await e.navegador.pedir('/')).text()
    expect(html).toContain('aria-label="Para resolver"')
    expect(html).toContain('Martín S. no puede ir el ')
    expect(html).toContain(`/agenda?vista=dia&amp;fecha=${sumarDias(HOY, 3)}&amp;turno=${t}`)
    expect(html).toContain('es feriado: ¿atendés?')
    expect(html).toContain('href="/bloqueos/nuevo#feriados"')
    expect(html).toContain(`href="/bloqueos/${bloqueo}"`)
    expect(html).toContain('falta resolver 1 turno')
  })

  it('«Controles por agendar» lista a quien indicó control y no tiene turno, y abre Dar turno en esa semana', async () => {
    const e = await conSesion()
    const id = Number(e.db.prepare("INSERT INTO pacientes (dni, nombre, apellido, celular) VALUES ('99888777', 'Nora', 'Quiroga', '+54 9 343 555-5555')").run().lastInsertRowid)
    const consulta = Number(e.db.prepare("INSERT INTO consultas (paciente_id, tipo) VALUES (?, 'control')").run(id).lastInsertRowid)
    e.db.prepare("UPDATE consultas SET estado = 'finalizada', finalizada_en = '2026-01-01T12:00:00Z', foto = '{}', proximo_control = ? WHERE id = ?").run(sumarDias(HOY, -5), consulta)
    const html = await (await e.navegador.pedir('/')).text()
    expect(html).toContain('Nora Quiroga')
    expect(html).toContain('Venció el ')
    expect(html).toContain(`href="/turnos/nuevo?paciente=${id}&amp;fecha=${HOY}"`)
    // con turno futuro deja de figurar
    turno(e.db, id, sumarDias(HOY, 3), '10:00')
    expect(await (await e.navegador.pedir('/')).text()).not.toContain('Nora Quiroga')
  })

  it('la última consulta sin próximo control deja sin efecto la indicación anterior',async()=>{
    const e=await conSesion()
    const pid=Number(e.db.prepare("INSERT INTO pacientes(dni,nombre,apellido,celular) VALUES ('88777666','Paciente','Control ficticio','3430000000')").run().lastInsertRowid)
    const finalizar=(control:string|null)=>{
      const id=Number(e.db.prepare("INSERT INTO consultas(paciente_id,tipo) VALUES (?,'control')").run(pid).lastInsertRowid)
      e.db.prepare("UPDATE consultas SET estado='finalizada',finalizada_en='2026-01-01T12:00:00Z',foto='{}',proximo_control=? WHERE id=?").run(control,id)
    }
    finalizar(sumarDias(HOY,-5))
    expect((await controlesPorAgendar(e.env.DB,HOY)).some(p=>p.paciente_id===pid)).toBe(true)
    finalizar(null)
    expect((await controlesPorAgendar(e.env.DB,HOY)).some(p=>p.paciente_id===pid)).toBe(false)
  })

  it('Dar turno con una fecha sugerida lejana ofrece los días de esa semana', async () => {
    const e = await conSesion()
    const lejos = proximo(3, 45)
    const html = await (await e.navegador.pedir(`/turnos/nuevo?paciente=1&consultorio=1&fecha=${lejos}`)).text()
    expect(html).toContain(`fecha=${lunesDe(lejos)}`)
    expect(html).toContain(`fecha=${lejos}`)
  })
})
