import { describe, it, expect, vi } from 'vitest'
import { entorno, CLAVE_PRUEBA, ORIGEN } from './ayuda'

async function preparado() {
  const t = entorno()
  await t.navegador.pedir('/ingresar/prueba', { form: { clave: CLAVE_PRUEBA } })
  return t
}
const consultorio = (prefijo = 'nuevo') => ({
  [`${prefijo}_nombre`]: 'Sur', [`${prefijo}_modalidad`]: 'presencial', [`${prefijo}_direccion`]: 'Calle Ficticia 123', [`${prefijo}_como_llegar`]: 'Timbre 2',
  [`${prefijo}_dia_1`]: '1', [`${prefijo}_desde_1`]: '09:00', [`${prefijo}_hasta_1`]: '12:00',
})
const prestacion = (prefijo = 'nueva') => ({ [`${prefijo}_nombre`]: 'Control breve', [`${prefijo}_duracion`]: '20', [`${prefijo}_importe`]: '1234,56', [`${prefijo}_activa`]: '1' })

describe('Configuración: acceso y perfil', () => {
  it('protege páginas, foto y escrituras con sesión y origen', async () => {
    const { navegador, db } = entorno()
    expect((await navegador.pedir('/configuracion/perfil')).status).toBe(302)
    expect((await navegador.pedir('/configuracion/foto')).status).toBe(302)
    expect((await navegador.pedir('/configuracion/perfil', { form: { nombre: 'Intruso' } })).status).toBe(401)
    await navegador.pedir('/ingresar/prueba', { form: { clave: CLAVE_PRUEBA } })
    expect((await navegador.pedir('/configuracion/perfil', { form: { nombre: 'Intruso' }, headers: { Origin: 'https://otro.test' } })).status).toBe(403)
    expect(db.prepare('SELECT nombre FROM profesional').get()?.nombre).toBe('Julia Paredes')
  })
  it('muestra siete secciones, pendientes honestos y no acepta secciones inventadas', async () => {
    const { navegador } = await preparado()
    expect((await navegador.pedir('/configuracion')).headers.get('location')).toBe('/configuracion/perfil')
    const html = await (await navegador.pedir('/configuracion/perfil')).text()
    for (const seccion of ['Tu perfil', 'Consultorios y horarios', 'Prestaciones', 'Obras sociales', 'Cobros y comprobantes', 'Recordatorios', 'Cuenta y seguridad']) expect(html).toContain(seccion)
    for (const seccion of ['recordatorios', 'cuenta']) expect(await (await navegador.pedir(`/configuracion/${seccion}`)).text()).toContain('Próximamente')
    expect((await navegador.pedir('/configuracion/otra')).status).toBe(404)
  })
  it('guarda solo los campos de perfil y escapa lo ingresado, sin tocar permisos ni datos fiscales', async () => {
    const { navegador, db } = await preparado()
    const r = await navegador.pedir('/configuracion/perfil', { form: { nombre: '<img src=x>', especialidad: 'Clínica', matricula: 'MP 123', whatsapp: '+54 9 343 0000000', correo: 'demo@ejemplo.test', cuit: '20301112220', correos_permitidos: 'otro@ejemplo.test' } })
    expect(r.status).toBe(303)
    expect(db.prepare('SELECT nombre, especialidad, matricula, cuit FROM profesional').get()).toMatchObject({ nombre: '<img src=x>', especialidad: 'Clínica', matricula: 'MP 123', cuit: null })
    const html = await (await navegador.pedir('/configuracion/perfil')).text()
    expect(html).toContain('&lt;img src=x&gt;')
    expect(html).not.toContain('<img src=x>')
  })
  it('rechaza correo o longitudes inválidas sin guardar parcialmente y conserva lo escrito', async () => {
    const { navegador, db } = await preparado()
    for (const datos of [{ nombre: 'Otra', correo: 'sin-arroba' }, { nombre: 'x'.repeat(121) }] as Record<string, string>[]) {
      const r = await navegador.pedir('/configuracion/perfil', { form: datos })
      expect(r.status).toBe(400)
      expect(await r.text()).toContain('role="alert"')
      expect(db.prepare('SELECT nombre FROM profesional').get()?.nombre).toBe('Julia Paredes')
    }
  })
  it('sube una imagen a R2 y la sirve solo con sesión, tipo seguro y sin caché', async () => {
    const png = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0])
    const put = vi.fn().mockResolvedValue({})
    const get = vi.fn().mockResolvedValue({ body: png, httpMetadata: { contentType: 'image/png' } })
    const { navegador, db } = entorno({ ARCHIVOS: { put, get } as unknown as R2Bucket })
    await navegador.pedir('/ingresar/prueba', { form: { clave: CLAVE_PRUEBA } })
    const form = new FormData()
    form.set('nombre', 'Julia Demo')
    form.set('foto', new Blob([png], { type: 'image/png' }), 'foto.png')
    const r = await navegador.pedir('/configuracion/perfil', { method: 'POST', body: form, headers: { Origin: ORIGEN } })
    expect(r.status).toBe(303)
    expect(put).toHaveBeenCalledOnce()
    expect(db.prepare('SELECT foto_clave FROM profesional').get()?.foto_clave).toMatch(/^perfil\//)
    const foto = await navegador.pedir('/configuracion/foto')
    expect(foto.headers.get('content-type')).toBe('image/png')
    expect(foto.headers.get('cache-control')).toContain('no-store')
    expect(new Uint8Array(await foto.arrayBuffer())).toEqual(png)
  })
  it('rechaza SVG, tipos falsos y archivos grandes antes de escribir R2', async () => {
    const put = vi.fn()
    const { navegador } = entorno({ ARCHIVOS: { put } as unknown as R2Bucket })
    await navegador.pedir('/ingresar/prueba', { form: { clave: CLAVE_PRUEBA } })
    for (const archivo of [new Blob(['<svg/>'], { type: 'image/svg+xml' }), new Blob(['no es foto'], { type: 'image/png' }), new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: 'image/png' })]) {
      const form = new FormData(); form.set('foto', archivo, 'foto.png')
      expect((await navegador.pedir('/configuracion/perfil', { method: 'POST', body: form, headers: { Origin: ORIGEN } })).status).toBe(400)
    }
    expect(put).not.toHaveBeenCalled()
  })
})

