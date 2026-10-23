// Ingreso y seguridad de la app real (docs/ANALISIS_FUNCIONAL.md · flujo 1, «Puesta en marcha»).
import { describe, it, expect } from 'vitest'
import { entorno, preSesion, CLAVE_PRUEBA, EMAIL } from './ayuda'
import { huella, codigoTotp, descifrarSecreto } from '../../src/lib/totp'
import { TOTP_CLAVE } from './ayuda'

const entrarDemo = async (nav: ReturnType<typeof entorno>['navegador']) =>
  nav.pedir('/ingresar/prueba', { form: { clave: CLAVE_PRUEBA } })

describe('Sin sesión', () => {
  it('todo lleva al ingreso, salvo /salud', async () => {
    const { navegador } = entorno()
    const r = await navegador.pedir('/')
    expect(r.status).toBe(302)
    expect(r.headers.get('location')).toBe('/ingresar')
    expect((await navegador.pedir('/pacientes')).headers.get('location')).toBe('/ingresar')
    expect((await navegador.pedir('/salud')).status).toBe(200)
  })
  it('un POST sin sesión no hace nada', async () => {
    const { navegador } = entorno()
    expect((await navegador.pedir('/componentes', { form: {} })).status).toBe(401)
  })
  it('sin SESION_SECRETO la app no arranca (falla cerrado)', async () => {
    const { navegador } = entorno({ SESION_SECRETO: 'corto' })
    expect((await navegador.pedir('/ingresar')).status).toBe(503)
  })
})

describe('Ingreso de la demo', () => {
  it('con la clave de prueba entra y ve Hoy con los turnos del día', async () => {
    const { navegador } = entorno()
    const r = await entrarDemo(navegador)
    expect(r.headers.get('location')).toBe('/')
    const hoy = await navegador.pedir('/')
    expect(hoy.status).toBe(200)
    const html = await hoy.text()
    expect(html).toContain('Julia')
    expect(html).toContain('Tomás Ferreyra')
    expect(html).toContain('Primera consulta') // Lucía nunca vino
    expect(hoy.headers.get('cache-control')).toBe('no-store')
  })
  it('con otra clave no entra y queda en la auditoría', async () => {
    const { navegador, db } = entorno()
    const r = await navegador.pedir('/ingresar/prueba', { form: { clave: 'otra-clave' } })
    expect(r.headers.get('location')).toBe('/ingresar?e=clave')
    expect((db.prepare(`SELECT COUNT(*) n FROM auditoria WHERE evento = 'ingreso_rechazado'`).get() as any).n).toBe(1)
  })
  it('después de 10 intentos en 15 minutos, frena', async () => {
    const { navegador } = entorno()
    for (let i = 0; i < 10; i++) await navegador.pedir('/ingresar/prueba', { form: { clave: 'mal' } })
    const r = await navegador.pedir('/ingresar/prueba', { form: { clave: CLAVE_PRUEBA } })
    expect(r.headers.get('location')).toBe('/ingresar?e=muchos')
  })
  it('fuera de la demo (MODO_PRUEBA=0) la clave de prueba no existe', async () => {
    const { navegador } = entorno({ MODO_PRUEBA: '0' })
    expect((await entrarDemo(navegador)).status).toBe(404)
    expect(await (await navegador.pedir('/ingresar')).text()).not.toContain('clave de prueba')
  })
  it('salir cierra la sesión en la base', async () => {
    const { navegador, db } = entorno()
    await entrarDemo(navegador)
    const token = navegador.cookies.get('__Host-sc')!
    await navegador.pedir('/salir', { form: {} })
    expect((await navegador.pedir('/')).headers.get('location')).toBe('/ingresar')
    navegador.cookies.set('__Host-sc', token) // aunque se reuse la cookie vieja
    expect((await navegador.pedir('/')).headers.get('location')).toBe('/ingresar')
    expect((db.prepare('SELECT cerrada_en FROM sesiones').get() as any).cerrada_en).toBeTruthy()
  })
})

