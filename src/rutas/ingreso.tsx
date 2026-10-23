// Ingreso: Google + segundo código (TOTP). La primera vez, el segundo código se activa con el código de alta que BC
// entrega en persona. En la demo (MODO_PRUEBA=1) hay además un ingreso con clave de prueba, sin datos reales.
import { Hono } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import qrcode from 'qrcode-generator'
import { raw } from 'hono/html'
import type { C, Env } from '../tipos'
import { leerInstalacion } from '../lib/instalacion'
import { Acceso } from '../ui/pagina'
import { Aviso, Boton, Campo } from '../ui/componentes'
import { firmar, verificar, iguales, sha256, tokenAleatorio } from '../lib/firma'
import { verificarTokenGoogle, jwksDeGoogle } from '../lib/google'
import {
  nuevoSecreto, base32, uriOtpauth, cifrarSecreto, descifrarSecreto, verificarTotp, huella, codigoAleatorio, normalizarCodigo,
} from '../lib/totp'
import { abrirSesion, cerrarSesion, excedido, huellaDeIp, iniciarPreSesion, leerPreSesion, leerSesion, registrar } from '../lib/sesion'
import { ahoraISO } from '../lib/fechas'

const MAX_FALLOS = 5
const BLOQUEO_MIN = 15
const COOKIE_GOOGLE = '__Host-sc-g'
const COOKIE_ALTA = '__Host-sc-alta'

export const modoPrueba = (c: C) => c.env.MODO_PRUEBA === '1'
const correosPermitidos = (c: C) => String(c.env.CORREOS_PERMITIDOS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
const cookieCorta = (minutos: number) => ({ httpOnly: true, secure: true, sameSite: 'Lax' as const, path: '/', maxAge: minutos * 60 })
const Volver = () => <p class="chico suave"><a href="/ingresar">Volver al ingreso</a></p>

const MENSAJES: Record<string, string> = {
  google: 'No pudimos confirmar tu cuenta de Google. Probá de nuevo.',
  no_autorizada: 'Esa cuenta de Google no tiene acceso a este sistema.',
  sin_clave_2fa: 'Falta configurar el segundo código en esta instalación. Avisale a BC Informática.',
  clave: 'La clave no es correcta.',
  muchos: 'Hubo demasiados intentos. Esperá unos minutos y probá de nuevo.',
  vencio: 'Pasó demasiado tiempo. Volvé a entrar.',
}

export const ingreso = new Hono<Env>()

// ---------- Pantalla de ingreso ----------
ingreso.get('/ingresar', async (c) => {
  if (await leerSesion(c)) return c.redirect('/')
  const inst = leerInstalacion(c.env)
  const error = MENSAJES[c.req.query('e') ?? '']
  const google = !!c.env.GOOGLE_CLIENT_ID
  return c.html(
    <Acceso titulo="Entrar" sub={google ? 'Entrá con tu cuenta de Google.' : undefined} inst={inst}>
      {error && <Aviso tipo="error">{error}</Aviso>}
      {google && <Boton href="/ingresar/google" variante="oscuro" ancho>Entrar con Google</Boton>}
      {!google && !modoPrueba(c) && <Aviso tipo="ambar">El ingreso con Google todavía no está configurado en esta instalación.</Aviso>}
      {modoPrueba(c) && (
        <details class="desplegable" open={!google}>
          <summary>Entrar a la demo con la clave de prueba</summary>
          <form method="post" action="/ingresar/prueba" class="columna">
            <p class="chico suave">Solo en la demostración, con datos ficticios.</p>
            <Campo etiqueta="Clave de prueba" nombre="clave" tipo="password" requerido autocompletar="current-password" />
            <Boton type="submit" variante="destacado" ancho>Entrar a la demo</Boton>
          </form>
        </details>
      )}
    </Acceso>
  )
})

// ---------- Google (OpenID Connect, flujo id_token por form_post) ----------
ingreso.get('/ingresar/google', async (c) => {
  if (!c.env.GOOGLE_CLIENT_ID) return c.redirect('/ingresar')
  const nonce = tokenAleatorio(16)
  const estado = tokenAleatorio(16)
  setCookie(c, COOKIE_GOOGLE, await firmar(`${Date.now() + 10 * 60_000}|${nonce}|${estado}`, c.env.SESION_SECRETO), cookieCorta(10))
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.search = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID, redirect_uri: new URL(c.req.url).origin + '/ingresar/google',
    response_type: 'id_token', response_mode: 'form_post', scope: 'openid email', nonce, state: estado, prompt: 'select_account',
  }).toString()
  return c.redirect(url.toString())
})