describe('Consultorios y horarios', () => {
  it('crea consultorio y varias franjas en un lote, incluida videollamada', async () => {
    const { navegador, db } = await preparado()
    const form = new FormData()
    for (const [k, v] of Object.entries(consultorio())) form.set(k, v)
    form.append('nuevo_desde_1', '15:00'); form.append('nuevo_hasta_1', '19:00')
    expect((await navegador.pedir('/configuracion/consultorios/nuevo', { method: 'POST', body: form, headers: { Origin: ORIGEN } })).status).toBe(303)
    const co = db.prepare("SELECT * FROM consultorios WHERE nombre = 'Sur'").get()!
    expect(co.como_llegar).toBe('Timbre 2')
    expect(db.prepare('SELECT COUNT(*) n FROM horarios WHERE consultorio_id = ?').get(co.id)?.n).toBe(2)
    expect((await navegador.pedir('/configuracion/consultorios/nuevo', { form: { ...consultorio(), nuevo_modalidad: 'videollamada', nuevo_nombre: 'Virtual', nuevo_direccion: '' } })).status).toBe(303)
  })
  it('edita y apaga sin perder turnos existentes', async () => {
    const { navegador, db } = await preparado()
    const turnos = db.prepare('SELECT COUNT(*) n FROM turnos WHERE consultorio_id = 1').get()?.n
    const r = await navegador.pedir('/configuracion/consultorios', { form: { ids: '1', ...consultorio('co_1'), co_1_nombre: 'Centro renovado' } })
    expect(r.status).toBe(303)
    expect(db.prepare('SELECT nombre, activo FROM consultorios WHERE id=1').get()).toMatchObject({ nombre: 'Centro renovado', activo: 0 })
    expect(db.prepare('SELECT COUNT(*) n FROM turnos WHERE consultorio_id = 1').get()?.n).toBe(turnos)
    expect(db.prepare('SELECT dia, desde, hasta FROM horarios WHERE consultorio_id=1').all()).toEqual([{ dia: 1, desde: '09:00', hasta: '12:00' }])
    expect((await navegador.pedir('/configuracion/consultorios', { form: { ids: '1', ...consultorio('co_1'), co_1_activo: '1' } })).status).toBe(303)
    expect(db.prepare('SELECT activo FROM consultorios WHERE id=1').get()?.activo).toBe(1)
  })
  it('no guarda días sin horas, superposiciones, horas imposibles ni listas alteradas', async () => {
    const { navegador, db } = await preparado()
    for (const cambio of [{ nuevo_dia_1: '' }, { nuevo_desde_1: '25:00' }, { nuevo_hasta_1: '08:00' }, { nuevo_hasta_1: '' }, { nuevo_modalidad: 'otro' }, { nuevo_direccion: '' }] as Record<string, string>[]) {
      expect((await navegador.pedir('/configuracion/consultorios/nuevo', { form: { ...consultorio(), ...cambio } })).status).toBe(400)
    }
    const form = new FormData()
    for (const [k, v] of Object.entries(consultorio())) form.set(k, v)
    form.append('nuevo_desde_1', '11:00'); form.append('nuevo_hasta_1', '14:00')
    expect((await navegador.pedir('/configuracion/consultorios/nuevo', { method: 'POST', body: form, headers: { Origin: ORIGEN } })).status).toBe(400)
    expect(db.prepare('SELECT COUNT(*) n FROM consultorios').get()?.n).toBe(3)
    expect((await navegador.pedir('/configuracion/consultorios', { form: { ids: '999', ...consultorio('co_999') } })).status).toBe(400)
  })
  it('valida todo antes de actualizar y conserva horarios si otra fila falla', async () => {
    const { navegador, db } = await preparado()
    const antes = db.prepare('SELECT * FROM horarios').all()
    const form = new FormData()
    form.append('ids', '1'); form.append('ids', '2')
    for (const [k, v] of Object.entries({ ...consultorio('co_1'), ...consultorio('co_2'), co_2_nombre: '' })) form.set(k, v)
    expect((await navegador.pedir('/configuracion/consultorios', { method: 'POST', body: form, headers: { Origin: ORIGEN } })).status).toBe(400)
    expect(db.prepare('SELECT * FROM horarios').all()).toEqual(antes)
  })
})

