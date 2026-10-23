// P1 · Pacientes: lista, alta rápida, ficha, edición, baja y reactivación (docs/ANALISIS_FUNCIONAL.md, flujo 15).
import { describe, it, expect } from 'vitest'
import { entorno, CLAVE_PRUEBA } from './ayuda'
import { normalizarDni, validarAlta, sinTildes, enlaceWhatsapp } from '../../src/lib/pacientes'

async function conSesion(cambios = {}) {
  const e = entorno(cambios)
  await e.navegador.pedir('/ingresar/prueba', { form: { clave: CLAVE_PRUEBA } })
  return e
}
const uno = (db: ReturnType<typeof entorno>['db'], sql: string, ...args: any[]) => db.prepare(sql).get(...args) as any

describe('Validación', () => {
  it('el DNI se guarda solo con números', () => {
    expect(normalizarDni('30.111.222')).toBe('30111222')
    expect(normalizarDni(' 30 111 222 ')).toBe('30111222')
    expect(normalizarDni('ABC123')).toBe('#')
  })
  it('el alta rápida pide DNI, nombre, apellido y celular; el correo es opcional', () => {
    expect(Object.keys(validarAlta({}).errores).sort()).toEqual(['apellido', 'celular', 'dni', 'nombre'])
    expect(validarAlta({ dni: '123', nombre: 'A', apellido: 'B', celular: '3430000000' }).errores.dni).toMatch(/entre 6 y 10/)
    expect(validarAlta({ dni: '30111999', nombre: 'A', apellido: 'B', celular: '3430000000', correo: 'sin-arroba' }).errores.correo).toBeTruthy()
    expect(validarAlta({ dni: '30.111.999', nombre: ' Ana  María ', apellido: 'B', celular: '343 000-0000' }).errores).toEqual({})
  })
  it('búsqueda sin tildes y enlace de WhatsApp', () => {
    expect(sinTildes('Gómez Benítez Ñandú')).toBe('gomez benitez nandu')
    expect(enlaceWhatsapp('343 155-0000')).toBe('https://wa.me/5493431550000')
    expect(enlaceWhatsapp('+54 9 343 111-1111')).toBe('https://wa.me/5493431111111')
  })
})

describe('Lista de pacientes', () => {
  it('muestra los pacientes con sus marcas y las cantidades de cada filtro', async () => {
    const { navegador } = await conSesion()
    const html = await (await navegador.pedir('/pacientes')).text()
    expect(html).toContain('4 pacientes')
    expect(html).toContain('Lucía Benítez')
    expect(html).toContain('Ficha incompleta')
    expect(html).toMatch(/Te deben<span class="cuenta">1</)
    expect(html).toMatch(/Primera consulta<span class="cuenta">2</)
  })
  it('busca sin importar tildes, por DNI con puntos y por celular', async () => {
    const { navegador } = await conSesion()
    const buscar = async (q: string) => (await (await navegador.pedir(`/pacientes?q=${encodeURIComponent(q)}`)).text())
    expect(await buscar('gomez')).toContain('Ana Gómez')
    expect(await buscar('gomez')).not.toContain('Tomás Ferreyra')
    expect(await buscar('BENITEZ luc')).toContain('Lucía Benítez')
    expect(await buscar('28.333')).toContain('Ana Gómez')
    expect(await buscar('3434444')).toContain('Martín Sosa')
    expect(await buscar('nadie así')).toContain('No encontramos pacientes')
  })
  it('el filtro «Te deben» deja solo a quien tiene saldo', async () => {
    const { navegador } = await conSesion()
    const html = await (await navegador.pedir('/pacientes?filtro=deben')).text()
    expect(html).toContain('Ana Gómez')
    expect(html).not.toContain('Tomás Ferreyra')
  })
})

