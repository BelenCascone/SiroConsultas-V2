// P5 · Correo saliente, recordatorios automáticos, «Por correo» y «Enviar a la contadora».
import { describe, it, expect, afterEach } from 'vitest'
import { entorno, CLAVE_PRUEBA } from './ayuda'
import { armarMensaje, conversar, esCorreo, usarTransporte, mandarCorreo, type Canal, type CorreoArmado } from '../../src/lib/correo'
import { MENSAJE_ORIGINAL, mandarRecordatorios, pendientesDeRecordatorio, revisarMensaje, textoRecordatorio } from '../../src/lib/recordatorios'
import { elegirPeriodo, hojas, periodos, planilla, totales } from '../../src/lib/contadora'
import { nombreDePeriodo } from '../../src/rutas/contadora'
import { sha256 } from '../../src/lib/documentos'

afterEach(() => usarTransporte(null))

/** Lo que «salió»: el transporte de prueba guarda cada correo. */
function buzon(falla = false) {
  const enviados: CorreoArmado[] = []
  usarTransporte(async (m) => { if (falla) throw new Error('rechazado'); enviados.push(m) })
  return enviados
}
const decodificar = (b64: string) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)))

async function conSesion(cambios: Parameters<typeof entorno>[0] = {}) {
  const objetos = new Map<string, Uint8Array>()
  const t = entorno({
    ARCHIVOS: {
      get: async (k: string) => (objetos.has(k) ? { arrayBuffer: async () => objetos.get(k)!.slice().buffer } : null),
    } as unknown as R2Bucket,
    ...cambios,
  })
  await t.navegador.pedir('/ingresar/prueba', { form: { clave: CLAVE_PRUEBA } })
  return { ...t, objetos }
}

// ---------- SMTP ----------
function servidor(respuestas: string[]) {
  const escrito: string[] = []
  let tls = false
  const canal: Canal = {
    async leer() { const r = respuestas.shift(); if (r === undefined) throw new Error('sin respuesta'); return r },
    async escribir(s) { escrito.push(s) },
    async tls() { tls = true },
  }
  return { canal, escrito, usoTls: () => tls }
}
const correo: CorreoArmado = { de: 'turnos@ejemplo.test', nombreDe: 'Julia Paredes', para: 'paciente@ejemplo.test', asunto: 'Recordatorio de tu turno', texto: '.hola\nlínea 2' }

