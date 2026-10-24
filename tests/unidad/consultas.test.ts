import { describe, it, expect, vi } from 'vitest'
import { entorno, CLAVE_PRUEBA, SECRETO, ORIGEN } from './ayuda'
import { contextoFirmado, huella, fechaTexto, controlEnMeses } from '../../src/lib/consultas'

const ajax = { Accept: 'application/json' }
const datos = { motivo: 'Dolor cervical ficticio', examen: 'Movilidad conservada', plan: 'Ejercicios y control', personales: 'Ninguno', alergias: 'Penicilina', medicacion: 'Ninguno', familiares: 'Ninguno', proximo_control: '2027-01-01', signo_peso: '72,50', signo_presion: '120/80' }
async function preparado() {
  const t = entorno()
  await t.navegador.pedir('/ingresar/prueba', { form: { clave: CLAVE_PRUEBA } })
  return t
}
async function identidad(id = 10001, paciente = 1, turno: number | null = null) {
  return { contexto: await contextoFirmado({ id, paciente, turno }, SECRETO), version: '0' }
}
async function crear(t: Awaited<ReturnType<typeof preparado>>, id = 10001, paciente = 1) {
  const f = { ...await identidad(id, paciente), ...datos }
  const r = await t.navegador.pedir('/consultas/guardar', { form: f, headers: ajax })
  expect(r.status).toBe(200)
  return { ...f, version: String((await r.json() as any).version) }
}
const estado = (t: Awaited<ReturnType<typeof preparado>>, id = 10001) => t.db.prepare('SELECT * FROM consultas WHERE id=?').get(id)!
const cantidad = (t: Awaited<ReturnType<typeof preparado>>, tabla: string) => t.db.prepare(`SELECT COUNT(*) n FROM ${tabla}`).get()!.n

describe('Entrada a consulta y ficha incompleta', () => {
  it('no abre consultas ni estudios sin sesión y rechaza escrituras de otro origen', async () => {
    const t = entorno()
    expect((await t.navegador.pedir('/consultas/nueva?paciente=1')).status).toBe(302)
    expect((await t.navegador.pedir('/consultas/archivos/1')).status).toBe(302)
    expect((await t.navegador.pedir('/consultas/guardar', { form: await identidad() })).status).toBe(401)
    await t.navegador.pedir('/ingresar/prueba', { form: { clave: CLAVE_PRUEBA } })
    expect((await t.navegador.pedir('/consultas/guardar', { form: await identidad(), headers: { Origin: 'https://otro.test' } })).status).toBe(403)
  })
  it('abrir y volver no crea borradores; un turno confirmado se atiende solo por POST', async () => {
    const t = await preparado()
    expect((await t.navegador.pedir('/consultas/nueva?paciente=1')).status).toBe(200)
    expect(await (await t.navegador.pedir('/consultas/nueva?turno=3')).text()).toContain('Sí, atender y empezar')
    expect(t.db.prepare('SELECT estado FROM turnos WHERE id=3').get()?.estado).toBe('confirmado')
    expect(cantidad(t, 'consultas')).toBe(0)
    expect((await t.navegador.pedir('/consultas/atender', { form: { turno: '3' } })).status).toBe(303)
    expect(t.db.prepare('SELECT estado FROM turnos WHERE id=3').get()?.estado).toBe('atendido')
    expect(cantidad(t, 'consultas')).toBe(0)
    expect((await t.navegador.pedir('/consultas/atender', { form: { turno: '3' } })).status).toBe(303)
  })
  it('pide la ficha antes de empezar y también frena un guardado directo', async () => {
    const t = await preparado()
    expect(await (await t.navegador.pedir('/consultas/nueva?turno=4')).text()).toContain('Completá la ficha de Lucía')
    expect((await t.navegador.pedir('/consultas/guardar', { form: { ...await identidad(10001, 3, 4), ...datos }, headers: ajax })).status).toBe(409)
    expect(cantidad(t, 'consultas')).toBe(0)
    const r = await t.navegador.pedir('/consultas/completar-ficha', { form: { paciente: '3', turno: '4', fecha_nacimiento: '1995-01-20', domicilio: 'Calle Ficticia 123', ocupacion: 'Docente', cobertura: 'particular' } })
    expect(r.status).toBe(303)
    expect(t.db.prepare('SELECT ocupacion, cobertura FROM pacientes WHERE id=3').get()).toMatchObject({ ocupacion: 'Docente', cobertura: 'particular' })
    expect(cantidad(t, 'consultas')).toBe(0)
    expect(Number(cantidad(t, 'pacientes_cambios'))).toBeGreaterThan(0)
  })
  it('valida fechas reales, cobertura y pertenencia del turno sin guardar parcialmente', async () => {
    const t = await preparado()
    const ficha = { paciente: '3', turno: '4', fecha_nacimiento: '1995-01-20', domicilio: 'Calle Ficticia', ocupacion: 'Docente', cobertura: 'particular' }
    const casos: Record<string, string>[] = [{ fecha_nacimiento: '1995-02-30' }, { fecha_nacimiento: '2020-99-99' }, { cobertura: 'os:9999' }, { ocupacion: '' }, { turno: '3' }]
    for (const cambio of casos) expect((await t.navegador.pedir('/consultas/completar-ficha', { form: { ...ficha, ...cambio } })).status).toBeGreaterThanOrEqual(400)
    expect(t.db.prepare('SELECT domicilio FROM pacientes WHERE id=3').get()?.domicilio).toBeNull()
    expect((await t.navegador.pedir('/consultas/nueva?turno=99999')).status).toBe(404)
  })
})

