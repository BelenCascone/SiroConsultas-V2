// P2b · Agenda (Día, Semana, Mes) y la ventana del turno, contra la app real.
import { describe, it, expect } from 'vitest'
import { entorno, CLAVE_PRUEBA } from './ayuda'
import { ahoraAR, sumarDias } from '../../src/lib/fechas'
import { diaDeSemana } from '../../src/lib/turnos'
import { estadoMostrado, lunesDe, rangoDe, vecina, nombreCorto, limitesDelTablero } from '../../src/lib/agenda'

async function conSesion() {
  const e = entorno()
  await e.navegador.pedir('/ingresar/prueba', { form: { clave: CLAVE_PRUEBA } })
  return e
}
const todos = (db: ReturnType<typeof entorno>['db'], sql: string, ...args: any[]) => db.prepare(sql).all(...args) as any[]
const proximo = (dia: number, desde = 7) => { let f = sumarDias(ahoraAR().fecha, desde); while (diaDeSemana(f) !== dia) f = sumarDias(f, 1); return f }
const { fecha: HOY } = ahoraAR()

describe('Rangos y estados', () => {
  it('cada vista abarca lo suyo: el día, la semana de lunes a domingo y el mes completo por semanas', () => {
    expect(rangoDe('dia', '2030-01-09')).toEqual({ desde: '2030-01-09', hasta: '2030-01-09' })
    expect(rangoDe('semana', '2030-01-09')).toEqual({ desde: '2030-01-07', hasta: '2030-01-13' })
    expect(rangoDe('mes', '2030-02-14')).toEqual({ desde: '2030-01-28', hasta: '2030-03-03' })
    expect(lunesDe('2030-01-13')).toBe('2030-01-07')
  })
  it('las flechas avanzan un día, una semana o un mes', () => {
    expect(vecina('dia', '2030-01-31', 1)).toBe('2030-02-01')
    expect(vecina('semana', '2030-01-09', -1)).toBe('2030-01-02')
    expect(vecina('mes', '2030-01-31', 1)).toBe('2030-02-01')
    expect(vecina('mes', '2030-01-15', -1)).toBe('2029-12-01')
  })
  it('el estado que se muestra sale del turno, de la respuesta y de la hora', () => {
    const t = { fecha: '2030-01-07', hora: '10:00', duracion_min: 30, estado: 'confirmado', confirmacion: null as string | null }
    expect(estadoMostrado(t, '2030-01-07', 10 * 60 + 10).clave).toBe('ahora')
    expect(estadoMostrado(t, '2030-01-07', 11 * 60).clave).toBe('pendiente')
    expect(estadoMostrado(t, '2030-01-07', 8 * 60).clave).toBe('sin_respuesta')
    expect(estadoMostrado({ ...t, confirmacion: 'voy' }, '2030-01-01', 0).clave).toBe('confirmo')
    expect(estadoMostrado({ ...t, confirmacion: 'no_puedo' }, '2030-01-01', 0).clave).toBe('no_puede')
    expect(estadoMostrado({ ...t, estado: 'atendido' }, '2030-01-01', 0).clave).toBe('atendido')
    expect(estadoMostrado({ ...t, estado: 'solicitado' }, '2030-01-01', 0).clave).toBe('solicitado')
  })
  it('nombre corto y límites del tablero', () => {
    expect(nombreCorto({ nombre: 'Tomás Andrés', apellido: 'Ferreyra' })).toBe('Tomás F.')
    expect(limitesDelTablero([], [])).toEqual({ ini: 480, fin: 1200, filas: 24 })
    expect(limitesDelTablero([{ desde: 7 * 60 + 30, hasta: 21 * 60 }], [])).toMatchObject({ ini: 420, fin: 1260 })
  })
})

