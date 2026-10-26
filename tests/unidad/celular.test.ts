// P6 · Celular de la profesional: barra de abajo, «Llegó», cancelar con quién cancela, la lista del día y la ficha sin lo clínico.
import { describe, it, expect } from 'vitest'
import { entorno, CLAVE_PRUEBA } from './ayuda'
import { ahoraAR, sumarDias } from '../../src/lib/fechas'
import { diaDeSemana } from '../../src/lib/turnos'

async function conSesion(cambios = {}) {
  const e = entorno(cambios)
  await e.navegador.pedir('/ingresar/prueba', { form: { clave: CLAVE_PRUEBA } })
  return e
}
const uno = (db: ReturnType<typeof entorno>['db'], sql: string, ...args: any[]) => db.prepare(sql).get(...args) as any
const proximo = (dia: number, desde = 7) => { let f = sumarDias(ahoraAR().fecha, desde); while (diaDeSemana(f) !== dia) f = sumarDias(f, 1); return f }
const { fecha: HOY } = ahoraAR()

describe('Barra de abajo', () => {
  it('lleva a Hoy, Agenda (día), Pacientes y Pedidos, y marca dónde estás', async () => {
    const { navegador } = await conSesion()
    const html = await (await navegador.pedir('/pacientes')).text()
    const barra = html.slice(html.indexOf('<nav class="barra-abajo"'), html.indexOf('</nav>', html.indexOf('<nav class="barra-abajo"')))
    for (const href of ['href="/"', 'href="/agenda?vista=dia"', 'href="/pacientes"', 'href="/pedidos"']) expect(barra).toContain(href)
    expect(barra).toMatch(/href="\/pacientes" aria-current="page"/)
  })
  it('sin el módulo de agenda no aparecen Agenda ni Pedidos', async () => {
    const { navegador } = await conSesion({ MODULOS: 'documentos' })
    const html = await (await navegador.pedir('/pacientes')).text()
    expect(html).toContain('class="barra-abajo"')
    expect(html).not.toContain('href="/agenda?vista=dia"')
    expect(html).not.toContain('href="/pedidos"')
  })
  it('Pedidos se arma en la etapa 5: por ahora avisa que llega', async () => {
    const { navegador } = await conSesion()
    const r = await navegador.pedir('/pedidos')
    expect(r.status).toBe(200)
    const html = await r.text()
    expect(html).toContain('Pedidos de turno')
    expect(html).toMatch(/href="\/pedidos" aria-current="page"/)
  })
})

describe('«Llegó» en vez de Atender', () => {
  it('Hoy ofrece Atender en la compu y Llegó en el celular', async () => {
    const { navegador } = await conSesion()
    const html = await (await navegador.pedir('/')).text()
    expect(html).toContain('>Atender<')
    expect(html).toContain('>Llegó<')
    expect(html).toContain('se hacen desde la compu')
  })
  it('deja el turno atendido y vuelve a Hoy con el aviso, sin abrir la consulta', async () => {
    const { navegador, db } = await conSesion()
    const r = await navegador.pedir('/turnos/3/atender', { form: { llego: '1', volver: '/' } })
    expect(r.headers.get('location')).toBe('/?llego=3')
    expect(uno(db, 'SELECT estado FROM turnos WHERE id = 3').estado).toBe('atendido')
    const hoy = await (await navegador.pedir('/?llego=3')).text()
    expect(hoy).toContain('quedó en consulta. Las notas clínicas las escribís en la compu.')
  })
  it('desde la agenda vuelve a la agenda, y nunca a un sitio de afuera', async () => {
    const { navegador } = await conSesion()
    const r = await navegador.pedir('/turnos/3/atender', { form: { llego: '1', volver: `/agenda?vista=dia&fecha=${HOY}` } })
    expect(r.headers.get('location')).toBe(`/agenda?vista=dia&fecha=${HOY}&llego=3`)
    expect(await (await navegador.pedir(`/agenda?vista=dia&fecha=${HOY}&llego=3`)).text()).toContain('Quedó en consulta.')
    const afuera = await navegador.pedir('/turnos/4/atender', { form: { llego: '1', volver: '//malo.test' } })
    expect(afuera.headers.get('location')).toBe('/?llego=4')
  })
})

