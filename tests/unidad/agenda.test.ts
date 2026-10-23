// P2 · Dar turno y agenda (docs/ANALISIS_FUNCIONAL.md, flujos 2, 5 y 6; ciclo de vida del turno).
import { describe, it, expect } from 'vitest'
import { entorno, CLAVE_PRUEBA } from './ayuda'
import { ahoraAR, sumarDias } from '../../src/lib/fechas'
import {
  diaSemana, lunesDe, fechasSerie, huecosDelDia, estadoVisual, mensajeTurno, minutos, type DatosAgenda, type TurnoAgenda,
} from '../../src/lib/agenda'
import { volverSeguro } from '../../src/rutas/turnos'

const hoy = ahoraAR().fecha
/** El lunes de la semana que viene: el consultorio Centro atiende de 8 a 12 y de 15 a 19 (datos ficticios). */
const lunes = lunesDe(sumarDias(hoy, 7))

async function conSesion(cambios = {}) {
  const e = entorno(cambios)
  await e.navegador.pedir('/ingresar/prueba', { form: { clave: CLAVE_PRUEBA } })
  return e
}
const uno = (db: ReturnType<typeof entorno>['db'], sql: string, ...args: any[]) => db.prepare(sql).get(...args) as any
const turnoDe = (pacienteId: number, fecha: string, hora: string, extra = {}) =>
  ({ paciente: String(pacienteId), consultorio: '1', prestacion: '2', fecha, hora, ...extra })

describe('Fechas y series', () => {
  it('días de la semana de lunes a domingo', () => {
    expect(diaSemana('2026-10-26')).toBe(1)
    expect(diaSemana('2026-11-01')).toBe(7)
    expect(lunesDe('2026-10-29')).toBe('2026-10-26')
  })
  it('turnos que se repiten cada N semanas hasta una fecha', () => {
    expect(fechasSerie('2026-11-02', 2, '2026-12-01')).toEqual(['2026-11-02', '2026-11-16', '2026-11-30'])
    expect(fechasSerie('2026-11-02', 1, '2026-11-02')).toEqual(['2026-11-02'])
    expect(fechasSerie('2026-01-05', 1, '2030-01-01')).toHaveLength(52)
  })
  it('los mensajes llevan nombre, día, hora y lugar, nunca datos clínicos', () => {
    const t = { nombre: 'Tomás', fecha: '2026-11-02', hora: '10:00', lugar: 'Centro' }
    expect(mensajeTurno('nuevo', t)).toBe('Hola Tomás, te confirmo tu turno el lunes 2 de noviembre a las 10:00 en Centro.')
    expect(mensajeTurno('recordatorio', t, 'Hola {nombre}! Te espero el {dia} a las {hora} en {lugar}.')).toBe('Hola Tomás! Te espero el lunes 2 de noviembre a las 10:00 en Centro.')
  })
  it('solo se vuelve a rutas internas', () => {
    expect(volverSeguro('/agenda?vista=dia')).toBe('/agenda?vista=dia')
    expect(volverSeguro('//otro-sitio.test')).toBe('/')
    expect(volverSeguro('https://otro-sitio.test')).toBe('/')
  })
})