describe('Borrador y versiones', () => {
  it('nace al primer guardado, se retoma y preserva la versión que ganó', async () => {
    const t = await preparado(), f = await crear(t)
    expect(estado(t)).toMatchObject({ estado: 'borrador', version: 1, motivo: datos.motivo, foto: null })
    expect((await t.navegador.pedir('/consultas/nueva?paciente=1')).headers.get('location')).toBe('/consultas/10001')
    const respuestas = await Promise.all(['Pestaña A', 'Pestaña B'].map(plan => t.navegador.pedir('/consultas/guardar', { form: { ...f, plan }, headers: ajax })))
    expect(respuestas.map(r => r.status).sort()).toEqual([200, 409])
    expect(estado(t).version).toBe(2)
    expect(['Pestaña A', 'Pestaña B']).toContain(estado(t).plan)
    expect((await t.navegador.pedir('/consultas/guardar', { form: { ...f, plan: 'Pestaña vieja' }, headers: ajax })).status).toBe(409)
    expect(estado(t).plan).not.toBe('Pestaña vieja')
  })
  it('reintentar el primer guardado o abrir dos consultas sin turno no duplica', async () => {
    const t = await preparado(), f = await crear(t)
    expect((await t.navegador.pedir('/consultas/guardar', { form: { ...f, version: '0' }, headers: ajax })).status).toBe(409)
    expect((await t.navegador.pedir('/consultas/guardar', { form: { ...await identidad(10002), ...datos }, headers: ajax })).status).toBe(409)
    expect(cantidad(t, 'consultas')).toBe(1)
  })
  it('no permite cambiar la identidad ni usar un turno pendiente o ajeno', async () => {
    const t = await preparado()
    const f = await identidad()
    expect((await t.navegador.pedir('/consultas/guardar', { form: { ...f, contexto: f.contexto.replace('10001', '10002'), ...datos }, headers: ajax })).status).toBe(400)
    expect((await t.navegador.pedir('/consultas/guardar', { form: { ...await identidad(10001, 1, 3), ...datos }, headers: ajax })).status).toBe(409)
    expect((await t.navegador.pedir('/consultas/guardar', { form: { ...await identidad(10001, 1, 2), ...datos }, headers: ajax })).status).toBe(409)
    expect(cantidad(t, 'consultas')).toBe(0)
  })
  it('respeta primera/control del turno y un solo borrador por turno', async () => {
    const t = await preparado()
    await t.navegador.pedir('/consultas/atender', { form: { turno: '3' } })
    const f = { ...await identidad(10001, 1, 3), ...datos }
    expect((await t.navegador.pedir('/consultas/guardar', { form: f, headers: ajax })).status).toBe(200)
    expect(estado(t).tipo).toBe('control')
    expect((await t.navegador.pedir('/consultas/nueva?turno=3')).headers.get('location')).toBe('/consultas/10001')
    expect((await t.navegador.pedir('/consultas/guardar', { form: { ...await identidad(10002, 1, 3), ...datos }, headers: ajax })).status).toBe(409)
    expect(cantidad(t, 'consultas')).toBe(1)
  })
  it('rechaza datos inválidos sin modificar la versión ni el texto guardado', async () => {
    const t = await preparado(), f = await crear(t)
    const casos: Record<string, string>[] = [{ motivo: 'x'.repeat(8001) }, { proximo_control: '2027-02-30' }, { proximo_control: '9999-99-99' }, { signo_peso: '-2' }, { signo_presion: 'ciento veinte' }, { signo_saturacion: '101' }]
    for (const cambio of casos) {
      expect((await t.navegador.pedir('/consultas/guardar', { form: { ...f, ...cambio }, headers: ajax })).status).toBe(422)
    }
    expect(estado(t).version).toBe(1)
    expect(estado(t).motivo).toBe(datos.motivo)
  })
})

