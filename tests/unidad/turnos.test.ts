// P2a · Dar turno: huecos, controles, repetición y la pantalla de tres pasos contra la app real.
import { describe, it, expect } from 'vitest'
import { entorno, CLAVE_PRUEBA } from './ayuda'
import { ahoraAR, sumarDias } from '../../src/lib/fechas'
import { aMinutos, controlar, diaDe, diaDeSemana, fechasDeSerie, huecos, leerTurno, type DatosAgenda } from '../../src/lib/turnos'

async function conSesion() {
  const e = entorno()
  await e.navegador.pedir('/ingresar/prueba', { form: { clave: CLAVE_PRUEBA } })
  return e
}
const todos = (db: ReturnType<typeof entorno>['db'], sql: string, ...args: any[]) => db.prepare(sql).all(...args) as any[]

/** El próximo día de la semana pedido (1 = lunes) que cae al menos una semana adelante. */
function proximo(dia: number, desde = 7) {
  let f = sumarDias(ahoraAR().fecha, desde)
  while (diaDeSemana(f) !== dia) f = sumarDias(f, 1)
  return f
}

const agenda = (cambios: Partial<DatosAgenda> = {}): DatosAgenda => ({
  horarios: [{ consultorio_id: 1, dia: 1, desde: '08:00', hasta: '10:00' }], turnos: [], propuestas: [], bloqueos: [], feriados: [], ...cambios,
})
const LUNES = '2030-01-07'

describe('Huecos y controles', () => {
  it('ofrece huecos cada 30 minutos dentro del horario, según la duración', () => {
    const dia = diaDe(agenda(), 1, LUNES)
    expect(huecos(dia, 30, '2029-01-01', 0)).toEqual(['08:00', '08:30', '09:00', '09:30'])
    expect(huecos(dia, 45, '2029-01-01', 0)).toEqual(['08:00', '08:30', '09:00'])
  })
  it('no ofrece lo que pisa un turno, un horario propuesto o un bloqueo de horas', () => {
    const d = agenda({
      turnos: [{ fecha: LUNES, hora: '08:30', duracion_min: 30, paciente: 'Ana Gómez' }],
      bloqueos: [{ desde: LUNES, hasta: LUNES, hora_desde: '09:30', hora_hasta: '10:00', consultorio_id: null, motivo: 'personal', detalle: null }],
    })
    expect(huecos(diaDe(d, 1, LUNES), 30, '2029-01-01', 0)).toEqual(['08:00', '09:00'])
  })
  it('un feriado sin atención o un bloqueo de todo el día cierran el día; «atiende» lo reabre', () => {
    const feriado = agenda({ feriados: [{ fecha: LUNES, nombre: 'Feriado de prueba', atiende: null }] })
    expect(diaDe(feriado, 1, LUNES).cerrado?.tipo).toBe('feriado')
    expect(huecos(diaDe(feriado, 1, LUNES), 30, '2029-01-01', 0)).toEqual([])
    expect(diaDe(agenda({ feriados: [{ fecha: LUNES, nombre: 'x', atiende: 1 }] }), 1, LUNES).cerrado).toBeNull()
    const bloqueo = agenda({ bloqueos: [{ desde: '2030-01-01', hasta: '2030-01-10', hora_desde: null, hora_hasta: null, consultorio_id: 2, motivo: 'vacaciones', detalle: null }] })
    expect(diaDe(bloqueo, 1, LUNES).cerrado).toBeNull() // es de otro consultorio
    expect(diaDe(bloqueo, 2, LUNES).cerrado?.texto).toBe('Vacaciones')
  })
  it('hoy solo ofrece lo que falta', () => {
    expect(huecos(diaDe(agenda(), 1, LUNES), 30, LUNES, aMinutos('08:45'))).toEqual(['09:00', '09:30'])
  })
  it('avisa superposición y fuera de horario, y frena lo pasado o bloqueado', () => {
    const d = diaDe(agenda({ turnos: [{ fecha: LUNES, hora: '08:00', duracion_min: 30, paciente: 'Ana Gómez' }] }), 1, LUNES)
    expect(controlar(d, '08:15', 30, '2029-01-01', 0).avisos.map((a) => a.tipo)).toEqual(['superpone'])
    expect(controlar(d, '09:45', 30, '2029-01-01', 0).avisos.map((a) => a.tipo)).toEqual(['fuera_horario'])
    expect(controlar(d, '09:00', 30, '2029-01-01', 0)).toEqual({ errores: [], avisos: [] })
    expect(controlar(d, '09:00', 30, '2030-02-01', 0).errores).toEqual(['Ese horario ya pasó.'])
    const bloqueado = diaDe(agenda({ bloqueos: [{ desde: LUNES, hasta: LUNES, hora_desde: '09:00', hora_hasta: '09:30', consultorio_id: null, motivo: 'congreso', detalle: null }] }), 1, LUNES)
    expect(controlar(bloqueado, '09:00', 30, '2029-01-01', 0).errores[0]).toMatch(/bloqueado/)
  })
  it('la serie sigue cada N semanas hasta la fecha final, sin pasar de un año', () => {
    expect(fechasDeSerie('2030-01-07', 2, '2030-02-04')).toEqual(['2030-01-07', '2030-01-21', '2030-02-04'])
    expect(fechasDeSerie('2030-01-07', 1, '2040-01-01').length).toBe(52)
  })
  it('valida lo que llega del formulario', () => {
    const ok = { paciente: '1', consultorio: '1', prestacion: '2', fecha: LUNES, hora: '08:00' }
    expect(leerTurno(ok).datos?.repetir).toBeNull()
    expect(leerTurno({ ...ok, hora: '25:00' }).error).toBeTruthy()
    expect(leerTurno({ ...ok, repetir: '1', cada: '0', hasta: '2030-03-01' }).error).toMatch(/semanas/)
    expect(leerTurno({ ...ok, repetir: '1', cada: '2', hasta: LUNES }).error).toMatch(/posterior/)
    expect(leerTurno({ ...ok, repetir: '1', cada: '2', hasta: '2030-03-04' }).datos?.repetir).toEqual({ cada: 2, hasta: '2030-03-04' })
  })
})