describe('Segundo código', () => {
  const darAlta = (db: ReturnType<typeof entorno>['db'], codigo: string, h: string, vence = '2099-01-01T00:00:00Z') =>
    db.prepare('INSERT INTO codigos_alta (huella, email, vence_en) VALUES (?, ?, ?)').run(h, EMAIL, vence)

  async function activar() {
    const e = entorno()
    const codigo = 'ABCD-EFGH-2345'
    darAlta(e.db, codigo, await huella(codigo))
    await preSesion(e.navegador)
    expect(await (await e.navegador.pedir('/verificacion')).text()).toContain('Código de alta')
    const alta = await e.navegador.pedir('/verificacion/alta', { form: { alta: codigo.toLowerCase() } })
    expect(alta.headers.get('location')).toBe('/verificacion')
    expect(await (await e.navegador.pedir('/verificacion')).text()).toContain('Escaneá el código')
    const fila = e.db.prepare('SELECT secreto FROM totp WHERE email = ?').get(EMAIL) as any
    const secreto = await descifrarSecreto(fila.secreto, TOTP_CLAVE)
    const paso = Math.floor(Date.now() / 30_000)
    const r = await e.navegador.pedir('/verificacion/activar', { form: { codigo: await codigoTotp(secreto, paso) } })
    return { ...e, r, secreto, paso, codigo }
  }

  it('se activa con el código de alta: muestra 8 códigos de recuperación y entra', async () => {
    const { r, navegador, db } = await activar()
    const html = await r.text()
    expect(html).toContain('guardá estos códigos')
    expect(html.match(/<li>[A-Z2-7]{4}-[A-Z2-7]{4}<\/li>/g)).toHaveLength(8)
    expect((db.prepare('SELECT COUNT(*) n FROM codigos_recuperacion').get() as any).n).toBe(8)
    expect((await navegador.pedir('/')).status).toBe(200)
  })
  it('el código de alta sirve una sola vez', async () => {
    const { navegador, codigo } = await activar()
    await preSesion(navegador)
    expect((await navegador.pedir('/verificacion/alta', { form: { alta: codigo } })).headers.get('location')).toBe('/verificacion')
    expect(await (await navegador.pedir('/verificacion')).text()).toContain('Segundo código') // ya activado: pide el código
  })
  it('un código de alta vencido o equivocado no sirve', async () => {
    const e = entorno()
    darAlta(e.db, 'X', await huella('ZZZZ-ZZZZ-ZZZZ'), '2020-01-01T00:00:00Z')
    await preSesion(e.navegador)
    expect((await e.navegador.pedir('/verificacion/alta', { form: { alta: 'ZZZZ-ZZZZ-ZZZZ' } })).status).toBe(401)
    expect((await e.navegador.pedir('/verificacion/alta', { form: { alta: 'otro' } })).status).toBe(401)
  })
  it('con el segundo código entra; el mismo código no sirve dos veces', async () => {
    const { db, secreto, paso } = await activar()
    const nuevo = entorno()
    // misma base: se copia la fila del segundo código a la base del navegador nuevo
    const fila = db.prepare('SELECT * FROM totp').get() as any
    nuevo.db.prepare('INSERT INTO totp (email, secreto, verificado, ultimo_paso) VALUES (?, ?, 1, ?)').run(fila.email, fila.secreto, fila.ultimo_paso)
    await preSesion(nuevo.navegador)
    const repetido = await nuevo.navegador.pedir('/verificacion', { form: { codigo: await codigoTotp(secreto, paso) } })
    expect(repetido.status).toBe(401)
    const siguiente = await nuevo.navegador.pedir('/verificacion', { form: { codigo: await codigoTotp(secreto, paso + 1) } })
    expect(siguiente.headers.get('location')).toBe('/')
  })
  it('tras 5 códigos mal, se bloquea 15 minutos', async () => {
    const { navegador, secreto, paso } = await activar()
    await navegador.pedir('/salir', { form: {} })
    await preSesion(navegador)
    for (let i = 0; i < 5; i++) await navegador.pedir('/verificacion', { form: { codigo: '000000' } })
    const r = await navegador.pedir('/verificacion', { form: { codigo: await codigoTotp(secreto, paso + 1) } })
    expect(r.status).toBe(429)
  })
  it('un código de recuperación entra una sola vez', async () => {
    const { r, navegador } = await activar()
    const codigos = (await r.text()).match(/<li>([A-Z2-7]{4}-[A-Z2-7]{4})<\/li>/g)!.map((x) => x.slice(4, -5))
    await navegador.pedir('/salir', { form: {} })
    await preSesion(navegador)
    expect((await navegador.pedir('/verificacion', { form: { recuperacion: codigos[0] } })).headers.get('location')).toBe('/')
    await navegador.pedir('/salir', { form: {} })
    await preSesion(navegador)
    expect((await navegador.pedir('/verificacion', { form: { recuperacion: codigos[0] } })).status).toBe(401)
  })
  it('sin pre-sesión (sin pasar por Google) no se llega al segundo código', async () => {
    const { navegador } = entorno()
    expect((await navegador.pedir('/verificacion')).headers.get('location')).toBe('/ingresar?e=vencio')
  })
})