describe('Huecos libres', () => {
  const base = (cambios: Partial<DatosAgenda> = {}): DatosAgenda => ({
    consultorios: [{ id: 1, nombre: 'Centro', modalidad: 'presencial', activo: 1 }],
    franjas: [{ consultorio_id: 1, dia: 1, desde: '08:00', hasta: '10:00' }],
    turnos: [], bloqueos: [], feriados: new Map(), pedidos: new Map(), ...cambios,
  })
  const futuro = { fecha: '2026-01-01', hora: '00:00' }
  const turno = (hora: string, dur = 30) => ({ id: 1, fecha: '2026-11-02', hora, duracion_min: dur, estado: 'confirmado' }) as TurnoAgenda
  const horas = (d: DatosAgenda, ahora = futuro, dur = 30) => huecosDelDia(d, '2026-11-02', null, ahora, 30, dur).map((h) => h.hora)

  it('cada media hora dentro del horario', () => {
    expect(horas(base())).toEqual(['08:00', '08:30', '09:00', '09:30'])
  })
  it('un turno de cualquier consultorio ocupa el hueco: la profesional es una sola', () => {
    expect(horas(base({ turnos: [turno('08:30', 45)] }))).toEqual(['08:00', '09:30'])
  })
  it('una prestación larga necesita lugar hasta el final', () => {
    expect(horas(base(), futuro, 60)).toEqual(['08:00', '08:30', '09:00'])
  })
  it('bloqueos y feriados sin atención no se ofrecen', () => {
    expect(horas(base({ bloqueos: [{ id: 1, desde: '2026-11-02', hasta: '2026-11-02', hora_desde: '09:00', hora_hasta: '10:00', consultorio_id: null, motivo: 'personal', detalle: null }] }))).toEqual(['08:00', '08:30'])
    expect(horas(base({ feriados: new Map([['2026-11-02', { fecha: '2026-11-02', nombre: 'Feriado ficticio', atiende: null }]]) }))).toEqual([])
    expect(horas(base({ feriados: new Map([['2026-11-02', { fecha: '2026-11-02', nombre: 'Feriado ficticio', atiende: 1 }]]) }))).toHaveLength(4)
  })
  it('hoy, solo desde la hora actual', () => {
    expect(horas(base(), { fecha: '2026-11-02', hora: '08:40' })).toEqual(['09:00', '09:30'])
  })
})

describe('Estado que se ve en la grilla', () => {
  const ahora = { fecha: '2026-11-02', hora: '10:00' }
  const t = (x: Partial<TurnoAgenda>) => ({ fecha: '2026-11-03', hora: '10:00', duracion_min: 30, estado: 'confirmado', confirmacion: null, saldo: 0, con_cobro: 0, ...x }) as TurnoAgenda
  it('según confirmación, hora y cobro', () => {
    expect(estadoVisual(t({}), ahora, false, true)).toBe('sin_confirmar')
    expect(estadoVisual(t({ confirmacion: 'voy' }), ahora, false, true)).toBe('confirmo')
    expect(estadoVisual(t({ confirmacion: 'no_puedo' }), ahora, false, true)).toBe('no_puede')
    expect(estadoVisual(t({}), ahora, true, true)).toBe('para_mover')
    expect(estadoVisual(t({ fecha: '2026-11-02', hora: '10:00' }), ahora, false, true)).toBe('ahora')
    expect(estadoVisual(t({ fecha: '2026-11-01' }), ahora, false, true)).toBe('para_resolver')
    expect(estadoVisual(t({ estado: 'atendido' }), ahora, false, true)).toBe('para_cobrar')
    expect(estadoVisual(t({ estado: 'atendido' }), ahora, false, false)).toBe('atendido')
    expect(estadoVisual(t({ estado: 'atendido', con_cobro: 1, saldo: 0 }), ahora, false, true)).toBe('atendido')
  })
})