describe('Dar turno · pantalla', () => {
  it('primer paso: los últimos que vinieron y la búsqueda sin tildes', async () => {
    const { navegador } = await conSesion()
    const html = await (await navegador.pedir('/turnos/nuevo')).text()
    expect(html).toContain('¿Para quién es?')
    expect(html).toContain('Tomás Ferreyra')
    expect(html).not.toContain('Lucía Benítez') // nunca vino
    const busca = await (await navegador.pedir('/turnos/nuevo?q=benitez')).text()
    expect(busca).toContain('Lucía Benítez')
    expect(busca).toContain('/turnos/nuevo?paciente=3')
  })
  it('no ofrece a un paciente dado de baja', async () => {
    const { navegador, db } = await conSesion()
    db.exec("UPDATE turnos SET estado='cancelado', cancelado_por='profesional', cerrado_en='2030-01-01T00:00:00Z' WHERE paciente_id=4")
    db.exec("UPDATE pacientes SET baja_en='2030-01-01T00:00:00Z', baja_motivo='otro' WHERE id=4")
    expect(await (await navegador.pedir('/turnos/nuevo?q=sosa')).text()).not.toContain('paciente=4')
    expect(await (await navegador.pedir('/turnos/nuevo?paciente=4')).text()).toContain('Esa ficha no está disponible')
  })
  it('segundo paso: días del consultorio y huecos por mañana y tarde, con la prestación según el historial', async () => {
    const { navegador } = await conSesion()
    const html = await (await navegador.pedir('/turnos/nuevo?paciente=3&consultorio=1')).text()
    expect(html).toContain('Lucía Benítez · cambiar')
    expect(html).toContain('aria-current="true">Primera consulta · 45 min')
    expect(html).toMatch(/Mañana/)
    expect(html).toContain('class="pastilla hueco"')
    const control = await (await navegador.pedir('/turnos/nuevo?paciente=1&consultorio=1')).text()
    expect(control).toContain('aria-current="true">Consulta de control · 30 min')
  })
  it('un feriado figura sin atención y se puede abrir', async () => {
    const { navegador, db } = await conSesion()
    const lunes = proximo(1)
    db.prepare("INSERT INTO feriados (fecha, nombre) VALUES (?, 'Feriado de prueba')").run(lunes)
    const url = `/turnos/nuevo?paciente=1&consultorio=1&fecha=${lunes}`
    const antes = await (await navegador.pedir(url)).text()
    expect(antes).toContain('Feriado de prueba')
    expect(antes).not.toContain('class="pastilla hueco"')
    const r = await navegador.pedir('/turnos/feriado', { form: { fecha: lunes, volver: url } })
    expect(r.status).toBe(302)
    expect(todos(db, 'SELECT atiende FROM feriados WHERE fecha = ?', lunes)[0].atiende).toBe(1)
    expect(await (await navegador.pedir(url)).text()).toContain('class="pastilla hueco"')
  })
  it('alta rápida con DNI: si ya existe usa esa ficha, si es nuevo la crea', async () => {
    const { navegador, db } = await conSesion()
    const existe = await navegador.pedir('/turnos/paciente', { form: { dni: '30.111.222', nombre: 'X', apellido: 'Y', celular: '3431234567' } })
    expect(existe.headers.get('location')).toBe('/turnos/nuevo?paciente=1')
    const mal = await navegador.pedir('/turnos/paciente', { form: { dni: '1', nombre: '', apellido: '', celular: '' } })
    expect(mal.status).toBe(422)
    expect(await mal.text()).toContain('Falta el nombre.')
    const nueva = await navegador.pedir('/turnos/paciente', { form: { dni: '46111222', nombre: 'Lara', apellido: 'Méndez', celular: '3431234567' } })
    expect(todos(db, "SELECT id FROM pacientes WHERE dni = '46111222'").length).toBe(1)
    expect(nueva.headers.get('location')).toMatch(/paciente=\d+$/)
  })
})