ingreso.post('/ingresar/google', async (c) => {
  const falla = (motivo: string) => c.redirect(`/ingresar?e=${motivo}`)
  const crudo = getCookie(c, COOKIE_GOOGLE)
  deleteCookie(c, COOKIE_GOOGLE, { path: '/', secure: true })
  const valor = crudo ? await verificar(crudo, c.env.SESION_SECRETO) : null
  if (!valor || !c.env.GOOGLE_CLIENT_ID) return falla('google')
  if (!c.env.TOTP_CLAVE) return falla('sin_clave_2fa') // sin segundo código configurado no se entra con Google
  const [vence, nonce, estado] = valor.split('|')
  const f = await c.req.parseBody()
  if (Number(vence) < Date.now() || typeof f.state !== 'string' || !iguales(f.state, estado) || typeof f.id_token !== 'string') return falla('google')
  const r = await verificarTokenGoogle(f.id_token, { clientId: c.env.GOOGLE_CLIENT_ID, nonce, permitidos: correosPermitidos(c), jwks: await jwksDeGoogle() })
  if (!r.ok) {
    await registrar(c, 'ingreso_rechazado', `google:${r.motivo}`)
    return falla(r.motivo === 'no_autorizada' ? 'no_autorizada' : 'google')
  }
  await iniciarPreSesion(c, r.email)
  return c.redirect('/verificacion')
})

// ---------- Demo: clave de prueba (solo con MODO_PRUEBA=1) ----------
ingreso.post('/ingresar/prueba', async (c) => {
  if (!modoPrueba(c)) return c.notFound()
  if (await excedido(c, `prueba:${await huellaDeIp(c)}`, 10, 15)) return c.redirect('/ingresar?e=muchos')
  const f = await c.req.parseBody()
  const clave = typeof f.clave === 'string' ? f.clave : ''
  const esperada = c.env.CLAVE_PRUEBA ?? ''
  if (esperada.length < 8 || !iguales(await sha256(clave), await sha256(esperada))) {
    await registrar(c, 'ingreso_rechazado', 'prueba')
    return c.redirect('/ingresar?e=clave')
  }
  await abrirSesion(c, correosPermitidos(c)[0] ?? 'demo@siroconsultas.test')
  return c.redirect('/')
})

// ---------- Segundo código ----------
type FilaTotp = { secreto: string; verificado: number; ultimo_paso: number; fallos: number; bloqueado: number }
const filaTotp = (c: C, email: string) =>
  c.env.DB.prepare('SELECT secreto, verificado, ultimo_paso, fallos, (bloqueado_hasta IS NOT NULL AND bloqueado_hasta > ?) bloqueado FROM totp WHERE email = ?')
    .bind(ahoraISO(), email).first<FilaTotp>()

async function registrarFallo(c: C, email: string) {
  await c.env.DB.prepare('UPDATE totp SET fallos = fallos + 1, bloqueado_hasta = CASE WHEN fallos + 1 >= ? THEN ? ELSE bloqueado_hasta END WHERE email = ?')
    .bind(MAX_FALLOS, ahoraISO(Date.now() + BLOQUEO_MIN * 60_000), email).run()
}

function PantallaCodigo({ c, aviso }: { c: C; aviso?: string }) {
  return (
    <Acceso titulo="Segundo código" sub="Escribí el código de 6 números de tu aplicación de autenticación." inst={leerInstalacion(c.env)}>
      {aviso && <Aviso tipo="error">{aviso}</Aviso>}
      <form method="post" action="/verificacion" class="columna">
        <Campo etiqueta="Código" nombre="codigo" modoTeclado="numeric" autocompletar="one-time-code" clase="codigo" requerido autofocus />
        <Boton type="submit" variante="destacado" ancho>Entrar</Boton>
      </form>
      <details class="desplegable">
        <summary>No tengo el teléfono</summary>
        <form method="post" action="/verificacion" class="columna">
          <p class="chico suave">Usá uno de los códigos de recuperación que guardaste al activar el segundo código. Cada uno sirve una sola vez.</p>
          <Campo etiqueta="Código de recuperación" nombre="recuperacion" autocompletar="off" requerido />
          <Boton type="submit" variante="oscuro" ancho>Usar código de recuperación</Boton>
        </form>
      </details>
      <Volver />
    </Acceso>
  )
}