describe('Dar turno', () => {
  it('paso 1: para quién; paso 2: cuándo, con los huecos del día', async () => {
    const { navegador } = await conSesion()
    expect(await (await navegador.pedir('/turnos/nuevo')).text()).toContain('¿Para quién es?')
    const paso2 = await (await navegador.pedir(`/turnos/nuevo?paciente=2&dia=${lunes}`)).text()
    expect(paso2).toContain('¿Cuándo?')
    expect(paso2).toContain(`fecha=${lunes}&amp;hora=08%3A00`)
    expect(paso2).toContain('Consulta de control') // la prestación de su último turno
  })
  it('guarda el turno confirmado, con el tipo de atención y la cobertura de la ficha', async () => {
    const { navegador, db } = await conSesion()
    const r = await navegador.pedir('/turnos', { form: turnoDe(3, lunes, '08:00', { avisar: '1' }) })
    expect(r.headers.get('location')).toMatch(/^\/turnos\/listo\?ids=\d+&avisar=1$/)
    const t = uno(db, `SELECT * FROM turnos WHERE paciente_id = 3 AND fecha = ?`, lunes)
    expect(t).toMatchObject({ estado: 'confirmado', origen: 'profesional', atencion: 'primera', cobertura: 'particular', duracion_min: 30, hora: '08:00' })
    const listo = await (await navegador.pedir(r.headers.get('location')!)).text()
    expect(listo).toContain('Turno confirmado')
    expect(listo).toContain('Avisarle por WhatsApp')
    // Ana ya vino: control, y su obra social no: particular. Tomás tiene OSDE.
    await navegador.pedir('/turnos', { form: turnoDe(1, lunes, '09:00') })
    expect(uno(db, `SELECT atencion, cobertura, obra_social_id FROM turnos WHERE paciente_id = 1 AND fecha = ?`, lunes)).toEqual({ atencion: 'control', cobertura: 'obra_social', obra_social_id: 1 })
  })
  it('si se superpone o queda fuera de horario, avisa y no guarda hasta confirmar', async () => {
    const { navegador, db } = await conSesion()
    await navegador.pedir('/turnos', { form: turnoDe(3, lunes, '08:00') })
    const choque = await navegador.pedir('/turnos', { form: turnoDe(2, lunes, '08:15') })
    expect(choque.status).toBe(409)
    const html = await choque.text()
    expect(html).toContain('Se superpone con el turno de Lucía Benítez a las 08:00.')
    expect(uno(db, `SELECT COUNT(*) n FROM turnos WHERE paciente_id = 2 AND fecha = ?`, lunes).n).toBe(0)
    const fuera = await (await navegador.pedir('/turnos', { form: turnoDe(2, lunes, '13:00') })).text()
    expect(fuera).toContain('Queda fuera de tu horario')
    await navegador.pedir('/turnos', { form: turnoDe(2, lunes, '13:00', { forzar: '1' }) })
    expect(uno(db, `SELECT hora FROM turnos WHERE paciente_id = 2 AND fecha = ?`, lunes).hora).toBe('13:00')
  })
  it('repetir cada 2 semanas crea turnos sueltos unidos por la serie', async () => {
    const { navegador, db } = await conSesion()
    const r = await navegador.pedir('/turnos', { form: turnoDe(4, lunes, '10:00', { cada: '2', hasta: sumarDias(lunes, 30) }) })
    expect(r.headers.get('location')).toMatch(/ids=\d+%2C\d+%2C\d+$/)
    const serie = db.prepare('SELECT fecha, serie_id FROM turnos WHERE paciente_id = 4 AND fecha >= ? ORDER BY fecha').all(lunes) as any[]
    expect(serie.map((x) => x.fecha)).toEqual([lunes, sumarDias(lunes, 14), sumarDias(lunes, 28)])
    expect(new Set(serie.map((x) => x.serie_id)).size).toBe(1)
    expect(serie[0].serie_id).not.toBeNull()
  })
  it('alta rápida desde Dar turno: crea la ficha o usa la que ya existe', async () => {
    const { navegador, db } = await conSesion()
    const nuevo = await navegador.pedir('/turnos/nuevo/paciente', { form: { dni: '47.000.111', nombre: 'Valentina', apellido: 'González', celular: '11 5555-0142', fecha: lunes, hora: '08:00', consultorio: '1' } })
    const id = uno(db, `SELECT id FROM pacientes WHERE dni = '47000111'`).id
    expect(nuevo.headers.get('location')).toBe(`/turnos/nuevo?paciente=${id}&consultorio=1&fecha=${lunes}&hora=08%3A00`)
    const existente = await navegador.pedir('/turnos/nuevo/paciente', { form: { dni: '28333444', nombre: 'X', apellido: 'Y', celular: '3430000000' } })
    expect(existente.headers.get('location')).toBe('/turnos/nuevo?paciente=2')
  })
  it('a un paciente dado de baja no se le dan turnos', async () => {
    const { navegador, db } = await conSesion()
    db.exec(`UPDATE pacientes SET baja_en = '2026-01-01T00:00:00Z', baja_motivo = 'otro' WHERE id = 4`)
    expect((await navegador.pedir('/turnos/nuevo?paciente=4')).status).toBe(409)
    await navegador.pedir('/turnos', { form: turnoDe(4, lunes, '10:00') })
    expect(uno(db, `SELECT COUNT(*) n FROM turnos WHERE paciente_id = 4 AND fecha = ?`, lunes).n).toBe(0)
  })
})