describe('Seguridad', () => {
  it('CSP sin scripts ni estilos en línea, y no se puede meter en un iframe', async () => {
    const { navegador } = entorno()
    const r = await navegador.pedir('/ingresar')
    const csp = r.headers.get('content-security-policy')!
    expect(csp).toContain("script-src 'self'")
    expect(csp).toContain("style-src 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).not.toContain('unsafe-inline')
    expect(r.headers.get('x-frame-options')).toBe('SAMEORIGIN')
  })
  it('un formulario mandado desde otro sitio se rechaza', async () => {
    const { navegador } = entorno()
    const r = await navegador.pedir('/ingresar/prueba', { form: { clave: CLAVE_PRUEBA }, headers: { Origin: 'https://otro-sitio.test' } })
    expect(r.status).toBe(403)
  })
  it('el HTML de las páginas no tiene estilos ni scripts en línea', async () => {
    const { navegador } = entorno()
    await entrarDemo(navegador)
    for (const ruta of ['/', '/componentes', '/agenda', '/ingresar']) {
      const html = await (await navegador.pedir(ruta)).text()
      expect(html, ruta).not.toMatch(/ style="/)
      expect(html, ruta).not.toMatch(/<script(?![^>]*\bsrc=)/)
    }
  })
})

describe('Módulos por instalación', () => {
  it('un módulo apagado sale del menú y sus rutas responden 404', async () => {
    const { navegador } = entorno({ MODULOS: 'agenda' })
    await entrarDemo(navegador)
    const hoy = await (await navegador.pedir('/')).text()
    expect(hoy).toContain('href="/agenda"')
    expect(hoy).not.toContain('>Cobros<')
    expect(hoy).not.toContain('>Estadísticas<')
    expect((await navegador.pedir('/cobros')).status).toBe(404)
    expect((await navegador.pedir('/cobros/nuevo')).status).toBe(404)
    expect((await navegador.pedir('/estadisticas')).status).toBe(404)
    expect((await navegador.pedir('/agenda')).status).toBe(200)
    expect((await navegador.pedir('/pacientes')).status).toBe(200) // núcleo: siempre
  })
  it('el muestrario de componentes solo existe en la demo', async () => {
    const e = entorno()
    await entrarDemo(e.navegador)
    expect((await e.navegador.pedir('/componentes')).status).toBe(200)
    e.env.MODO_PRUEBA = '0'
    expect((await e.navegador.pedir('/componentes')).status).toBe(404)
  })
})
