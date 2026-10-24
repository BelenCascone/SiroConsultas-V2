// SiroConsultas v2 · Worker principal (Hono, HTML armado en el servidor).
import { Hono } from 'hono'
import { secureHeaders } from 'hono/secure-headers'
import { csrf } from 'hono/csrf'
import { HTTPException } from 'hono/http-exception'
import type { Env } from './tipos'
import { leerInstalacion, moduloDe, habilitado } from './lib/instalacion'
import { leerSesion } from './lib/sesion'
import { SECRETO_MIN } from './lib/firma'
import { ingreso } from './rutas/ingreso'
import { configuracion } from './rutas/configuracion'
import { inicio, datosProfesional, avisosSinLeer } from './rutas/inicio'
import { componentes } from './rutas/componentes'
import { comprobantes } from './rutas/comprobantes'
import { documentos } from './rutas/documentos'
import { consultas } from './rutas/consultas'
import { pacientes } from './rutas/pacientes'
import { turnos } from './rutas/turnos'
import { agenda } from './rutas/agenda'
import { bloqueos } from './rutas/bloqueos'
import { Documento, Pagina, type Seccion } from './ui/pagina'
import { Boton, Tarjeta } from './ui/componentes'

const app = new Hono<Env>()

// ---------- Seguridad: cabeceras, CSP sin scripts ni estilos en línea, envíos solo desde el mismo sitio ----------
app.use('*', secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'"],
    imgSrc: ["'self'", 'data:'],
    fontSrc: ["'self'"],
    connectSrc: ["'self'"],
    formAction: ["'self'", 'https://accounts.google.com'],
    frameAncestors: ["'none'"],
    baseUri: ["'none'"],
    objectSrc: ["'none'"],
  },
  referrerPolicy: 'same-origin',
  strictTransportSecurity: 'max-age=31536000; includeSubDomains',
  permissionsPolicy: { camera: [], microphone: [], geolocation: [] },
}))

// Google devuelve el ingreso con un POST desde su dominio: es el único origen externo aceptado, y solo en esa ruta.
app.use('*', csrf({
  origin: (origen, c) => origen === new URL(c.req.url).origin || (c.req.path === '/ingresar/google' && origen === 'https://accounts.google.com'),
}))

// Sin secreto de sesión la app no arranca: falla cerrado.
app.use('*', async (c, next) => {
  if (!c.env.SESION_SECRETO || c.env.SESION_SECRETO.length < SECRETO_MIN) {
    return c.text('Falta configurar SESION_SECRETO en esta instalación.', 503)
  }
  await next()
})

// Para monitoreo y la prueba de humo del despliegue. No dice nada de los datos.
app.get('/salud', (c) => c.json({ ok: true }))

// ---------- Módulos apagados: todas sus rutas responden 404 (los datos se conservan) ----------
app.use('*', async (c, next) => {
  const m = moduloDe(c.req.path)
  if (m && !habilitado(leerInstalacion(c.env), m)) return c.notFound()
  await next()
})

// ---------- Ingreso (lo único que se ve sin sesión) ----------
app.route('/', ingreso)

const PUBLICAS = ['/ingresar', '/verificacion', '/salir', '/salud']
app.use('*', async (c, next) => {
  if (PUBLICAS.some((p) => c.req.path === p || c.req.path.startsWith(p + '/'))) return next()
  const email = await leerSesion(c)
  if (!email) return c.req.method === 'GET' ? c.redirect('/ingresar') : c.text('Tu sesión terminó. Volvé a entrar.', 401)
  c.set('email', email)
  c.header('Cache-Control', 'no-store')
  await next()
})

app.route('/', inicio)
app.route('/', componentes)
app.route('/', documentos)
app.route('/', consultas)
app.route('/', pacientes)
app.route('/', turnos)
app.route('/', agenda)
app.route('/', bloqueos)
app.route('/', comprobantes)
app.route('/', configuracion)

// ---------- Secciones que se arman en las próximas etapas ----------
const PROXIMAS: { ruta: string; seccion: Seccion; titulo: string }[] = [
  { ruta: '/cobros', seccion: 'cobros', titulo: 'Cobros' },
  { ruta: '/cobros/nuevo', seccion: 'cobros', titulo: 'Cobrar' },
  { ruta: '/estadisticas', seccion: 'estadisticas', titulo: 'Estadísticas' },
  { ruta: '/avisos', seccion: 'otra', titulo: 'Avisos' },
]
for (const p of PROXIMAS) {
  app.get(p.ruta, async (c) => {
    const [prof, avisos] = await Promise.all([datosProfesional(c), avisosSinLeer(c)])
    return c.html(
      <Pagina titulo={p.titulo} seccion={p.seccion} inst={leerInstalacion(c.env)} email={c.get('email')!} nombre={prof.nombre} avisos={avisos}>
        <section class="portada"><h1>{p.titulo}</h1></section>
        <Tarjeta etiqueta={p.titulo}>
          <p>Esta sección se arma en las próximas etapas, siguiendo la pantalla aprobada.</p>
          <div class="fila"><Boton href="/" variante="borde">Volver a Hoy</Boton></div>
        </Tarjeta>
      </Pagina>
    )
  })
}

// ---------- No encontrado y errores ----------
app.notFound((c) => c.html(
  <Documento titulo="No encontrado" inst={leerInstalacion(c.env)}>
    <main class="acceso"><div class="acceso-caja"><div class="tarjeta">
      <h1>No encontramos esa página</h1>
      <Boton href="/" variante="oscuro">Ir a Hoy</Boton>
    </div></div></main>
  </Documento>, 404))

app.onError((err, c) => {
  // Rechazos esperados (p. ej. un formulario que llega de otro sitio): se responden tal cual, sin la pantalla de error.
  if (err instanceof HTTPException) return err.getResponse()
  console.error(err)
  return c.html(
    <Documento titulo="Algo salió mal" inst={leerInstalacion(c.env)}>
      <main class="acceso"><div class="acceso-caja"><div class="tarjeta">
        <h1>Algo salió mal</h1>
        <p class="suave">Probá de nuevo en un momento. Si se repite, avisale a BC Informática.</p>
        <Boton href="/" variante="oscuro">Ir a Hoy</Boton>
      </div></div></main>
    </Documento>, 500)
})

export default app