describe('Prestaciones y obras sociales', () => {
  it('crea y edita importes exactos en centavos y sin cargo; desactiva conservando vínculos', async () => {
    const { navegador, db } = await preparado()
    expect((await navegador.pedir('/configuracion/prestaciones/nueva', { form: prestacion() })).status).toBe(303)
    expect(db.prepare("SELECT importe, duracion_min FROM prestaciones WHERE nombre='Control breve'").get()).toMatchObject({ importe: 123456, duracion_min: 20 })
    expect((await navegador.pedir('/configuracion/prestaciones', { form: { ids: '1', ...prestacion('pr_1'), pr_1_importe: '0', pr_1_activa: '' } })).status).toBe(303)
    expect(db.prepare('SELECT importe, activa FROM prestaciones WHERE id=1').get()).toMatchObject({ importe: 0, activa: 0 })
    expect(await (await navegador.pedir('/configuracion/prestaciones')).text()).toContain('Sin cargo')
    expect(db.prepare('SELECT COUNT(*) n FROM turnos WHERE prestacion_id=1').get()?.n).toBeGreaterThan(0)
  })
  it('rechaza importes negativos, ambiguos o fuera de rango y duración inválida', async () => {
    const { navegador, db } = await preparado()
    for (const cambio of [{ nueva_importe: '-1' }, { nueva_importe: '1.234,56' }, { nueva_importe: '1.234' }, { nueva_importe: '1000000.01' }, { nueva_duracion: '0' }, { nueva_duracion: '30.5' }, { nueva_nombre: '' }] as Record<string, string>[]) {
      expect((await navegador.pedir('/configuracion/prestaciones/nueva', { form: { ...prestacion(), ...cambio } })).status).toBe(400)
    }
    expect(db.prepare('SELECT COUNT(*) n FROM prestaciones').get()?.n).toBe(3)
  })
  it('busca el catálogo sin tildes, usa y deja de usar sin tocar pacientes', async () => {
    const { navegador, db } = await preparado()
    db.prepare("INSERT INTO obras_sociales (nombre) VALUES ('Mutual Médica')").run()
    const html = await (await navegador.pedir('/configuracion/obras?q=MEDICA')).text()
    expect(html).toContain('Mutual Médica')
    expect(html).not.toContain('<strong>OSDE</strong>')
    const antes = db.prepare('SELECT obra_social_id FROM pacientes').all()
    expect((await navegador.pedir('/configuracion/obras/1', { form: { en_uso: '0' } })).status).toBe(303)
    expect(db.prepare('SELECT en_uso FROM obras_sociales WHERE id=1').get()?.en_uso).toBe(0)
    expect(db.prepare('SELECT obra_social_id FROM pacientes').all()).toEqual(antes)
    expect((await navegador.pedir('/configuracion/obras/1', { form: { en_uso: '1' } })).status).toBe(303)
    expect((await navegador.pedir('/configuracion/obras/999', { form: { en_uso: '1' } })).status).toBe(404)
    expect((await navegador.pedir('/configuracion/obras/1', { form: { en_uso: '2' } })).status).toBe(400)
  })
  it('sirve HTML sin scripts ni estilos en línea y con CSP estricta', async () => {
    const { navegador } = await preparado()
    for (const seccion of ['perfil', 'consultorios', 'prestaciones', 'obras']) {
      const r = await navegador.pedir(`/configuracion/${seccion}`)
      const html = await r.text()
      expect(r.status).toBe(200)
      expect(r.headers.get('content-security-policy')).not.toContain('unsafe-inline')
      expect(html).not.toMatch(/\sstyle=|\son(click|change|submit)=|<script(?![^>]*src=)/i)
    }
  })
})