describe('La hoja del turno', () => {
  it('desde Hoy se abre sobre la agenda y al cerrarla vuelve a Hoy', async () => {
    const { navegador } = await conSesion()
    const hoy = await (await navegador.pedir('/')).text()
    expect(hoy).toContain(`href="/agenda?vista=dia&amp;fecha=${HOY}&amp;turno=3&amp;volver=%2F"`)
    const html = await (await navegador.pedir(`/agenda?vista=dia&fecha=${HOY}&turno=3&volver=%2F`)).text()
    expect(html).toMatch(/<dialog id="v-turno" class="ventana" open="" data-volver="\/"/)
  })
  it('muestra su resumen: alergias, última consulta y saldo', async () => {
    const { navegador, db } = await conSesion()
    const pid = uno(db, 'SELECT paciente_id FROM turnos WHERE id = 3').paciente_id
    db.prepare("INSERT INTO antecedentes (paciente_id, alergias) VALUES (?, 'Penicilina')").run(pid)
    const html = await (await navegador.pedir('/agenda?turno=3')).text()
    expect(html).toContain('Alergias</dt>')
    expect(html).toContain('Penicilina')
    expect(html).toContain('Última consulta</dt>')
    expect(html).toContain('Saldo</dt>')
  })
  it('cancelar pide quién lo cancela antes de hacerlo', async () => {
    const { navegador } = await conSesion()
    const ventana = await (await navegador.pedir('/agenda?turno=6')).text()
    expect(ventana).toContain('href="/agenda?vista=semana&amp;fecha=')
    expect(ventana).toMatch(/cancelar=6"[^>]*>Cancelar y avisar/)
    const html = await (await navegador.pedir('/agenda?cancelar=6')).text()
    expect(html).toContain('<dialog id="v-cancelar"')
    expect(html).toContain('¿Quién lo cancela?')
    expect(html).toContain('name="quien" value="paciente" required')
    expect(html).toContain('name="quien" value="profesional" required')
  })
  it('si lo cancela el paciente queda anotado y el mensaje lo dice', async () => {
    const { navegador, db } = await conSesion()
    const r = await navegador.pedir('/turnos/6/cancelar', { form: { quien: 'paciente' } })
    expect(r.headers.get('location')).toBe('/turnos/6/aviso?que=cancelado')
    expect(uno(db, 'SELECT estado, cancelado_por FROM turnos WHERE id = 6')).toEqual({ estado: 'cancelado', cancelado_por: 'paciente' })
    const aviso = await (await navegador.pedir('/turnos/6/aviso?que=cancelado')).text()
    expect(aviso).toContain('como%20nos%20pediste')
    // Un turno ya cancelado no ofrece cancelarlo de nuevo.
    expect(await (await navegador.pedir('/agenda?cancelar=6')).text()).toContain('Ese turno ya no se puede cancelar.')
  })
  it('cualquier otro valor cuenta como que lo cancelás vos', async () => {
    const { navegador, db } = await conSesion()
    await navegador.pedir('/turnos/6/cancelar', { form: { quien: 'sistema' } })
    expect(uno(db, 'SELECT cancelado_por FROM turnos WHERE id = 6').cancelado_por).toBe('profesional')
  })
})

describe('Agenda del día en el celular', () => {
  it('la tira muestra hoy y los seis días que siguen, con cuántos turnos hay', async () => {
    const { navegador } = await conSesion()
    const html = await (await navegador.pedir('/agenda?vista=dia')).text()
    expect(html.match(/class="ag-tira-dia/g)).toHaveLength(7)
    expect(html).toContain('<span>Hoy</span>')
    expect(html).toMatch(new RegExp(`href="/agenda\\?vista=dia&amp;fecha=${sumarDias(HOY, 6)}&amp;consultorio=todos"`))
    expect(html).toContain('aria-label="Turnos del día"')
  })
  it('un día lejano arranca la tira en ese día', async () => {
    const { navegador } = await conSesion()
    const lejos = sumarDias(HOY, 30)
    const html = await (await navegador.pedir(`/agenda?vista=dia&fecha=${lejos}`)).text()
    expect(html).toMatch(new RegExp(`fecha=${lejos}&amp;consultorio=todos" aria-current="true"`))
    expect(html).not.toContain('<span>Hoy</span>')
  })
  it('los huecos libres van juntos y cada uno lleva a Dar turno', async () => {
    const { navegador } = await conSesion()
    const lunes = proximo(1)
    const html = await (await navegador.pedir(`/agenda?vista=dia&fecha=${lunes}&consultorio=1`)).text()
    expect(html).toContain('horarios libres')
    expect(html).toContain(`href="/turnos/nuevo?consultorio=1&amp;fecha=${lunes}&amp;hora=08%3A00" aria-label="Dar turno a las 08:00"`)
  })
  it('un día bloqueado avisa que no se dan turnos', async () => {
    const { navegador, db } = await conSesion()
    const lunes = proximo(1)
    db.prepare("INSERT INTO bloqueos (desde, hasta, motivo) VALUES (?, ?, 'congreso')").run(lunes, lunes)
    const html = await (await navegador.pedir(`/agenda?vista=dia&fecha=${lunes}`)).text()
    expect(html).toMatch(/Día bloqueado · [^<]+\. No se dan turnos ni se ofrecen online\./)
    expect(html).not.toContain('horarios libres')
  })
  it('en el mes cada día muestra cuántos turnos tiene', async () => {
    const { navegador } = await conSesion()
    const html = await (await navegador.pedir('/agenda?vista=mes')).text()
    expect(html).toMatch(/class="marca-mes solo-celular" aria-hidden="true">\d+ t\.</)
  })
})

describe('Pacientes en el celular', () => {
  it('la ficha tiene un resumen sin nada clínico y lo clínico queda en la compu', async () => {
    const { navegador, db } = await conSesion()
    db.prepare("INSERT INTO antecedentes (paciente_id, alergias) VALUES (1, 'Ibuprofeno')").run()
    const html = await (await navegador.pedir('/pacientes/1')).text()
    const cel = html.slice(html.indexOf('ficha-celular'), html.indexOf('solo-compu-grupo'))
    expect(cel).toContain('Ibuprofeno')
    for (const t of ['Alergias', 'Celular', 'Correo', 'Último turno', 'Próximo turno', 'WhatsApp', 'Dar turno']) expect(cel).toContain(t)
    expect(cel).toContain('La historia clínica, las notas y los documentos se ven en la compu.')
    expect(cel).not.toContain('Historia clínica</a>')
  })
  it('en el celular van los cuatro filtros de la maqueta', async () => {
    const { navegador } = await conSesion()
    const html = await (await navegador.pedir('/pacientes')).text()
    expect(html).toMatch(/<span class="solo-compu"><a class="pastilla" href="\/pacientes\?filtro=primera"/)
    expect(html).not.toMatch(/<span class="solo-compu"><a class="pastilla" href="\/pacientes\?filtro=deben"/)
    // El filtro elegido se ve siempre.
    expect(await (await navegador.pedir('/pacientes?filtro=baja')).text()).not.toMatch(/<span class="solo-compu"><a class="pastilla" href="\/pacientes\?filtro=baja"/)
  })
})
