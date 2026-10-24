// P4 · Cobrar y cobros (docs/ANALISIS_FUNCIONAL.md, flujo 8; reglas de cobros y pagos).
import { describe, it, expect } from 'vitest'
import { entorno, CLAVE_PRUEBA } from './ayuda'
import { ahoraAR } from '../../src/lib/fechas'
import { leerImporte, importeCampo, mensajeDatosPago } from '../../src/lib/cobros'
import { pesos } from '../../src/ui/componentes'

const hoy = ahoraAR().fecha
type Db = ReturnType<typeof entorno>['db']

async function conSesion(cambios = {}) {
  const e = entorno(cambios)
  await e.navegador.pedir('/ingresar/prueba', { form: { clave: CLAVE_PRUEBA } })
  return e
}
const uno = (db: Db, sql: string, ...args: any[]) => db.prepare(sql).get(...args) as any
/** Turno de hoy de Lucía (id 4, primera consulta, particular, $ 25.000) marcado como atendido. */
const atender = (db: Db, id = 4) => db.exec(`UPDATE turnos SET estado = 'atendido', cerrado_en = '2026-01-01T00:00:00Z' WHERE id = ${id}`)
let clave = 0
const nuevaClave = () => `prueba-${Date.now()}-${++clave}`

describe('Importes', () => {
  it('entiende como escribe la gente', () => {
    expect(leerImporte('18000')).toBe(1800000)
    expect(leerImporte('18.000')).toBe(1800000)
    expect(leerImporte('$ 18.000,50')).toBe(1800050)
    expect(leerImporte('18000,5')).toBe(1800050)
    expect(leerImporte('18000.50')).toBe(1800050)
    expect(leerImporte('123.456')).toBe(12345600)
    expect(leerImporte('0')).toBe(0)
    for (const mal of ['', 'abc', '18,000,00', '1.23.4', '-5', undefined]) expect(leerImporte(mal)).toBeNull()
    expect(leerImporte('2000000')).toBeNull() // más de $ 1.000.000
  })
  it('vuelve al campo sin perder centavos', () => {
    expect(importeCampo(1800000)).toBe('18000')
    expect(importeCampo(1800050)).toBe('18000,50')
  })
  it('el mensaje de datos de pago no tiene datos clínicos y solo lo que está cargado', () => {
    const m = mensajeDatosPago({ nombre: 'Ana', concepto: 'Consulta de control', importe: 1800000, alias: 'julia.consultorio', cbu: null, titular: 'Julia Paredes', qr: false }, pesos)
    expect(m).toBe('Hola Ana, te paso los datos para pagar consulta de control:\nImporte: $ 18.000\nAlias: julia.consultorio\nTitular: Julia Paredes')
  })
})

describe('Paso 1: a quién se cobra', () => {
  it('separa lo de hoy («Terminaron y falta cobrar») de lo que deben de antes', async () => {
    const { navegador, db } = await conSesion()
    atender(db)
    const html = await (await navegador.pedir('/cobros/nuevo')).text()
    const [hoyParte, ...resto] = html.split('Te deben de antes')
    const antes = resto.join('')
    expect(hoyParte).toContain('Terminaron y falta cobrar')
    expect(hoyParte).toContain('Lucía Benítez')
    expect(hoyParte).toContain('$ 25.000')
    expect(antes).toContain('Ana Gómez')      // debe $ 8.000 de su control
    expect(antes).toContain('$ 8.000')
    expect(antes).toContain('Tomás Ferreyra') // atendido hace 35 días, sin cobro (obra social: copago)
    expect(html).toContain('Hoy cobraste $ 0')
  })
  it('desde la ficha: si hay una sola cosa para cobrar, va directo', async () => {
    const { navegador } = await conSesion()
    expect((await navegador.pedir('/cobros/nuevo?paciente=2')).headers.get('location')).toBe('/cobros/nuevo?cobro=1')
    const sinDeuda = await (await navegador.pedir('/cobros/nuevo?paciente=4')).text()
    expect(sinDeuda).toContain('Cobro sin turno')
  })
  it('desde el turno o la consulta', async () => {
    const { navegador, db } = await conSesion()
    atender(db)
    expect(await (await navegador.pedir('/cobros/nuevo?turno=4')).text()).toContain('value="25000"')
    db.exec(`INSERT INTO consultas (paciente_id, turno_id, tipo) VALUES (3, 4, 'primera')`)
    const k = uno(db, 'SELECT MAX(id) id FROM consultas').id
    expect((await navegador.pedir(`/cobros/nuevo?consulta=${k}`)).headers.get('location')).toBe('/cobros/nuevo?turno=4')
    // un turno que no está atendido no se cobra
    expect((await navegador.pedir('/cobros/nuevo?turno=5')).status).toBe(404)
  })
})