function PantallaAlta({ c, aviso }: { c: C; aviso?: string }) {
  return (
    <Acceso titulo="Activá el segundo código" sub="Es un paso más para cuidar las historias clínicas. Lo hacés una sola vez." inst={leerInstalacion(c.env)}>
      {aviso && <Aviso tipo="error">{aviso}</Aviso>}
      <form method="post" action="/verificacion/alta" class="columna">
        <Campo etiqueta="Código de alta" nombre="alta" ayuda="Te lo da BC Informática en persona." autocompletar="off" requerido autofocus />
        <Boton type="submit" variante="destacado" ancho>Seguir</Boton>
      </form>
      <Volver />
    </Acceso>
  )
}

async function PantallaQr({ c, email, aviso }: { c: C; email: string; aviso?: string }) {
  const fila = await filaTotp(c, email)
  if (!fila || !c.env.TOTP_CLAVE) return <PantallaAlta c={c} aviso={MENSAJES.vencio} />
  const secreto = await descifrarSecreto(fila.secreto, c.env.TOTP_CLAVE)
  const qr = qrcode(0, 'M')
  qr.addData(uriOtpauth(email, secreto))
  qr.make()
  return (
    <Acceso titulo="Escaneá el código" sub="Con Google Authenticator, Microsoft Authenticator o la que uses." inst={leerInstalacion(c.env)}>
      {aviso && <Aviso tipo="error">{aviso}</Aviso>}
      <div class="qr">{raw(qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true }))}</div>
      <details class="desplegable">
        <summary>No puedo escanearlo</summary>
        <p class="chico">Cargá esta clave a mano: <strong>{base32(secreto).match(/.{1,4}/g)!.join(' ')}</strong></p>
      </details>
      <form method="post" action="/verificacion/activar" class="columna">
        <Campo etiqueta="Código que muestra la aplicación" nombre="codigo" modoTeclado="numeric" autocompletar="one-time-code" clase="codigo" requerido />
        <Boton type="submit" variante="destacado" ancho>Activar</Boton>
      </form>
    </Acceso>
  )
}

ingreso.get('/verificacion', async (c) => {
  const email = await leerPreSesion(c)
  if (!email) return c.redirect('/ingresar?e=vencio')
  const fila = await filaTotp(c, email)
  if (fila?.verificado) return c.html(<PantallaCodigo c={c} />)
  const alta = getCookie(c, COOKIE_ALTA)
  if (alta && (await verificar(alta, c.env.SESION_SECRETO)) === `${email}`) return c.html(await PantallaQr({ c, email }))
  return c.html(<PantallaAlta c={c} />)
})

ingreso.post('/verificacion', async (c) => {
  const email = await leerPreSesion(c)
  if (!email || !c.env.TOTP_CLAVE) return c.redirect('/ingresar?e=vencio')
  const fila = await filaTotp(c, email)
  if (!fila?.verificado) return c.redirect('/verificacion')
  if (fila.bloqueado) return c.html(<PantallaCodigo c={c} aviso={MENSAJES.muchos} />, 429)
  const f = await c.req.parseBody()
  if (typeof f.recuperacion === 'string' && f.recuperacion.trim()) {
    const usado = await c.env.DB.prepare('UPDATE codigos_recuperacion SET usado_en = ? WHERE huella = ? AND email = ? AND usado_en IS NULL')
      .bind(ahoraISO(), await huella(f.recuperacion), email).run()
    if (!usado.meta.changes) {
      await registrarFallo(c, email)
      return c.html(<PantallaCodigo c={c} aviso="Ese código de recuperación no sirve." />, 401)
    }
    await c.env.DB.prepare('UPDATE totp SET fallos = 0, bloqueado_hasta = NULL WHERE email = ?').bind(email).run()
    await registrar(c, 'recuperacion_usada', null, email)
    await abrirSesion(c, email)
    return c.redirect('/')
  }
  const codigo = typeof f.codigo === 'string' ? f.codigo.replace(/\s/g, '') : ''
  const paso = await verificarTotp(await descifrarSecreto(fila.secreto, c.env.TOTP_CLAVE), codigo, Date.now(), fila.ultimo_paso)
  if (paso === null) {
    await registrarFallo(c, email)
    return c.html(<PantallaCodigo c={c} aviso="El código no es correcto o ya se usó." />, 401)
  }
  await c.env.DB.prepare('UPDATE totp SET ultimo_paso = ?, fallos = 0, bloqueado_hasta = NULL WHERE email = ?').bind(paso, email).run()
  await abrirSesion(c, email)
  return c.redirect('/')
})