describe('Agenda · vistas', () => {
  it('la semana muestra los turnos con nombre corto, el resumen y los consultorios', async () => {
    const { navegador } = await conSesion()
    const html = await (await navegador.pedir('/agenda')).text()
    expect(html).toContain('Semana del')
    expect(html).toContain('Tomás F.')
    expect(html).toContain('Lucía B.')
    expect(html).toMatch(/\d+ turnos? · \d+ sin confirmar · \d+ pedidos? online · \d+ para resolver/)
    for (const c of ['Todos', 'Centro', 'Norte', 'Videollamada']) expect(html).toContain(`>${c}</a>`)
  })
  it('el día muestra nombre y apellido completos, la prestación y el estado', async () => {
    const { navegador } = await conSesion()
    const html = await (await navegador.pedir(`/agenda?vista=dia&fecha=${HOY}`)).text()
    expect(html).toContain('Tomás Ferreyra')
    expect(html).toContain('Consulta de control')
  })
  it('el consultorio filtra los turnos', async () => {
    const { navegador } = await conSesion()
    const norte = await (await navegador.pedir(`/agenda?vista=dia&fecha=${HOY}&consultorio=2`)).text()
    expect(norte).not.toContain('Tomás Ferreyra')
    const centro = await (await navegador.pedir(`/agenda?vista=dia&fecha=${HOY}&consultorio=1`)).text()
    expect(centro).toContain('Tomás Ferreyra')
  })
  it('el mes lleva cada día a su vista', async () => {
    const { navegador } = await conSesion()
    const html = await (await navegador.pedir('/agenda?vista=mes')).text()
    expect(html).toContain('class="ag-mes"')
    expect(html).toContain(`href="/agenda?vista=dia&amp;fecha=${HOY}&amp;consultorio=todos"`)
  })
  it('un hueco libre lleva a Dar turno con el día, la hora y el consultorio', async () => {
    const { navegador } = await conSesion()
    const lunes = proximo(1)
    const html = await (await navegador.pedir(`/agenda?vista=dia&fecha=${lunes}&consultorio=1`)).text()
    expect(html).toContain(`href="/turnos/nuevo?consultorio=1&amp;fecha=${lunes}&amp;hora=08%3A00"`)
    // y Dar turno sigue con ese hueco al elegir al paciente
    const dar = await (await navegador.pedir(`/turnos/nuevo?consultorio=1&fecha=${lunes}&hora=08%3A00&q=ferreyra`)).text()
    expect(dar).toContain(`href="/turnos/nuevo?consultorio=1&amp;fecha=${lunes}&amp;hora=08%3A00&amp;paciente=1"`)
    const paso3 = await (await navegador.pedir(`/turnos/nuevo?consultorio=1&fecha=${lunes}&hora=08%3A00&paciente=1`)).text()
    expect(paso3).toContain('Revisá y guardá')
  })
  it('los feriados y los bloqueos cierran el día; los pedidos online muestran su punto en el mes', async () => {
    const { navegador, db } = await conSesion()
    const lunes = proximo(1), miercoles = proximo(3)
    db.prepare("INSERT INTO feriados (fecha, nombre) VALUES (?, 'Feriado de prueba')").run(lunes)
    db.prepare("INSERT INTO bloqueos (desde, hasta, motivo) VALUES (?, ?, 'congreso')").run(miercoles, miercoles)
    const html = await (await navegador.pedir(`/agenda?vista=semana&fecha=${lunes}&consultorio=1`)).text()
    expect(html).toContain('Feriado · Feriado de prueba')
    expect(html).toContain('Bloqueado · Congreso')
    expect(html).not.toContain(`fecha=${lunes}&amp;hora=08%3A00`)
  })
  it('pide sesión y respeta el módulo', async () => {
    const { navegador } = entorno()
    expect((await navegador.pedir('/agenda')).status).toBe(302)
    const sin = entorno({ MODULOS: 'documentos' })
    await sin.navegador.pedir('/ingresar/prueba', { form: { clave: CLAVE_PRUEBA } })
    expect((await sin.navegador.pedir('/agenda')).status).toBe(404)
  })
})