describe('Acciones sobre un turno', () => {
  async function conTurno(extra = {}) {
    const e = await conSesion()
    await e.navegador.pedir('/turnos', { form: turnoDe(1, lunes, '10:00', extra) })
    const id = uno(e.db, `SELECT MIN(id) id FROM turnos WHERE paciente_id = 1 AND fecha = ?`, lunes).id
    return { ...e, id }
  }
  it('cancelar dice quién canceló y ofrece avisarle', async () => {
    const { navegador, db, id } = await conTurno()
    const r = await navegador.pedir(`/turnos/${id}/cancelar`, { form: { quien: 'paciente' } })
    expect(r.headers.get('location')).toBe(`/agenda?vista=dia&fecha=${lunes}&aviso=cancelado&turno=${id}`)
    expect(uno(db, 'SELECT estado, cancelado_por FROM turnos WHERE id = ?', id)).toEqual({ estado: 'cancelado', cancelado_por: 'paciente' })
    expect(await (await navegador.pedir(r.headers.get('location')!)).text()).toContain('Avisarle por WhatsApp')
    // cerrado: no se vuelve a tocar
    expect((await navegador.pedir(`/turnos/${id}/mover`, { form: { fecha: lunes, hora: '11:00' } })).headers.get('location')).toContain('aviso=cerrado')
  })
  it('cancelar este y los siguientes de una serie', async () => {
    const { navegador, db } = await conTurno({ cada: '1', hasta: sumarDias(lunes, 21) })
    const ids = (db.prepare('SELECT id FROM turnos WHERE paciente_id = 1 AND fecha >= ? ORDER BY fecha').all(lunes) as any[]).map((x) => x.id)
    expect(ids).toHaveLength(4)
    await navegador.pedir(`/turnos/${ids[1]}/cancelar`, { form: { quien: 'profesional', alcance: 'siguientes' } })
    expect((db.prepare('SELECT estado FROM turnos WHERE paciente_id = 1 AND fecha >= ? ORDER BY fecha').all(lunes) as any[]).map((x) => x.estado))
      .toEqual(['confirmado', 'cancelado', 'cancelado', 'cancelado'])
  })
  it('mover: cambia día y hora, la confirmación vuelve a empezar; si choca, pide confirmar', async () => {
    const { navegador, db, id } = await conTurno()
    db.exec(`UPDATE turnos SET confirmacion = 'voy' WHERE id = ${id}`)
    await navegador.pedir('/turnos', { form: turnoDe(3, lunes, '11:00') })
    const choque = await navegador.pedir(`/turnos/${id}/mover`, { form: { fecha: lunes, hora: '11:00', consultorio: '1' } })
    expect(choque.headers.get('location')).toContain('choque=1')
    expect(uno(db, 'SELECT hora FROM turnos WHERE id = ?', id).hora).toBe('10:00')
    const destino = sumarDias(lunes, 2) // miércoles: también atiende en Centro
    const r = await navegador.pedir(`/turnos/${id}/mover`, { form: { fecha: destino, hora: '09:00', consultorio: '1' } })
    expect(r.headers.get('location')).toBe(`/agenda?vista=dia&fecha=${destino}&aviso=movido&turno=${id}`)
    expect(uno(db, 'SELECT fecha, hora, confirmacion FROM turnos WHERE id = ?', id)).toEqual({ fecha: destino, hora: '09:00', confirmacion: null })
  })
  it('mover este y los siguientes corre toda la serie lo mismo', async () => {
    const { navegador, db } = await conTurno({ cada: '1', hasta: sumarDias(lunes, 14) })
    const [primero] = (db.prepare('SELECT id FROM turnos WHERE paciente_id = 1 AND fecha >= ? ORDER BY fecha').all(lunes) as any[]).map((x) => x.id)
    await navegador.pedir(`/turnos/${primero}/mover`, { form: { fecha: sumarDias(lunes, 2), hora: '08:30', consultorio: '1', alcance: 'siguientes' } })
    expect((db.prepare('SELECT fecha, hora FROM turnos WHERE paciente_id = 1 AND fecha >= ? ORDER BY fecha').all(lunes) as any[]))
      .toEqual([0, 7, 14].map((n) => ({ fecha: sumarDias(lunes, n + 2), hora: '08:30' })))
  })
  it('no vino y atender solo el día del turno; no se deshacen', async () => {
    const { navegador, db, id } = await conTurno()
    expect((await navegador.pedir(`/turnos/${id}/ausente`, { form: {} })).headers.get('location')).toContain('aviso=futuro')
    // Turnos de hoy de los datos ficticios: Tomás 09:30 (id 3) y Lucía 10:30 (id 4)
    expect((await navegador.pedir('/turnos/3/ausente', { form: {} })).headers.get('location')).toContain('aviso=ausente')
    expect(uno(db, 'SELECT estado FROM turnos WHERE id = 3').estado).toBe('ausente')
    const atender = await navegador.pedir('/turnos/4/atender', { form: {} })
    expect(atender.headers.get('location')).toBe('/pacientes/3?tab=historia&aviso=atendido')
    expect(uno(db, 'SELECT estado FROM turnos WHERE id = 4').estado).toBe('atendido')
    expect((await navegador.pedir('/turnos/4/ausente', { form: {} })).headers.get('location')).toContain('aviso=cerrado')
  })
  it('avisarle abre WhatsApp con el mensaje y deja registrado el envío', async () => {
    const { navegador, db, id } = await conTurno()
    const r = await navegador.pedir(`/turnos/${id}/avisar`, { form: { tipo: 'recordatorio' } })
    const destino = new URL(r.headers.get('location')!)
    expect(destino.origin).toBe('https://wa.me')
    expect(destino.searchParams.get('text')).toContain('Hola Tomás, te recuerdo tu turno')
    expect(destino.searchParams.get('text')).not.toContain('Consulta')
    expect(uno(db, `SELECT COUNT(*) n FROM envios WHERE que = 'recordatorio' AND objeto_id = ?`, id).n).toBe(1)
    expect(uno(db, 'SELECT recordatorio_whatsapp_en FROM turnos WHERE id = ?', id).recordatorio_whatsapp_en).toBeTruthy()
  })
})