describe('Firma, foto de los datos y correcciones', () => {
  it('firma con foto inmutable, crea mediciones y antecedentes sin perder el grupo sanguíneo', async () => {
    const t = await preparado()
    t.db.prepare("INSERT INTO antecedentes (paciente_id, grupo_sanguineo, personales) VALUES (1, 'A+', 'Antecedente anterior')").run()
    const f = await crear(t)
    expect((await t.navegador.pedir('/consultas/finalizar', { form: f })).status).toBe(303)
    const c = estado(t), foto = JSON.parse(String(c.foto))
    expect(c).toMatchObject({ estado: 'finalizada', version: 2 })
    expect(foto.paciente.dni).toBe('30111222')
    expect(foto.antecedentes.alergias).toBe('Penicilina')
    expect(foto.signos.peso).toBe('72,50')
    expect(foto.firmada_por).toBe('demo@siroconsultas.test')
    expect(t.db.prepare('SELECT grupo_sanguineo FROM antecedentes ORDER BY id DESC LIMIT 1').get()?.grupo_sanguineo).toBe('A+')
    expect(t.db.prepare('SELECT COUNT(*) n FROM mediciones WHERE consulta_id=10001').get()?.n).toBe(2)
    t.db.prepare("UPDATE pacientes SET nombre='Otro nombre', dni='31111222' WHERE id=1").run()
    const html = await (await t.navegador.pedir('/consultas/10001')).text()
    expect(html).toContain('Tomás Ferreyra')
    expect(html).toContain('30111222')
    expect(html).not.toContain('Otro nombre')
    expect(() => t.db.exec("UPDATE consultas SET plan='Reescrito' WHERE id=10001")).toThrow(/no se modifica/)
    expect((await t.navegador.pedir('/consultas/guardar', { form: { ...f, version: '2', plan: 'Reescrito' }, headers: ajax })).status).toBe(409)
  })
  it('una firma vieja no crea efectos secundarios ni restaura antecedentes de otra consulta', async () => {
    const t = await preparado(), f = await crear(t)
    await t.navegador.pedir('/consultas/finalizar', { form: f })
    t.db.prepare("INSERT INTO antecedentes (paciente_id, alergias) VALUES (1, 'Dato posterior')").run()
    const antes = cantidad(t, 'antecedentes')
    expect((await t.navegador.pedir('/consultas/finalizar', { form: f })).status).toBe(409)
    expect(cantidad(t, 'antecedentes')).toBe(antes)
    expect(t.db.prepare('SELECT COUNT(*) n FROM mediciones WHERE consulta_id=10001').get()?.n).toBe(2)
    expect(t.db.prepare('SELECT alergias FROM antecedentes ORDER BY id DESC LIMIT 1').get()?.alergias).toBe('Dato posterior')
  })
  it('no firma un registro vacío ni una versión desactualizada', async () => {
    const t = await preparado(), f = await crear(t)
    await t.navegador.pedir('/consultas/guardar', { form: { ...f, plan: '' }, headers: ajax })
    expect((await t.navegador.pedir('/consultas/finalizar', { form: f })).status).toBe(422)
    expect(estado(t).estado).toBe('borrador')
    expect(cantidad(t, 'mediciones')).toBe(0)
    expect(cantidad(t, 'antecedentes')).toBe(0)
  })
  it('agrega aclaraciones solo después de finalizar y conserva la consulta original', async () => {
    const t = await preparado(), f = await crear(t)
    expect((await t.navegador.pedir('/consultas/aclarar', { form: { ...f, aclaracion: 'Aclaración ficticia' } })).status).toBe(409)
    await t.navegador.pedir('/consultas/finalizar', { form: f })
    const antes = estado(t)
    expect((await t.navegador.pedir('/consultas/aclarar', { form: { ...f, aclaracion: 'Aclaración ficticia' } })).status).toBe(303)
    expect(estado(t)).toEqual(antes)
    expect(await (await t.navegador.pedir('/consultas/10001')).text()).toContain('Aclaración ficticia')
    expect(() => t.db.exec("UPDATE aclaraciones SET texto='Pisado'")).toThrow()
  })
  it('descarta con motivo, deja registro y no permite volver a editar', async () => {
    const t = await preparado(), f = await crear(t)
    expect((await t.navegador.pedir('/consultas/descartar', { form: { ...f, descarte_motivo: '' } })).status).toBe(422)
    expect((await t.navegador.pedir('/consultas/descartar', { form: { ...f, descarte_motivo: 'Se abrió por error' } })).status).toBe(303)
    expect(estado(t)).toMatchObject({ estado: 'descartada', descarte_motivo: 'Se abrió por error' })
    expect(t.db.prepare("SELECT COUNT(*) n FROM auditoria WHERE evento='consulta_descartada'").get()?.n).toBe(1)
    expect((await t.navegador.pedir('/consultas/guardar', { form: { ...f, version: '2' }, headers: ajax })).status).toBe(409)
    expect(await (await t.navegador.pedir('/pacientes/1?tab=historia')).text()).toContain('Se abrió por error')
  })
  it('paciente dado de baja es de solo lectura para todas las escrituras', async () => {
    const t = await preparado(), f = await crear(t)
    t.db.exec("UPDATE pacientes SET baja_en='2026-10-23T00:00:00Z', baja_motivo='se_mudo' WHERE id=1")
    for (const ruta of ['guardar', 'finalizar', 'descartar', 'aclarar']) expect((await t.navegador.pedir(`/consultas/${ruta}`, { form: { ...f, motivo: 'Prueba', aclaracion: 'Prueba' }, headers: ajax })).status).toBe(409)
    const html = await (await t.navegador.pedir('/consultas/10001')).text()
    expect(html).toContain('solo lectura')
    expect(html).not.toContain('data-consulta-editor')
    expect(await (await t.navegador.pedir('/pacientes/1?tab=historia')).text()).not.toContain('Empezar consulta sin turno')
    expect(estado(t).version).toBe(1)
  })
})