describe('SMTP', () => {
  it('cifra con STARTTLS antes de autenticarse y manda el mensaje con los puntos escapados', async () => {
    const s = servidor(['220 listo', '250-hola', '250 STARTTLS', '220 dale', '250-hola', '250 AUTH LOGIN PLAIN', '235 ok', '250 ok', '250 ok', '354 mandá', '250 recibido'])
    await conversar(s.canal, correo, 'usuario', 'clave', false)
    expect(s.usoTls()).toBe(true)
    const pasos = s.escrito.map((l) => l.split('\r\n')[0])
    expect(pasos.slice(0, 3)).toEqual(['EHLO siroconsultas', 'STARTTLS', 'EHLO siroconsultas'])
    expect(pasos[3]).toBe(`AUTH PLAIN ${btoa('\0usuario\0clave')}`)
    expect(pasos.slice(4, 7)).toEqual(['MAIL FROM:<turnos@ejemplo.test>', 'RCPT TO:<paciente@ejemplo.test>', 'DATA'])
    const datos = s.escrito[7]
    expect(datos.endsWith('\r\n.\r\n')).toBe(true)
    expect(datos.split('\r\n').some((l) => l.startsWith('.') && l !== '.' && !l.startsWith('..'))).toBe(false)
  })

  it('no manda la clave si el servidor no ofrece STARTTLS', async () => {
    const s = servidor(['220 listo', '250-hola', '250 AUTH PLAIN'])
    await expect(conversar(s.canal, correo, 'u', 'c', false)).rejects.toThrow(/STARTTLS/)
    expect(s.escrito.join('')).not.toContain('AUTH')
  })

  it('usa AUTH LOGIN cuando es lo único que acepta y corta si el servidor rechaza al destinatario', async () => {
    const s = servidor(['220 listo', '250-hola', '250 AUTH LOGIN', '334 VXNlcm5hbWU6', '334 UGFzc3dvcmQ6', '235 ok', '250 ok', '550 no existe'])
    await expect(conversar(s.canal, correo, 'u', 'c', true)).rejects.toThrow(/RCPT TO/)
    expect(s.escrito.map((l) => l.trim())).toEqual(['EHLO siroconsultas', 'AUTH LOGIN', btoa('u'), btoa('c'), 'MAIL FROM:<turnos@ejemplo.test>', 'RCPT TO:<paciente@ejemplo.test>'])
  })

  it('arma el mensaje con tildes, copia, respuesta y adjunto', () => {
    const m = armarMensaje({ ...correo, asunto: 'Cobros de octubre · Julia', copia: 'yo@ejemplo.test', responderA: 'yo@ejemplo.test', adjuntos: [{ nombre: 'planilla "x".xlsx', tipo: 'application/pdf', datos: new Uint8Array([1, 2, 3]) }] }, new Date('2026-10-24T12:00:00Z'), 'id-fijo')
    expect(m).toContain(`Subject: =?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode('Cobros de octubre · Julia')))}?=`)
    expect(m).toContain('Cc: yo@ejemplo.test\r\nReply-To: yo@ejemplo.test')
    expect(m).toContain('Date: Sat, 24 Oct 2026 12:00:00 +0000')
    expect(m).toContain('filename="planilla _x_.xlsx"')
    expect(m).toContain('AQID')
    const texto = m.split('Content-Transfer-Encoding: base64\r\n\r\n')[1].split('\r\n--')[0]
    expect(decodificar(texto)).toBe('.hola\r\nlínea 2')
  })

  it('valida direcciones y no deja colar encabezados', async () => {
    expect(esCorreo('a@b.co')).toBe(true)
    for (const malo of ['a@b', 'a b@c.co', 'a@b.co\r\nBcc: x@y.z', '<a@b.co>', 'a,b@c.co']) expect(esCorreo(malo)).toBe(false)
    const { env } = entorno({ MODO_PRUEBA: '0' })
    await expect(mandarCorreo(env, { para: 'a@b.co', asunto: 'x', texto: 'y' }, 'X')).rejects.toThrow(/no está configurado/)
    buzon()
    await expect(mandarCorreo(env, { para: 'a@b.co\nBcc: x@y.z', asunto: 'x', texto: 'y' }, 'X')).rejects.toThrow(/destinatario/)
  })
})

// ---------- Recordatorios ----------
const MS = Date.parse('2030-03-10T12:00:00Z') // 9:00 en Argentina
function turno(db: ReturnType<typeof entorno>['db'], paciente: number, fecha: string, hora: string, consultorio = 1) {
  return Number(db.prepare('INSERT INTO turnos (paciente_id, consultorio_id, fecha, hora, duracion_min) VALUES (?, ?, ?, ?, 30)').run(paciente, consultorio, fecha, hora).lastInsertRowid)
}