describe('Paso 2: guardar', () => {
  it('pagó todo: crea el cobro y el pago y lleva al comprobante', async () => {
    const { navegador, db } = await conSesion()
    atender(db)
    const r = await navegador.pedir('/cobros', { form: { tipo: 'turno', id: '4', importe: '25.000', cuanto: 'todo', medio: 'transferencia', clave: nuevaClave() } })
    const pago = uno(db, 'SELECT p.id, p.importe, p.medio, c.turno_id, c.concepto, c.cobertura FROM pagos p JOIN cobros c ON c.id = p.cobro_id WHERE c.turno_id = 4')
    expect(pago).toMatchObject({ importe: 2500000, medio: 'transferencia', turno_id: 4, concepto: 'Primera consulta', cobertura: 'particular' })
    expect(r.headers.get('location')).toBe(`/comprobantes/nuevo?pago=${pago.id}`)
    expect(uno(db, `SELECT COUNT(*) n FROM auditoria WHERE evento = 'pago_registrado'`).n).toBe(1)
  })
  it('el doble clic no paga dos veces', async () => {
    const { navegador, db } = await conSesion()
    atender(db)
    const form = { tipo: 'turno', id: '4', importe: '25000', cuanto: 'todo', medio: 'efectivo', clave: nuevaClave() }
    const a = await navegador.pedir('/cobros', { form })
    const b = await navegador.pedir('/cobros', { form })
    expect(b.headers.get('location')).toBe(a.headers.get('location'))
    expect(uno(db, 'SELECT COUNT(*) n FROM pagos p JOIN cobros c ON c.id = p.cobro_id WHERE c.turno_id = 4').n).toBe(1)
  })
  it('una parte: queda debiendo el resto; después se cobra lo que falta', async () => {
    const { navegador, db } = await conSesion()
    atender(db)
    await navegador.pedir('/cobros', { form: { tipo: 'turno', id: '4', importe: '25000', cuanto: 'parte', parte: '10.000', medio: 'efectivo', clave: nuevaClave() } })
    const cobro = uno(db, 'SELECT id, saldo, estado FROM v_cobros WHERE turno_id = 4')
    expect(cobro).toMatchObject({ saldo: 1500000, estado: 'parcial' })
    // pagar más de lo que falta no se puede
    const mal = await navegador.pedir('/cobros', { form: { tipo: 'cobro', id: String(cobro.id), cuanto: 'parte', parte: '20000', medio: 'efectivo', clave: nuevaClave() } })
    expect(mal.status).toBe(422)
    await navegador.pedir('/cobros', { form: { tipo: 'cobro', id: String(cobro.id), cuanto: 'todo', medio: 'tarjeta', clave: nuevaClave() } })
    expect(uno(db, 'SELECT saldo, estado FROM v_cobros WHERE id = ?', cobro.id)).toEqual({ saldo: 0, estado: 'pagado' })
    // ya pagado: el turno lleva al cobro
    expect((await navegador.pedir('/cobros/nuevo?turno=4')).headers.get('location')).toBe(`/cobros/${cobro.id}`)
  })
  it('nada por ahora: queda en «Te deben», sin pago', async () => {
    const { navegador, db } = await conSesion()
    atender(db)
    const r = await navegador.pedir('/cobros', { form: { tipo: 'turno', id: '4', importe: '25000', cuanto: 'nada', medio: 'efectivo', clave: nuevaClave() } })
    const cobro = uno(db, 'SELECT id, saldo, estado FROM v_cobros WHERE turno_id = 4')
    expect(cobro).toMatchObject({ saldo: 2500000, estado: 'debe' })
    expect(r.headers.get('location')).toBe(`/cobros/${cobro.id}?aviso=te_deben`)
    expect(uno(db, 'SELECT COUNT(*) n FROM pagos WHERE cobro_id = ?', cobro.id).n).toBe(0)
  })
  it('con obra social se cobra el copago, que puede ser 0 («Sin cargo»)', async () => {
    const { navegador, db } = await conSesion()
    // Tomás (id 1) tiene OSDE: su turno atendido de hace 35 días (id 1)
    expect(await (await navegador.pedir('/cobros/nuevo?turno=1')).text()).toContain('Copago (puede ser 0)')
    const r = await navegador.pedir('/cobros', { form: { tipo: 'turno', id: '1', importe: '0', cuanto: 'todo', medio: 'efectivo', clave: nuevaClave() } })
    const cobro = uno(db, 'SELECT id, importe, cobertura, obra_social_id, estado FROM v_cobros WHERE turno_id = 1')
    expect(cobro).toMatchObject({ importe: 0, cobertura: 'obra_social', obra_social_id: 1, estado: 'sin_cargo' })
    expect(r.headers.get('location')).toBe(`/cobros/${cobro.id}?aviso=sin_cargo`)
  })
  it('cobro sin turno, con prestación u otro concepto', async () => {
    const { navegador, db } = await conSesion()
    await navegador.pedir('/cobros', { form: { tipo: 'libre', id: '4', prestacion: '2', importe: '18000', cuanto: 'todo', medio: 'efectivo', clave: nuevaClave() } })
    expect(uno(db, 'SELECT concepto, prestacion_id, cobertura, turno_id FROM cobros WHERE paciente_id = 4')).toEqual({ concepto: 'Consulta de control', prestacion_id: 2, cobertura: 'obra_social', turno_id: null })
    await navegador.pedir('/cobros', { form: { tipo: 'libre', id: '3', prestacion: '', concepto: 'Informe escrito', importe: '5000', cuanto: 'nada', medio: 'efectivo', clave: nuevaClave() } })
    expect(uno(db, 'SELECT concepto, prestacion_id FROM cobros WHERE paciente_id = 3')).toEqual({ concepto: 'Informe escrito', prestacion_id: null })
  })
  it('errores: vuelve al formulario con lo que escribió', async () => {
    const { navegador, db } = await conSesion()
    atender(db)
    const r = await navegador.pedir('/cobros', { form: { tipo: 'turno', id: '4', importe: 'mucho', cuanto: 'todo', medio: 'efectivo', clave: nuevaClave() } })
    expect(r.status).toBe(422)
    const html = await r.text()
    expect(html).toContain('Revisá el importe')
    expect(html).toContain('value="mucho"')
    expect(uno(db, 'SELECT COUNT(*) n FROM cobros WHERE turno_id = 4').n).toBe(0)
  })
})