function r2Falso() {
  const archivos = new Map<string, { bytes: ArrayBuffer; tipo: string }>()
  const bucket = {
    put: vi.fn(async (clave: string, bytes: ArrayBuffer, opciones: any) => { archivos.set(clave, { bytes, tipo: opciones.httpMetadata.contentType }); return {} }),
    get: vi.fn(async (clave: string) => { const f = archivos.get(clave); return f ? { arrayBuffer: async () => f.bytes, httpMetadata: { contentType: f.tipo } } : null }),
    delete: vi.fn(async (clave: string) => { archivos.delete(clave) }),
  }
  return { archivos, bucket: bucket as unknown as R2Bucket, put: bucket.put, borrar: bucket.delete }
}
async function estudio(t: ReturnType<typeof entorno>, f: Record<string, string>, bytes = new TextEncoder().encode('%PDF-1.4 estudio ficticio'), tipo = 'application/pdf') {
  const form = new FormData()
  for (const [k, v] of Object.entries(f)) form.set(k, v)
  form.set('nombre', 'Radiografía ficticia.pdf'); form.set('archivo', new Blob([bytes], { type: tipo }), 'estudio.pdf')
  return t.navegador.pedir('/consultas/estudio', { method: 'POST', body: form, headers: { Origin: ORIGEN } })
}