describe('Agenda', () => {
  it('semana, día y mes con los turnos y la ventana del turno', async () => {
    const { navegador } = await conSesion()
    await navegador.pedir('/turnos', { form: turnoDe(1, lunes, '10:00') })
    const semana = await (await navegador.pedir(`/agenda?fecha=${lunes}`)).text()
    expect(semana).toContain('Tomás F.')
    expect(semana).toContain('aria-label="Hueco libre el lunes')
    const dia = await (await navegador.pedir(`/agenda?vista=dia&fecha=${lunes}`)).text()
    expect(dia).toContain('10:00 · Tomás Ferreyra')
    expect((await navegador.pedir(`/agenda?vista=mes&fecha=${lunes}`)).status).toBe(200)
    const id = Number(/turno=(\d+)/.exec(dia)![1])
    const ventana = await (await navegador.pedir(`/agenda?vista=dia&fecha=${lunes}&turno=${id}`)).text()
    expect(ventana).toContain('>Mover<')
    expect(ventana).toContain('Cancelar y avisar')
    expect(ventana).toContain('Mandar recordatorio')
  })
  it('en modo mover, los huecos llevan a confirmar el destino', async () => {
    const { navegador, db } = await conSesion()
    await navegador.pedir('/turnos', { form: turnoDe(1, lunes, '10:00') })
    const id = uno(db, 'SELECT MAX(id) id FROM turnos').id
    const html = await (await navegador.pedir(`/agenda?mover=${id}&fecha=${lunes}`)).text()
    expect(html).toContain('Moviendo el turno de Tomás Ferreyra')
    expect(html).toContain(`destino=${lunes}_08%3A00_1`)
    const destino = await (await navegador.pedir(`/agenda?mover=${id}&fecha=${lunes}&destino=${lunes}_08:00_1`)).text()
    expect(destino).toContain('Mover el turno de Tomás Ferreyra')
    expect(destino).toContain(`action="/turnos/${id}/mover"`)
  })
  it('sin el módulo de agenda no hay agenda ni turnos', async () => {
    const { navegador } = await conSesion({ MODULOS: 'cobros' })
    expect((await navegador.pedir('/agenda')).status).toBe(404)
    expect((await navegador.pedir('/turnos/nuevo')).status).toBe(404)
  })
  it('la grilla ubica los turnos por hora, sin estilos en línea', async () => {
    const { navegador } = await conSesion()
    await navegador.pedir('/turnos', { form: turnoDe(1, lunes, '10:00') })
    const html = await (await navegador.pedir(`/agenda?vista=dia&fecha=${lunes}`)).text()
    expect(html).not.toMatch(/ style="/)
    // 10:00 con inicio a las 8:00 y filas de 15 minutos: fila 2 + 8 = 10; 30 minutos = 2 filas
    expect(html).toMatch(/class="gc-2 gf-10 ga-2 turno/)
    expect(minutos('10:00')).toBe(600)
  })
})