describe('Dar turno · guardar', () => {
  const form = (fecha: string, extra: Record<string, string> = {}) => ({ paciente: '1', consultorio: '1', prestacion: '2', fecha, hora: '08:30', ...extra })

  it('guarda el turno en la ficha, con su cobertura y atención, y deja el aviso de WhatsApp listo', async () => {
    const { navegador, db } = await conSesion()
    const lunes = proximo(1)
    const r = await navegador.pedir('/turnos', { form: form(lunes, { avisar: '1' }) })
    expect(r.status).toBe(302)
    const t = todos(db, 'SELECT * FROM turnos WHERE fecha = ?', lunes)[0]
    expect(t).toMatchObject({ paciente_id: 1, consultorio_id: 1, hora: '08:30', duracion_min: 30, estado: 'confirmado', cobertura: 'obra_social', obra_social_id: 1, atencion: 'control', serie_id: null })
    expect(r.headers.get('location')).toBe(`/turnos/${t.id}/listo?avisar=1`)
    const listo = await (await navegador.pedir(r.headers.get('location')!)).text()
    expect(listo).toContain('Turno dado')
    expect(listo).toContain('https://wa.me/5493431111111?text=')
    expect(todos(db, "SELECT 1 FROM auditoria WHERE evento = 'turno_alta'").length).toBe(1)
  })
  it('el primer turno de un paciente que nunca vino queda como primera consulta', async () => {
    const { navegador, db } = await conSesion()
    const lunes = proximo(1)
    await navegador.pedir('/turnos', { form: form(lunes, { paciente: '3', prestacion: '1' }) })
    expect(todos(db, 'SELECT atencion, cobertura FROM turnos WHERE paciente_id = 3 AND fecha = ?', lunes)[0]).toEqual({ atencion: 'primera', cobertura: 'particular' })
  })
  it('si se superpone pide confirmar; con «guardar igual» entra', async () => {
    const { navegador, db } = await conSesion()
    const lunes = proximo(1)
    await navegador.pedir('/turnos', { form: form(lunes) })
    const choca = await navegador.pedir('/turnos', { form: form(lunes, { paciente: '2' }) })
    expect(choca.status).toBe(409)
    expect(await choca.text()).toContain('Se superpone con el turno de Tomás Ferreyra')
    expect(todos(db, 'SELECT 1 FROM turnos WHERE fecha = ?', lunes).length).toBe(1)
    const igual = await navegador.pedir('/turnos', { form: form(lunes, { paciente: '2', forzar: '1' }) })
    expect(igual.status).toBe(302)
    expect(todos(db, 'SELECT 1 FROM turnos WHERE fecha = ?', lunes).length).toBe(2)
  })
  it('un horario fuera de lo que atendés avisa, y uno bloqueado o pasado no se guarda', async () => {
    const { navegador, db } = await conSesion()
    const lunes = proximo(1)
    const fuera = await navegador.pedir('/turnos', { form: form(lunes, { hora: '13:00' }) })
    expect(fuera.status).toBe(409)
    expect(await fuera.text()).toContain('fuera de tu horario')
    db.prepare("INSERT INTO bloqueos (desde, hasta, motivo) VALUES (?, ?, 'congreso')").run(lunes, lunes)
    const bloq = await navegador.pedir('/turnos', { form: form(lunes, { forzar: '1' }) })
    expect(bloq.status).toBe(422)
    expect(await bloq.text()).toContain('bloqueada')
    const pasado = await navegador.pedir('/turnos', { form: form(sumarDias(ahoraAR().fecha, -7)) })
    expect(pasado.status).toBe(422)
    expect(todos(db, 'SELECT 1 FROM turnos WHERE fecha > ?', ahoraAR().fecha).length).toBe(1) // solo el turno futuro del seed
  })
  it('repetir crea la serie y saltea las fechas que no se pueden', async () => {
    const { navegador, db } = await conSesion()
    const lunes = proximo(1)
    db.prepare("INSERT INTO bloqueos (desde, hasta, motivo) VALUES (?, ?, 'vacaciones')").run(sumarDias(lunes, 14), sumarDias(lunes, 14))
    const r = await navegador.pedir('/turnos', { form: form(lunes, { repetir: '1', cada: '1', hasta: sumarDias(lunes, 21) }) })
    const fechas = todos(db, 'SELECT fecha, serie_id FROM turnos WHERE paciente_id = 1 AND fecha >= ? ORDER BY fecha', lunes)
    expect(fechas.map((f) => f.fecha)).toEqual([lunes, sumarDias(lunes, 7), sumarDias(lunes, 21)])
    expect(new Set(fechas.map((f) => f.serie_id)).size).toBe(1)
    expect(todos(db, 'SELECT cada_semanas FROM series')[0].cada_semanas).toBe(1)
    const listo = await (await navegador.pedir(r.headers.get('location')!)).text()
    expect(listo).toContain('3 turnos, cada semana')
    expect(listo).toContain('No se pudieron dar el turno del')
  })
  it('rechaza datos incompletos, consultorios apagados y pacientes de baja', async () => {
    const { navegador, db } = await conSesion()
    const lunes = proximo(1)
    expect((await navegador.pedir('/turnos', { form: { paciente: '1' } })).status).toBe(422)
    db.exec('UPDATE consultorios SET activo = 0 WHERE id = 1')
    expect((await navegador.pedir('/turnos', { form: form(lunes) })).status).toBe(422)
    db.exec('UPDATE consultorios SET activo = 1 WHERE id = 1')
    db.exec("UPDATE turnos SET estado='cancelado', cancelado_por='profesional', cerrado_en='2030-01-01T00:00:00Z' WHERE paciente_id=1 AND estado='confirmado'")
    db.exec("UPDATE pacientes SET baja_en='2030-01-01T00:00:00Z', baja_motivo='otro' WHERE id=1")
    expect((await navegador.pedir('/turnos', { form: form(lunes) })).status).toBe(422)
  })
  it('pide sesión y respeta el módulo de agenda', async () => {
    const { navegador, env } = entorno()
    expect((await navegador.pedir('/turnos/nuevo')).status).toBe(302)
    const sin = entorno({ MODULOS: 'documentos' })
    await sin.navegador.pedir('/ingresar/prueba', { form: { clave: CLAVE_PRUEBA } })
    expect((await sin.navegador.pedir('/turnos/nuevo')).status).toBe(404)
    void env
  })
})