describe('Alta rápida', () => {
  it('crea la ficha incompleta y la abre', async () => {
    const { navegador, db } = await conSesion()
    const r = await navegador.pedir('/pacientes', { form: { dni: '45.678.901', nombre: 'Martina', apellido: 'Gómez', celular: '11 5555-0103', correo: '' } })
    const p = uno(db, `SELECT id, dni, correo FROM pacientes WHERE dni = '45678901'`)
    expect(p).toMatchObject({ dni: '45678901', correo: null })
    expect(r.headers.get('location')).toBe(`/pacientes/${p.id}?aviso=nuevo`)
    const ficha = await (await navegador.pedir(r.headers.get('location')!)).text()
    expect(ficha).toContain('Martina Gómez')
    expect(ficha).toContain('Ficha incompleta')
    expect(uno(db, `SELECT COUNT(*) n FROM auditoria WHERE evento = 'paciente_alta'`).n).toBe(1)
  })
  it('si el DNI ya existe, muestra esa ficha y no crea otra', async () => {
    const { navegador, db } = await conSesion()
    const r = await navegador.pedir('/pacientes', { form: { dni: '28.333.444', nombre: 'Otra', apellido: 'Persona', celular: '3431234567' } })
    expect(r.headers.get('location')).toBe('/pacientes/2?aviso=existe')
    expect(uno(db, 'SELECT COUNT(*) n FROM pacientes').n).toBe(4)
    expect(await (await navegador.pedir('/pacientes/2?aviso=existe')).text()).toContain('Ese DNI ya era de Ana Gómez')
  })
  it('con datos que faltan vuelve al formulario con los errores', async () => {
    const { navegador } = await conSesion()
    const r = await navegador.pedir('/pacientes', { form: { dni: '', nombre: 'Sin', apellido: '', celular: '' } })
    expect(r.status).toBe(422)
    const html = await r.text()
    expect(html).toContain('Falta el DNI.')
    expect(html).toContain('value="Sin"')
  })
})

describe('Ficha', () => {
  it('muestra los datos, el saldo y las pestañas', async () => {
    const { navegador } = await conSesion()
    const html = await (await navegador.pedir('/pacientes/2')).text()
    expect(html).toContain('DNI 28.333.444')
    expect(html).toContain('Cobrar $ 8.000')
    for (const t of ['Resumen', 'Historia clínica', 'Turnos', 'Pagos', 'Documentos']) expect(html).toContain(`>${t}<`)
    const pagos = await (await navegador.pedir('/pacientes/2?tab=pagos')).text()
    expect(pagos).toContain('Pagó $ 10.000')
    expect(pagos).toContain('Debe $ 8.000')
    const turnos = await (await navegador.pedir('/pacientes/2?tab=turnos')).text()
    expect(turnos).toContain('Atendido')
  })
  it('sin el módulo de cobros no hay pestaña Pagos ni botón de cobrar', async () => {
    const { navegador } = await conSesion({ MODULOS: 'agenda' })
    const html = await (await navegador.pedir('/pacientes/2')).text()
    expect(html).not.toContain('>Pagos<')
    expect(html).not.toContain('Cobrar $')
    expect((await navegador.pedir('/pacientes/2?tab=pagos')).status).toBe(200) // vuelve al resumen
  })
  it('un paciente que no existe da 404', async () => {
    const { navegador } = await conSesion()
    expect((await navegador.pedir('/pacientes/999')).status).toBe(404)
  })
})

describe('Editar datos', () => {
  const formAna = { nombre: 'Ana', apellido: 'Gómez', dni: '28333444', fecha_nacimiento: '1979-11-02', celular: '+54 9 343 222-2222', correo: '',
    domicilio: 'Calle Inventada 45', ocupacion: 'Contadora', cobertura: 'particular', numero_afiliado: '', consultorio_id: '1', recordatorios: '1' }

  it('guarda los cambios y quedan en el historial', async () => {
    const { navegador, db } = await conSesion()
    const r = await navegador.pedir('/pacientes/2/editar', { form: { ...formAna, domicilio: 'Calle Nueva 10', cobertura: 'os:1', numero_afiliado: '123' } })
    expect(r.headers.get('location')).toBe('/pacientes/2?aviso=editado')
    expect(uno(db, 'SELECT domicilio, cobertura, obra_social_id FROM pacientes WHERE id = 2')).toMatchObject({ domicilio: 'Calle Nueva 10', cobertura: 'obra_social', obra_social_id: 1 })
    expect(uno(db, `SELECT antes, despues FROM pacientes_cambios WHERE paciente_id = 2 AND campo = 'domicilio'`)).toEqual({ antes: 'Calle Inventada 45', despues: 'Calle Nueva 10' })
  })
  it('apagar los recordatorios queda guardado', async () => {
    const { navegador, db } = await conSesion()
    const { recordatorios: _, ...sinRecordatorios } = formAna
    await navegador.pedir('/pacientes/2/editar', { form: sinRecordatorios })
    expect(uno(db, 'SELECT recordatorios_baja FROM pacientes WHERE id = 2').recordatorios_baja).toBe(1)
  })
  it('el cambio de DNI pide confirmación y queda en el historial', async () => {
    const { navegador, db } = await conSesion()
    const primero = await navegador.pedir('/pacientes/2/editar', { form: { ...formAna, dni: '28.333.445' } })
    expect(primero.status).toBe(409)
    expect(await primero.text()).toContain('Vas a cambiar el DNI de 28.333.444 a 28.333.445')
    expect(uno(db, 'SELECT dni FROM pacientes WHERE id = 2').dni).toBe('28333444')
    await navegador.pedir('/pacientes/2/editar', { form: { ...formAna, dni: '28333445', confirmar_dni: '28333445' } })
    expect(uno(db, 'SELECT dni FROM pacientes WHERE id = 2').dni).toBe('28333445')
    expect(uno(db, `SELECT antes FROM pacientes_cambios WHERE paciente_id = 2 AND campo = 'dni'`).antes).toBe('28333444')
  })
  it('un DNI que ya es de otro no se guarda y muestra esa ficha', async () => {
    const { navegador, db } = await conSesion()
    const r = await navegador.pedir('/pacientes/2/editar', { form: { ...formAna, dni: '30111222', confirmar_dni: '30111222' } })
    expect(r.status).toBe(409)
    expect(await r.text()).toContain('href="/pacientes/1"')
    expect(uno(db, 'SELECT dni FROM pacientes WHERE id = 2').dni).toBe('28333444')
  })
})