describe('Anular', () => {
  async function conPago() {
    const e = await conSesion()
    atender(e.db)
    await e.navegador.pedir('/cobros', { form: { tipo: 'turno', id: '4', importe: '25000', cuanto: 'todo', medio: 'efectivo', clave: nuevaClave() } })
    const pago = uno(e.db, 'SELECT p.id, p.cobro_id FROM pagos p JOIN cobros c ON c.id = p.cobro_id WHERE c.turno_id = 4')
    return { ...e, pago }
  }
  it('un pago se anula con motivo y su comprobante interno queda anulado en el mismo paso', async () => {
    const { navegador, db, pago } = await conPago()
    db.exec(`INSERT INTO comprobantes (pago_id, tipo, numero, receptor_nombre, receptor_doc_tipo, receptor_doc, importe, fecha, estado)
             VALUES (${pago.id}, 'interno', 1, 'Lucía Benítez', 'dni', '40555666', 2500000, '${hoy}', 'emitido')`)
    expect((await navegador.pedir(`/pagos/${pago.id}/anular`, { form: { motivo: '' } })).headers.get('location')).toContain('error=')
    const r = await navegador.pedir(`/pagos/${pago.id}/anular`, { form: { motivo: 'Importe mal cargado' } })
    expect(r.headers.get('location')).toBe(`/cobros/${pago.cobro_id}?aviso=pago_anulado`)
    expect(uno(db, 'SELECT anulado_motivo FROM pagos WHERE id = ?', pago.id).anulado_motivo).toBe('Importe mal cargado')
    expect(uno(db, 'SELECT estado, anulado_motivo FROM comprobantes WHERE pago_id = ?', pago.id)).toEqual({ estado: 'anulado', anulado_motivo: 'Importe mal cargado' })
    expect(uno(db, 'SELECT saldo FROM v_cobros WHERE id = ?', pago.cobro_id).saldo).toBe(2500000)
    const detalle = await (await navegador.pedir(`/cobros/${pago.cobro_id}`)).text()
    expect(detalle).toContain('Anulado: Importe mal cargado')
    expect(detalle).toContain('Anular el cobro') // sin pagos vigentes, el cobro se puede anular
  })
  it('un pago con factura C no se anula acá (lleva nota de crédito)', async () => {
    const { navegador, db, pago } = await conPago()
    db.exec(`INSERT INTO comprobantes (pago_id, tipo, punto_venta, receptor_nombre, receptor_doc_tipo, receptor_doc, importe, fecha, estado)
             VALUES (${pago.id}, 'factura_c', 2, 'Lucía Benítez', 'dni', '40555666', 2500000, '${hoy}', 'pendiente')`)
    const r = await navegador.pedir(`/pagos/${pago.id}/anular`, { form: { motivo: 'Error' } })
    expect(decodeURIComponent(r.headers.get('location')!)).toContain('nota de crédito')
    expect(uno(db, 'SELECT anulado_en FROM pagos WHERE id = ?', pago.id).anulado_en).toBeNull()
  })
  it('un cobro con pagos no se anula; sin pagos sí', async () => {
    const { navegador, db, pago } = await conPago()
    const r = await navegador.pedir(`/cobros/${pago.cobro_id}/anular`, { form: { motivo: 'Cargado dos veces' } })
    expect(decodeURIComponent(r.headers.get('location')!)).toContain('Primero anulá sus pagos')
    await navegador.pedir(`/pagos/${pago.id}/anular`, { form: { motivo: 'Error' } })
    await navegador.pedir(`/cobros/${pago.cobro_id}/anular`, { form: { motivo: 'Cargado dos veces' } })
    expect(uno(db, 'SELECT estado FROM v_cobros WHERE id = ?', pago.cobro_id).estado).toBe('anulado')
    // anulado, el turno vuelve a quedar para cobrar
    expect(await (await navegador.pedir('/cobros/nuevo?turno=4')).text()).toContain('value="25000"')
  })
})