describe('Recordatorio de turno', () => {
  it('arma el mensaje con nombre, día, hora y lugar, y valida lo que escribe la profesional', () => {
    const d = { nombre: 'Diego', fecha: '2026-10-24', hora: '17:00', modalidad: 'presencial', consultorio: 'Norte', direccion: 'Belgrano 1200', enlace_video: null }
    expect(textoRecordatorio(null, d)).toBe('Hola Diego, te recordamos tu turno el sábado 24/10 a las 17:00.\nConsultorio Norte · Belgrano 1200\n¿Nos confirmás que venís? Si no podés, avisanos así reprogramamos. ¡Gracias!')
    expect(textoRecordatorio('{nombre}: {lugar}', { ...d, modalidad: 'videollamada', enlace_video: 'https://meet.ejemplo.test/x' })).toBe('Diego: Por videollamada: https://meet.ejemplo.test/x')
    expect(revisarMensaje(MENSAJE_ORIGINAL)).toBeNull()
    expect(revisarMensaje('Hola {paciente} el {dia} a las {hora}')).toMatch(/\{paciente\}/)
    expect(revisarMensaje('Hola {nombre}')).toMatch(/\{dia\} y \{hora\}/)
    expect(revisarMensaje('  ')).toMatch(/Escribí/)
    expect(revisarMensaje('{dia}{hora}' + 'x'.repeat(600))).toMatch(/600/)
  })

  it('manda una sola vez a los que tienen turno en las próximas 48 h y dejaron su correo', async () => {
    const { db, env } = entorno()
    const enviados = buzon()
    const dentro = turno(db, 1, '2030-03-11', '10:00')          // mañana: Tomás tiene correo
    const justo = turno(db, 3, '2030-03-12', '09:00')           // justo 48 h
    turno(db, 3, '2030-03-12', '09:30')                         // pasadas las 48 h
    turno(db, 2, '2030-03-11', '11:00')                         // Ana no tiene correo
    turno(db, 1, '2030-03-10', '08:30')                         // ya pasó
    const baja = turno(db, 4, '2030-03-11', '12:00')
    db.prepare("UPDATE pacientes SET correo = 'martin@ejemplo.test', recordatorios_baja = 1 WHERE id = 4").run()
    const cancelado = turno(db, 3, '2030-03-11', '15:00')
    db.prepare("UPDATE turnos SET estado = 'cancelado', cancelado_por = 'profesional', cerrado_en = '2030-03-09T00:00:00Z' WHERE id = ?").run(cancelado)

    expect(await mandarRecordatorios(env, MS)).toEqual({ enviados: 2, fallidos: 0 })
    expect(enviados.map((m) => m.para)).toEqual(['tomas@ejemplo.test', 'lucia@ejemplo.test'])
    expect(enviados[0].asunto).toBe('Recordatorio de tu turno del lunes 11/3 a las 10:00')
    expect(enviados[0].texto).toContain('Consultorio Centro · San Martín 100')
    expect(enviados[0].texto).toContain('Julia Paredes')
    expect(enviados[0].responderA).toBe('demo@siroconsultas.test')
    expect(db.prepare('SELECT recordatorio_correo_en IS NOT NULL m FROM turnos WHERE id IN (?, ?, ?)').all(dentro, justo, baja).map((r) => r.m)).toEqual([1, 1, 0])
    expect(db.prepare("SELECT COUNT(*) n FROM envios WHERE que = 'recordatorio' AND canal = 'correo' AND estado = 'enviado'").get()!.n).toBe(2)
    // La hora siguiente no repite: solo sale el que entró en las 48 h.
    expect(await mandarRecordatorios(env, MS + 3600_000)).toEqual({ enviados: 1, fallidos: 0 })
    expect(enviados.map((m) => m.asunto)).toHaveLength(3)
    expect(enviados[2].asunto).toContain('09:30')
    expect(await mandarRecordatorios(env, MS + 3600_000)).toEqual({ enviados: 0, fallidos: 0 })
  })

  it('mover el turno vuelve a habilitar el recordatorio', async () => {
    const { db, env } = entorno()
    buzon()
    const id = turno(db, 1, '2030-03-11', '10:00')
    await mandarRecordatorios(env, MS)
    db.prepare("UPDATE turnos SET recordatorio_correo_en = NULL, fecha = '2030-03-11', hora = '16:00' WHERE id = ?").run(id)
    expect((await pendientesDeRecordatorio(env.DB, MS)).map((t) => t.id)).toEqual([id])
  })

  it('apagado o sin correo configurado no manda nada', async () => {
    const { db, env } = entorno()
    turno(db, 1, '2030-03-11', '10:00')
    expect(await mandarRecordatorios(env, MS)).toEqual({ enviados: 0, fallidos: 0 }) // demo sin servidor
    const enviados = buzon()
    db.prepare('UPDATE profesional SET recordatorio_correo_activo = 0').run()
    expect(await mandarRecordatorios(env, MS)).toEqual({ enviados: 0, fallidos: 0 })
    expect(enviados).toHaveLength(0)
    expect(db.prepare('SELECT COUNT(*) n FROM turnos WHERE recordatorio_correo_en IS NOT NULL').get()!.n).toBe(0)
  })

  it('si el correo rebota, avisa en la campanita y no lo reintenta solo', async () => {
    const { db, env } = entorno()
    buzon(true)
    const id = turno(db, 1, '2030-03-11', '10:00')
    expect(await mandarRecordatorios(env, MS)).toEqual({ enviados: 0, fallidos: 1 })
    const aviso = db.prepare("SELECT texto, enlace FROM notificaciones WHERE tipo = 'correo_rechazado'").get()!
    expect(aviso.texto).toContain('Tomás Ferreyra')
    expect(aviso.texto).not.toMatch(/control|motivo/i)
    expect(aviso.enlace).toBe(`/agenda?vista=dia&fecha=2030-03-11&turno=${id}`)
    expect(db.prepare("SELECT estado FROM envios WHERE que = 'recordatorio'").get()!.estado).toBe('fallido')
    expect(await mandarRecordatorios(env, MS + 3600_000)).toEqual({ enviados: 0, fallidos: 0 })
  })

  it('Configuración → Recordatorios guarda el mensaje y el envío automático', async () => {
    const { db, navegador } = await conSesion()
    const r = await navegador.pedir('/configuracion/recordatorios')
    const html = await r.text()
    expect(r.status).toBe(200)
    expect(html).toContain('Así lo ve Diego')
    expect(html).toContain('Hola Diego, te recordamos tu turno el')
    expect(html).toContain('Consultorio Centro · San Martín 100')
    expect(html).toContain('En la demo no sale ningún correo de verdad')
    expect((await navegador.pedir('/configuracion/recordatorios', { form: { mensaje: 'Hola {nombre}, {paciente}' } })).status).toBe(422)
    expect(db.prepare('SELECT recordatorio_mensaje m FROM profesional').get()!.m).toBeNull()
    const ok = await navegador.pedir('/configuracion/recordatorios', { form: { mensaje: 'Hola {nombre}: {dia} a las {hora}. {lugar}' } })
    expect(ok.status).toBe(303)
    expect(db.prepare('SELECT recordatorio_mensaje m, recordatorio_correo_activo a FROM profesional').get()).toEqual({ m: 'Hola {nombre}: {dia} a las {hora}. {lugar}', a: 0 })
    const original = await navegador.pedir('/configuracion/recordatorios', { form: { mensaje: 'x', accion: 'original', correo_activo: '1' } })
    expect(await original.text()).toContain('Volviste al mensaje original')
    await navegador.pedir('/configuracion/recordatorios', { form: { mensaje: MENSAJE_ORIGINAL, correo_activo: '1' } })
    expect(db.prepare('SELECT recordatorio_mensaje m, recordatorio_correo_activo a FROM profesional').get()).toEqual({ m: null, a: 1 })
  })

  it('sin agenda, Recordatorios no existe', async () => {
    const { navegador } = await conSesion({ MODULOS: 'cobros' })
    expect((await navegador.pedir('/configuracion/recordatorios')).status).toBe(404)
  })

  it('«Mandar recordatorio» es un enlace a WhatsApp con el mensaje, y queda anotado', async () => {
    const { db, navegador } = await conSesion()
    db.prepare("UPDATE profesional SET recordatorio_mensaje = 'Hola {nombre}, te espero el {dia} a las {hora}.'").run()
    const id = turno(db, 1, '2030-03-11', '10:00')
    const html = await (await navegador.pedir(`/agenda?vista=dia&fecha=2030-03-11&turno=${id}`)).text()
    // Un enlace, no un formulario: la CSP no deja que un formulario termine en wa.me.
    expect(html).toContain(`href="https://wa.me/5493431111111?text=${encodeURIComponent('Hola Tomás, te espero el lunes 11/3 a las 10:00.')}"`)
    expect(html).toContain(`data-anotar="/turnos/${id}/recordatorio"`)
    expect(html).not.toContain(`action="/turnos/${id}/recordatorio"`)
    const r = await navegador.pedir(`/turnos/${id}/recordatorio`, { form: {} })
    expect(r.status).toBe(204)
    expect(db.prepare('SELECT recordatorio_whatsapp_en IS NOT NULL m FROM turnos WHERE id = ?').get(id)!.m).toBe(1)
    expect(db.prepare("SELECT canal FROM envios WHERE que = 'recordatorio' AND objeto_id = ?").get(id)!.canal).toBe('whatsapp')
    expect(await (await navegador.pedir(`/agenda?vista=dia&fecha=2030-03-11&turno=${id}`)).text()).toContain('Ya se lo mandaste por WhatsApp')
    db.prepare('UPDATE pacientes SET recordatorios_baja = 1 WHERE id = 1').run()
    expect((await navegador.pedir(`/turnos/${id}/recordatorio`, { form: {} })).status).toBe(404)
    expect(await (await navegador.pedir(`/agenda?vista=dia&fecha=2030-03-11&turno=${id}`)).text()).not.toContain('Mandar recordatorio')
  })
})