describe('Dar de baja y reactivar', () => {
  it('si debe plata no se puede dar de baja', async () => {
    const { navegador, db } = await conSesion()
    const r = await navegador.pedir('/pacientes/2/baja', { form: { motivo: 'se_mudo' } })
    expect(r.status).toBe(409)
    expect(uno(db, 'SELECT baja_en FROM pacientes WHERE id = 2').baja_en).toBeNull()
  })
  it('da de baja con motivo, cancela los turnos próximos y deja el aviso para mandar', async () => {
    const { navegador, db } = await conSesion()
    const r = await navegador.pedir('/pacientes/1/baja', { form: { motivo: 'se_mudo' } })
    expect(r.headers.get('location')).toBe('/pacientes/1?aviso=baja')
    expect(uno(db, 'SELECT baja_motivo FROM pacientes WHERE id = 1').baja_motivo).toBe('se_mudo')
    expect(uno(db, `SELECT COUNT(*) n FROM turnos WHERE paciente_id = 1 AND estado = 'cancelado' AND cancelado_por = 'profesional'`).n).toBe(1)
    expect(uno(db, `SELECT COUNT(*) n FROM turnos WHERE paciente_id = 1 AND estado = 'atendido'`).n).toBe(1) // lo pasado no se toca
    const ficha = await (await navegador.pedir('/pacientes/1?aviso=baja')).text()
    expect(ficha).toContain('Se canceló su turno')
    expect(ficha).toContain('https://wa.me/')
    expect(ficha).toContain('Dado de baja el')
    expect(ficha).not.toContain('aria-label="Darle turno"')
    // Sale de «Todos» y aparece en «Dados de baja»
    expect(await (await navegador.pedir('/pacientes')).text()).not.toContain('Tomás Ferreyra')
    expect(await (await navegador.pedir('/pacientes?filtro=baja')).text()).toContain('Tomás Ferreyra')
    // No se edita hasta reactivarlo
    expect((await navegador.pedir('/pacientes/1/editar')).headers.get('location')).toBe('/pacientes/1')
  })
  it('se reactiva y vuelve a la lista', async () => {
    const { navegador, db } = await conSesion()
    await navegador.pedir('/pacientes/1/baja', { form: { motivo: 'otro', detalle: 'Pidió pausar' } })
    const r = await navegador.pedir('/pacientes/1/reactivar', { form: {} })
    expect(r.headers.get('location')).toBe('/pacientes/1?aviso=reactivado')
    expect(uno(db, 'SELECT baja_en FROM pacientes WHERE id = 1').baja_en).toBeNull()
    expect(uno(db, `SELECT COUNT(*) n FROM auditoria WHERE evento IN ('paciente_baja', 'paciente_reactivado')`).n).toBe(2)
  })
  it('un motivo inventado no da de baja', async () => {
    const { navegador, db } = await conSesion()
    expect((await navegador.pedir('/pacientes/1/baja', { form: { motivo: 'cualquiera' } })).status).toBe(422)
    expect(uno(db, 'SELECT baja_en FROM pacientes WHERE id = 1').baja_en).toBeNull()
  })
})