describe('Ventana del turno', () => {
  const ventana = async (id: number) => (await (await (await conSesion()).navegador.pedir(`/agenda?turno=${id}`)).text())

  it('un turno de hoy se puede atender, marcar ausente, mover y cancelar', async () => {
    const html = await ventana(3)
    expect(html).toContain('<dialog id="v-turno"')
    for (const t of ['Atender', 'No vino', 'Mover', 'Cancelar y avisar', 'Ver ficha', 'Darle otro turno']) expect(html).toContain(t)
    expect(html).toContain('Ya vino 1 vez')
  })
  it('un turno futuro no se atiende ni se marca ausente', async () => {
    const html = await ventana(6)
    expect(html).toContain('Cancelar y avisar')
    expect(html).not.toContain('>Atender<')
    expect(html).not.toContain('>No vino<')
  })
  it('un turno ya atendido solo deja ver la ficha y dar otro turno', async () => {
    const html = await ventana(1)
    expect(html).toContain('Ver ficha')
    expect(html).not.toContain('Cancelar y avisar')
  })
  it('atender deja el turno atendido y abre la consulta', async () => {
    const { navegador, db } = await conSesion()
    const r = await navegador.pedir('/turnos/3/atender', { form: {} })
    expect(r.headers.get('location')).toBe('/consultas/nueva?turno=3')
    expect(todos(db, 'SELECT estado, cerrado_en FROM turnos WHERE id = 3')[0].estado).toBe('atendido')
    // un turno futuro no se puede atender
    await navegador.pedir('/turnos/6/atender', { form: {} })
    expect(todos(db, 'SELECT estado FROM turnos WHERE id = 6')[0].estado).toBe('confirmado')
  })
  it('«No vino» lo deja ausente y vuelve a la agenda', async () => {
    const { navegador, db } = await conSesion()
    const r = await navegador.pedir('/turnos/4/ausente', { form: { volver: '/agenda?vista=dia' } })
    expect(r.headers.get('location')).toBe('/agenda?vista=dia')
    expect(todos(db, 'SELECT estado FROM turnos WHERE id = 4')[0].estado).toBe('ausente')
    const afuera = await navegador.pedir('/turnos/5/ausente', { form: { volver: 'https://malo.test' } })
    expect(afuera.headers.get('location')).toBe('/agenda')
  })
  it('cancelar libera el hueco y deja el mensaje de WhatsApp listo', async () => {
    const { navegador, db } = await conSesion()
    const r = await navegador.pedir('/turnos/6/cancelar', { form: {} })
    expect(r.headers.get('location')).toBe('/turnos/6/aviso?que=cancelado')
    expect(todos(db, 'SELECT estado, cancelado_por FROM turnos WHERE id = 6')[0]).toEqual({ estado: 'cancelado', cancelado_por: 'profesional' })
    const aviso = await (await navegador.pedir('/turnos/6/aviso?que=cancelado')).text()
    expect(aviso).toContain('Turno cancelado')
    expect(aviso).toContain('https://wa.me/5493434444444?text=')
    expect(await (await navegador.pedir('/agenda?vista=dia&fecha=' + todos(db, 'SELECT fecha FROM turnos WHERE id = 6')[0].fecha)).text()).not.toContain('Martín S.')
    // cancelar de nuevo no hace nada
    expect((await navegador.pedir('/turnos/6/cancelar', { form: {} })).headers.get('location')).toBe('/agenda')
    expect((await navegador.pedir('/turnos/6/aviso?que=movido')).status).toBe(200)
  })
})

describe('Mover un turno', () => {
  it('muestra los huecos en verde, pide confirmar y mueve avisando', async () => {
    const { navegador, db } = await conSesion()
    const lunes = proximo(1)
    const huecos = await (await navegador.pedir(`/agenda?vista=dia&fecha=${lunes}&consultorio=1&mover=6`)).text()
    expect(huecos).toContain('Moviendo el turno de Martín Sosa')
    expect(huecos).toContain('class="ag-hueco verde')
    const destino = `1,${lunes},09:00`
    const conf = await (await navegador.pedir(`/agenda?vista=dia&fecha=${lunes}&consultorio=1&mover=6&destino=${destino}`)).text()
    expect(conf).toContain('Mover y avisar')
    const r = await navegador.pedir('/turnos/6/mover', { form: { consultorio: '1', fecha: lunes, hora: '09:00' } })
    expect(r.headers.get('location')).toMatch(/^\/turnos\/6\/aviso\?que=movido&antes=/)
    expect(todos(db, 'SELECT fecha, hora, consultorio_id, confirmacion FROM turnos WHERE id = 6')[0]).toEqual({ fecha: lunes, hora: '09:00', consultorio_id: 1, confirmacion: null })
    const aviso = await (await navegador.pedir(r.headers.get('location')!)).text()
    expect(aviso).toContain('Turno movido')
    expect(decodeURIComponent(aviso)).toContain('pasó al')
  })
  it('no mueve a un horario ocupado, bloqueado o fuera de horario', async () => {
    const { navegador, db } = await conSesion()
    const lunes = proximo(1)
    await navegador.pedir('/turnos', { form: { paciente: '1', consultorio: '1', prestacion: '2', fecha: lunes, hora: '09:00' } })
    const ocupado = await navegador.pedir('/turnos/6/mover', { form: { consultorio: '1', fecha: lunes, hora: '09:00' } })
    expect(ocupado.headers.get('location')).toMatch(/error=/)
    const fuera = await navegador.pedir('/turnos/6/mover', { form: { consultorio: '1', fecha: lunes, hora: '13:00' } })
    expect(fuera.headers.get('location')).toMatch(/error=/)
    expect(todos(db, 'SELECT fecha FROM turnos WHERE id = 6')[0].fecha).not.toBe(lunes)
    const html = await (await navegador.pedir(ocupado.headers.get('location')!)).text()
    expect(html).toContain('Se superpone')
  })
  it('un turno cerrado no se mueve', async () => {
    const { navegador } = await conSesion()
    const lunes = proximo(1)
    const r = await navegador.pedir('/turnos/1/mover', { form: { consultorio: '1', fecha: lunes, hora: '09:00' } })
    expect(r.headers.get('location')).toMatch(/error=/)
  })
})