// Alta: el código que da BC habilita a crear el secreto. Queda marcado como usado.
ingreso.post('/verificacion/alta', async (c) => {
  const email = await leerPreSesion(c)
  if (!email || !c.env.TOTP_CLAVE) return c.redirect('/ingresar?e=vencio')
  if ((await filaTotp(c, email))?.verificado) return c.redirect('/verificacion')
  if (await excedido(c, `alta:${email}`, MAX_FALLOS, BLOQUEO_MIN)) return c.html(<PantallaAlta c={c} aviso={MENSAJES.muchos} />, 429)
  const f = await c.req.parseBody()
  const alta = typeof f.alta === 'string' ? normalizarCodigo(f.alta) : ''
  const usado = alta && await c.env.DB.prepare('UPDATE codigos_alta SET usado_en = ? WHERE huella = ? AND email = ? AND usado_en IS NULL AND vence_en > ?')
    .bind(ahoraISO(), await huella(alta), email, ahoraISO()).run()
  if (!usado || !usado.meta.changes) {
    await registrar(c, 'alta_rechazada', null, email)
    return c.html(<PantallaAlta c={c} aviso="Ese código de alta no sirve o ya venció." />, 401)
  }
  const secreto = await cifrarSecreto(nuevoSecreto(), c.env.TOTP_CLAVE)
  await c.env.DB.prepare('INSERT INTO totp (email, secreto) VALUES (?, ?) ON CONFLICT (email) DO UPDATE SET secreto = excluded.secreto, ultimo_paso = 0, fallos = 0, bloqueado_hasta = NULL WHERE totp.verificado = 0')
    .bind(email, secreto).run()
  setCookie(c, COOKIE_ALTA, await firmar(email, c.env.SESION_SECRETO), cookieCorta(10))
  await registrar(c, 'alta_usada', null, email)
  return c.redirect('/verificacion')
})

ingreso.post('/verificacion/activar', async (c) => {
  const email = await leerPreSesion(c)
  const alta = getCookie(c, COOKIE_ALTA)
  if (!email || !c.env.TOTP_CLAVE || !alta || (await verificar(alta, c.env.SESION_SECRETO)) !== email) return c.redirect('/ingresar?e=vencio')
  const fila = await filaTotp(c, email)
  if (!fila || fila.verificado) return c.redirect('/verificacion')
  const f = await c.req.parseBody()
  const codigo = typeof f.codigo === 'string' ? f.codigo.replace(/\s/g, '') : ''
  const paso = await verificarTotp(await descifrarSecreto(fila.secreto, c.env.TOTP_CLAVE), codigo, Date.now(), 0)
  if (paso === null) return c.html(await PantallaQr({ c, email, aviso: 'El código no coincide. Fijate que la hora del teléfono esté bien.' }), 401)
  const codigos = Array.from({ length: 8 }, () => codigoAleatorio(8))
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE totp SET verificado = 1, ultimo_paso = ?, fallos = 0 WHERE email = ? AND verificado = 0').bind(paso, email),
    c.env.DB.prepare('DELETE FROM codigos_recuperacion WHERE email = ?').bind(email),
    ...(await Promise.all(codigos.map(async (k) => c.env.DB.prepare('INSERT INTO codigos_recuperacion (huella, email) VALUES (?, ?)').bind(await huella(k), email)))),
  ])
  deleteCookie(c, COOKIE_ALTA, { path: '/', secure: true })
  await registrar(c, 'segundo_codigo_activado', null, email)
  await abrirSesion(c, email)
  return c.html(
    <Acceso titulo="Listo: guardá estos códigos" sub="Si perdés el teléfono, con uno de estos entrás. Cada uno sirve una vez y no se vuelven a mostrar." inst={leerInstalacion(c.env)}>
      <ul class="codigos" aria-label="Códigos de recuperación">{codigos.map((k) => <li>{k}</li>)}</ul>
      <Aviso tipo="ambar">Anotalos en papel o en tu gestor de claves. No los mandes por WhatsApp ni por correo.</Aviso>
      <Boton href="/" variante="destacado" ancho>Ya los guardé, entrar</Boton>
    </Acceso>
  )
})

// ---------- Salir ----------
ingreso.post('/salir', async (c) => {
  const email = await leerSesion(c)
  await cerrarSesion(c)
  if (email) await registrar(c, 'salida', null, email)
  return c.redirect('/ingresar')
})