describe('Estudios privados en R2 e historia clínica', () => {
  it('adjunta con huella, incrementa la versión y verifica los bytes al descargar', async () => {
    const r2 = r2Falso(), t = entorno({ ARCHIVOS: r2.bucket })
    await t.navegador.pedir('/ingresar/prueba', { form: { clave: CLAVE_PRUEBA } })
    const f = await crear(t), bytes = new TextEncoder().encode('%PDF-1.4 estudio ficticio')
    expect((await estudio(t, f)).status).toBe(303)
    const a = t.db.prepare('SELECT * FROM archivos').get()!
    expect(a.sha256).toBe(await huella(bytes.buffer))
    expect(a).toMatchObject({ consulta_id: 10001, paciente_id: 1, tamano: bytes.length })
    expect(estado(t).version).toBe(2)
    const descarga = await t.navegador.pedir(`/consultas/archivos/${a.id}`)
    expect(descarga.headers.get('content-disposition')).toContain('attachment')
    expect(descarga.headers.get('cache-control')).toContain('no-store')
    expect(new Uint8Array(await descarga.arrayBuffer())).toEqual(bytes)
    r2.archivos.get(String(a.clave))!.bytes = new TextEncoder().encode('Modificado').buffer
    expect((await t.navegador.pedir(`/consultas/archivos/${a.id}`)).status).toBe(409)
  })
  it('un estudio con versión vieja no entra y el objeto huérfano se limpia', async () => {
    const r2 = r2Falso(), t = entorno({ ARCHIVOS: r2.bucket })
    await t.navegador.pedir('/ingresar/prueba', { form: { clave: CLAVE_PRUEBA } })
    const f = await crear(t)
    await t.navegador.pedir('/consultas/guardar', { form: { ...f, plan: 'Plan actualizado' }, headers: ajax })
    expect((await estudio(t, f)).status).toBe(409)
    expect(r2.borrar).toHaveBeenCalledOnce()
    expect(r2.archivos.size).toBe(0)
    expect(cantidad(t, 'archivos')).toBe(0)
    expect(estado(t).version).toBe(2)
  })
  it('rechaza archivos activos, vacíos o con tipo falso antes de escribir R2', async () => {
    const r2 = r2Falso(), t = entorno({ ARCHIVOS: r2.bucket })
    await t.navegador.pedir('/ingresar/prueba', { form: { clave: CLAVE_PRUEBA } })
    const f = await crear(t)
    expect((await estudio(t, f, new TextEncoder().encode('<svg/>'), 'image/svg+xml')).status).toBe(422)
    expect((await estudio(t, f, new TextEncoder().encode('texto'), 'application/pdf')).status).toBe(422)
    expect((await estudio(t, f, new Uint8Array())).status).toBe(422)
    expect(r2.put).not.toHaveBeenCalled()
    expect(cantidad(t, 'archivos')).toBe(0)
  })
  it('la pestaña Historia permite retomar, lista documentos y conserva las otras pestañas', async () => {
    const t = await preparado(), f = await crear(t)
    t.db.prepare("INSERT INTO documentos (paciente_id, consulta_id, tipo, datos, fecha) VALUES (1, 10001, 'pedido', '{}', date('now'))").run()
    const html = await (await t.navegador.pedir('/pacientes/1?tab=historia')).text()
    expect(html).toContain('href="/consultas/10001"')
    expect(html).toContain('Empezar consulta sin turno')
    expect(html.replace(/<[^>]*>/g, '')).toContain('En esta consulta: Pedido de estudios')
    expect(html).toContain('Registrar medición')
    expect(await (await t.navegador.pedir('/pacientes/1')).text()).toContain('Últimas consultas')
    expect(await (await t.navegador.pedir('/consultas/10001')).text()).toContain(f.plan)
  })
  it('registra mediciones fuera de consulta sin duplicar un reenvío ni perder la historia', async () => {
    const t = await preparado()
    const f = { paciente: '1', tipo: 'peso', valor: '75', fecha: '2026-10-23', operacion: await contextoFirmado({ id: 20001, paciente: 1, turno: null }, SECRETO) }
    expect((await t.navegador.pedir('/consultas/medicion', { form: f })).status).toBe(303)
    expect((await t.navegador.pedir('/consultas/medicion', { form: f })).status).toBe(303)
    expect(cantidad(t, 'mediciones')).toBe(1)
    expect(await (await t.navegador.pedir('/pacientes/1?tab=historia')).text()).toContain('Peso: 75 kg')
    expect((await t.navegador.pedir('/consultas/medicion', { form: { ...f, paciente: '2' } })).status).toBe(400)
  })
})

// Límites de calendario que cambian el día mostrado o la semana sugerida.
it('muestra fechas clínicas en Argentina y calcula meses calendario', () => {
  expect(fechaTexto('2026-10-24T01:30:00Z')).toBe('23/10/2026')
  expect(controlEnMeses('2027-01-31', 1)).toBe('2027-02-28')
  expect(controlEnMeses('2026-11-30', 3)).toBe('2027-02-28')
})