describe('Lista, Hoy y ficha', () => {
  it('Cobros con filtros y búsqueda', async () => {
    const { navegador, db } = await conSesion()
    atender(db)
    await navegador.pedir('/cobros', { form: { tipo: 'turno', id: '4', importe: '25000', cuanto: 'todo', medio: 'efectivo', clave: nuevaClave() } })
    const lista = await (await navegador.pedir('/cobros')).text()
    expect(lista).toContain('Lucía Benítez')
    expect(lista).toContain('Ana Gómez')
    expect(lista).toContain('Hoy cobraste')
    const deben = await (await navegador.pedir('/cobros?filtro=deben')).text()
    expect(deben).toContain('Ana Gómez')
    expect(deben).not.toContain('Lucía Benítez')
    expect(await (await navegador.pedir('/cobros?q=benitez')).text()).not.toContain('Ana Gómez')
  })
  it('«Plata de hoy» en Hoy: cobrado hoy y lo que te deben', async () => {
    const { navegador, db } = await conSesion()
    atender(db)
    await navegador.pedir('/cobros', { form: { tipo: 'turno', id: '4', importe: '25000', cuanto: 'parte', parte: '20000', medio: 'efectivo', clave: nuevaClave() } })
    const html = await (await navegador.pedir('/')).text()
    expect(html).toContain('Plata de hoy')
    expect(html).toMatch(/Cobrado<\/span><strong class="dato-grande">\$ 20\.000/)
    // Te deben: $ 8.000 de Ana + $ 5.000 de Lucía (Tomás tiene obra social: copago 0)
    expect(html).toMatch(/Te deben<\/span><strong class="dato-grande debe-texto">\$ 13\.000/)
  })
  it('sin el módulo de cobros no hay Plata de hoy ni rutas de cobro', async () => {
    const { navegador } = await conSesion({ MODULOS: 'agenda' })
    expect(await (await navegador.pedir('/')).text()).not.toContain('Plata de hoy')
    expect((await navegador.pedir('/cobros')).status).toBe(404)
    expect((await navegador.pedir('/cobros/nuevo')).status).toBe(404)
    expect((await navegador.pedir('/pagos/1/anular', { form: { motivo: 'x' } })).status).toBe(404)
  })
  it('la pestaña Pagos de la ficha lleva al cobro y al comprobante', async () => {
    const { navegador } = await conSesion()
    const html = await (await navegador.pedir('/pacientes/2?tab=pagos')).text()
    expect(html).toContain('href="/cobros/1"')
    expect(html).toMatch(/href="\/comprobantes\/nuevo\?pago=\d+"/)
  })
  it('el QR para transferir se sirve solo si es una imagen cargada', async () => {
    const { navegador } = await conSesion()
    expect((await navegador.pedir('/cobros/qr')).status).toBe(404)
  })
})