// ---------- Por correo ----------
describe('Por correo', () => {
  async function conComprobante() {
    const t = await conSesion({ MODO_PRUEBA: '1' })
    const pdf = new TextEncoder().encode('%PDF-ficticio')
    t.objetos.set('comprobantes/1.pdf', pdf)
    t.db.prepare("INSERT INTO comprobantes (pago_id, tipo, numero, receptor_nombre, receptor_doc_tipo, receptor_doc, importe, fecha, estado, pdf_clave, pdf_sha256) VALUES (1, 'interno', 7, 'Ana Gómez', 'dni', '28333444', 1000000, '2030-03-01', 'emitido', 'comprobantes/1.pdf', ?)").run(await sha256(pdf))
    return t
  }

  it('manda el comprobante con el PDF original adjunto y lo registra', async () => {
    const t = await conComprobante()
    t.db.prepare("UPDATE pacientes SET correo = 'ana@ejemplo.test' WHERE id = 2").run()
    const vista = await (await t.navegador.pedir('/comprobantes/1')).text()
    expect(vista).toContain('action="/comprobantes/1/correo"')
    expect(vista).toContain('Le llega a ana@ejemplo.test')
    const enviados = buzon()
    const r = await t.navegador.pedir('/comprobantes/1/correo', { form: { volver: '/comprobantes/1' } })
    expect(r.status).toBe(200)
    expect(await r.text()).toContain('Le mandamos el comprobante a Ana Gómez (ana@ejemplo.test)')
    expect(enviados[0]).toMatchObject({ para: 'ana@ejemplo.test', asunto: 'Comprobante N.º 00000007', responderA: 'demo@siroconsultas.test' })
    expect(new TextDecoder().decode(enviados[0].adjuntos![0].datos)).toBe('%PDF-ficticio')
    expect(t.db.prepare("SELECT canal, destino, estado FROM envios WHERE que = 'comprobante'").get()).toEqual({ canal: 'correo', destino: 'ana@ejemplo.test', estado: 'enviado' })
  })

  it('no manda si la huella no coincide, si no tiene correo o si el envío falla', async () => {
    const t = await conComprobante()
    expect(await (await t.navegador.pedir('/comprobantes/1')).text()).toContain('No tiene correo en su ficha')
    expect((await t.navegador.pedir('/comprobantes/1/correo', { form: {} })).status).toBe(422)
    t.db.prepare("UPDATE pacientes SET correo = 'ana@ejemplo.test' WHERE id = 2").run()
    t.objetos.set('comprobantes/1.pdf', new TextEncoder().encode('cambiado'))
    const enviados = buzon()
    const r = await t.navegador.pedir('/comprobantes/1/correo', { form: { volver: '//otro.sitio' } })
    const html = await r.text()
    expect(html).toContain('su huella no coincide')
    expect(html).toContain('href="/comprobantes/1"')
    expect(enviados).toHaveLength(0)
    t.objetos.set('comprobantes/1.pdf', new TextEncoder().encode('%PDF-ficticio'))
    buzon(true)
    expect(await (await t.navegador.pedir('/comprobantes/1/correo', { form: {} })).text()).toContain('No pudimos mandar el correo')
    expect(t.db.prepare("SELECT estado FROM envios WHERE que = 'comprobante'").get()!.estado).toBe('fallido')
  })

  it('manda el certificado y no manda uno anulado', async () => {
    const t = await conSesion()
    const pdf = new TextEncoder().encode('%PDF-certificado')
    t.objetos.set('documentos/9.pdf', pdf)
    t.db.prepare("INSERT INTO documentos (id, paciente_id, tipo, datos, fecha, pdf_clave, pdf_sha256) VALUES (9, 1, 'certificado', '{}', '2030-03-01', 'documentos/9.pdf', ?)").run(await sha256(pdf))
    expect(await (await t.navegador.pedir('/documentos/9')).text()).toContain('action="/documentos/9/correo"')
    const enviados = buzon()
    expect(await (await t.navegador.pedir('/documentos/9/correo', { form: {} })).text()).toContain('Le mandamos el certificado a Tomás Ferreyra')
    expect(enviados[0].adjuntos![0].nombre).toBe('certificado_9.pdf')
    t.db.prepare("UPDATE documentos SET anulado_en = '2030-03-02T00:00:00Z', anulado_motivo = 'error' WHERE id = 9").run()
    expect((await t.navegador.pedir('/documentos/9/correo', { form: {} })).status).toBe(422)
    expect(enviados).toHaveLength(1)
  })

  it('manda los datos de pago por correo', async () => {
    const t = await conSesion()
    t.db.prepare("UPDATE profesional SET transferencia_alias = 'alias.ficticio'").run()
    const paso = await (await t.navegador.pedir('/cobros/nuevo?cobro=1')).text()
    expect(paso).toContain('No tiene correo en su ficha')
    t.db.prepare("UPDATE pacientes SET correo = 'ana@ejemplo.test' WHERE id = 2").run()
    expect(await (await t.navegador.pedir('/cobros/nuevo?cobro=1')).text()).toContain('action="/cobros/datos-pago/correo"')
    const enviados = buzon()
    const r = await t.navegador.pedir('/cobros/datos-pago/correo', { form: { tipo: 'cobro', id: '1', volver: '/cobros/nuevo?cobro=1' } })
    expect(await r.text()).toContain('Le mandamos los datos de pago')
    expect(enviados[0].texto).toContain('Alias: alias.ficticio')
    expect(enviados[0].texto).toContain('La app no mueve plata')
    expect(t.db.prepare("SELECT objeto_id FROM envios WHERE que = 'datos_pago'").get()!.objeto_id).toBe(1)
  })
})

// ---------- Contadora ----------
/** Lee los archivos de un ZIP sin comprimir. */
function leerZip(b: Uint8Array) {
  const v = new DataView(b.buffer, b.byteOffset), archivos = new Map<string, string>()
  for (let p = 0; v.getUint32(p, true) === 0x04034b50;) {
    const largo = v.getUint32(p + 18, true), n = v.getUint16(p + 26, true), extra = v.getUint16(p + 28, true)
    const nombre = new TextDecoder().decode(b.subarray(p + 30, p + 30 + n))
    archivos.set(nombre, new TextDecoder().decode(b.subarray(p + 30 + n + extra, p + 30 + n + extra + largo)))
    p += 30 + n + extra + largo
  }
  return archivos
}

describe('Enviar a la contadora', () => {
  it('ofrece el mes, el anterior, el último trimestre cerrado y fechas a elección', () => {
    expect(periodos('2026-10-24').map((p) => [p.clave, p.desde, p.hasta, p.titulo])).toEqual([
      ['mes', '2026-10-01', '2026-10-31', 'Octubre'], ['anterior', '2026-09-01', '2026-09-30', 'Septiembre'],
      ['trimestre', '2026-07-01', '2026-09-30', 'Tercer trimestre'], ['fechas', '2026-10-01', '2026-10-24', 'Elegir fechas'],
    ])
    expect(periodos('2027-01-05').slice(1, 3).map((p) => [p.desde, p.hasta, p.titulo])).toEqual([['2026-12-01', '2026-12-31', 'Diciembre'], ['2026-10-01', '2026-12-31', 'Cuarto trimestre']])
    expect(periodos('2028-03-02')[1].hasta).toBe('2028-02-29')
    expect(elegirPeriodo('2026-10-24', { periodo: 'fechas', desde: '2026-10-10', hasta: '2026-10-01' }).error).toMatch(/anterior/)
    expect(elegirPeriodo('2026-10-24', { periodo: 'fechas', desde: '2025-01-01', hasta: '2026-10-01' }).error).toMatch(/un año/)
    expect(elegirPeriodo('2026-10-24', { periodo: 'fechas', desde: '2026-10-01', hasta: '2026-10-15' })).toMatchObject({ periodo: { nombre: 'del 1/10 al 15/10' } })
    expect(elegirPeriodo('2026-10-24', { periodo: 'otro' }).periodo.clave).toBe('mes')
    expect(nombreDePeriodo('2026-09-01', '2026-09-30', '2026-10-24')).toBe('Septiembre')
    expect(nombreDePeriodo('2025-07-01', '2025-09-30', '2026-10-24')).toBe('Tercer trimestre 2025')
    expect(nombreDePeriodo('2026-10-01', '2026-10-15', '2026-10-24')).toBe('Del 1/10/2026 al 15/10/2026')
  })

  async function conMovimientos() {
    const t = await conSesion()
    const db = t.db
    db.prepare("UPDATE profesional SET correo_contadora = 'contadora@ejemplo.test'").run()
    db.prepare("INSERT INTO cobros (id, paciente_id, concepto, importe, fecha) VALUES (10, 1, '=HYPERLINK(\"x\")', 2000000, '2030-03-05'), (11, 3, 'Consulta', 1500000, '2030-03-06')").run()
    db.prepare("INSERT INTO pagos (id, cobro_id, importe, medio, fecha) VALUES (10, 10, 2000000, 'transferencia', '2030-03-05'), (11, 11, 500000, 'efectivo', '2030-03-06'), (12, 11, 300000, 'efectivo', '2030-03-07')").run()
    db.prepare("INSERT INTO comprobantes (pago_id, tipo, numero, receptor_nombre, receptor_doc_tipo, receptor_doc, importe, fecha, estado) VALUES (10, 'interno', 1, 'Tomás Ferreyra', 'dni', '30111222', 2000000, '2030-03-05', 'emitido')").run()
    db.prepare("UPDATE comprobantes SET estado = 'anulado', anulado_en = '2030-03-08T00:00:00Z', anulado_motivo = 'Cargado dos veces' WHERE pago_id = 10").run()
    db.prepare("UPDATE pagos SET anulado_en = '2030-03-08T00:00:00Z', anulado_motivo = 'Cargado dos veces' WHERE id = 10").run()
    return t
  }

  it('suma lo cobrado del período sin los pagos anulados', async () => {
    const { env } = await conMovimientos()
    expect(await totales(env.DB, '2030-03-01', '2030-03-31')).toEqual({ cobrado: 800000, pagos: 2, facturado: 0, facturas: 0, sin_factura: 800000, internos: 0 })
  })

  it('la planilla trae tres hojas, sin datos clínicos y sin fórmulas', async () => {
    const { env } = await conMovimientos()
    const z = leerZip(planilla(await hojas(env.DB, '2030-03-01', '2030-03-31')))
    expect([...z.keys()]).toEqual(['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'xl/worksheets/sheet3.xml'])
    expect(z.get('xl/workbook.xml')).toContain('<sheet name="Cobros" sheetId="1" r:id="rId1"/><sheet name="Pagos" sheetId="2" r:id="rId2"/><sheet name="Comprobantes" sheetId="3" r:id="rId3"/>')
    const cobros = z.get('xl/worksheets/sheet1.xml')!, pagos = z.get('xl/worksheets/sheet2.xml')!, comps = z.get('xl/worksheets/sheet3.xml')!
    expect(cobros).toContain('Ferreyra, Tomás')
    expect(cobros).toContain("'=HYPERLINK(&quot;x&quot;)")
    expect(cobros).toContain('<v>15000</v>')
    expect(pagos).toContain('Cargado dos veces')
    expect(pagos).toContain('Comprobante interno 00000001')
    expect(comps).toContain('Anulado')
    expect((cobros + pagos + comps).match(/<row /g)).toHaveLength(2 + 1 + 3 + 1 + 1 + 1)
    for (const h of [cobros, pagos, comps]) expect(h).not.toMatch(/diagn|alerg|evoluci/i)
  })

  it('manda la planilla a la contadora con copia y la deja en envíos anteriores', async () => {
    const t = await conMovimientos()
    const enviados = buzon()
    const pantalla = await (await t.navegador.pedir('/contadora?periodo=fechas&desde=2030-03-01&hasta=2030-03-31')).text()
    expect(pantalla).toContain('contadora@ejemplo.test')
    expect(pantalla).toContain('Enviar del 1/3 al 31/3')
    expect(pantalla).toContain('$ 8.000')
    const r = await t.navegador.pedir('/contadora/enviar', { form: { periodo: 'fechas', desde: '2030-03-01', hasta: '2030-03-31' } })
    expect(r.status).toBe(303)
    expect(r.headers.get('location')).toBe('/contadora?periodo=fechas&desde=2030-03-01&hasta=2030-03-31&enviado=1&copia=1')
    expect(enviados[0]).toMatchObject({ para: 'contadora@ejemplo.test', copia: 'demo@siroconsultas.test', asunto: 'Cobros del 1/3/2030 al 31/3/2030 · Julia Paredes' })
    expect(enviados[0].texto).toContain('Cobrado: $ 8.000 (2 pagos)')
    expect(enviados[0].adjuntos![0].nombre).toBe('cobros_2030-03-01_a_2030-03-31.xlsx')
    expect(leerZip(enviados[0].adjuntos![0].datos).has('xl/worksheets/sheet3.xml')).toBe(true)
    expect(t.db.prepare('SELECT desde, hasta, para, cobrado FROM envios_contadora').get()).toEqual({ desde: '2030-03-01', hasta: '2030-03-31', para: 'contadora@ejemplo.test', cobrado: 800000 })
    const despues = await (await t.navegador.pedir(r.headers.get('location')!)).text()
    expect(despues).toContain('Enviado. Te llegó una copia a tu correo.')
    expect(despues).toContain('Marzo 2030')
  })

  it('descarga la planilla sin correo y no deja enviar sin contadora', async () => {
    const t = await conMovimientos()
    const d = await t.navegador.pedir('/contadora/planilla', { form: { periodo: 'mes' } })
    expect(d.status).toBe(200)
    expect(d.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(d.headers.get('content-disposition')).toMatch(/attachment; filename="cobros_\d{4}-\d{2}-01_a_\d{4}-\d{2}-\d{2}\.xlsx"/)
    expect(leerZip(new Uint8Array(await d.arrayBuffer())).size).toBe(8)
    expect(t.db.prepare('SELECT para FROM envios_contadora').get()!.para).toBeNull()
    t.db.prepare('UPDATE profesional SET correo_contadora = NULL').run()
    const enviados = buzon()
    expect(await (await t.navegador.pedir('/contadora')).text()).toContain('Todavía no cargaste el correo de tu contadora')
    expect((await t.navegador.pedir('/contadora/enviar', { form: { periodo: 'mes' } })).status).toBe(422)
    expect(enviados).toHaveLength(0)
    expect((await t.navegador.pedir('/contadora/enviar', { form: { periodo: 'fechas', desde: '2030-03-09', hasta: '2030-03-01' } })).status).toBe(422)
  })

  it('sin el módulo de cobros no existe', async () => {
    const { navegador } = await conSesion({ MODULOS: 'agenda' })
    expect((await navegador.pedir('/contadora')).status).toBe(404)
    expect((await navegador.pedir('/contadora/planilla', { form: { periodo: 'mes' } })).status).toBe(404)
  })
})
