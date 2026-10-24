// Armazón de las páginas: documento HTML, cabecera con el menú en pastilla, campanita y foto.
import type { Child } from 'hono/jsx'
import { raw } from 'hono/html'
import type { Instalacion, Modulo } from '../lib/instalacion'
import { Campana } from './iconos'

/** Sube con cada cambio de estilos.css o app.js para que el navegador no use la copia vieja. */
export const VERSION_ESTATICOS = '2.0.0-p3'

export type Seccion = 'hoy' | 'agenda' | 'pacientes' | 'cobros' | 'estadisticas' | 'configuracion' | 'otra'

const MENU: { id: Seccion; texto: string; href: string; modulo?: Modulo }[] = [
  { id: 'hoy', texto: 'Hoy', href: '/' },
  { id: 'agenda', texto: 'Agenda', href: '/agenda', modulo: 'agenda' },
  { id: 'pacientes', texto: 'Pacientes', href: '/pacientes' },
  { id: 'cobros', texto: 'Cobros', href: '/cobros', modulo: 'cobros' },
  { id: 'estadisticas', texto: 'Estadísticas', href: '/estadisticas', modulo: 'estadisticas' },
]

export function Documento({ titulo, inst, children }: { titulo: string; inst: Instalacion; children: Child }) {
  const marca = inst.marca ? ` ${inst.marca}` : ''
  return (
    <>
      {raw('<!doctype html>')}
      <html lang="es-AR">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <meta name="robots" content="noindex, nofollow" />
          <link rel="icon" href="data:," />
          <title>{`${titulo} · SiroConsultas${marca}`}</title>
          <link rel="preload" href="/fuentes/plus-jakarta-sans-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin="" />
          <link rel="stylesheet" href={`/estilos.css?v=${VERSION_ESTATICOS}`} />
          <script src={`/app.js?v=${VERSION_ESTATICOS}`} defer></script>
        </head>
        <body>{children}</body>
      </html>
    </>
  )
}

export const iniciales = (nombre: string | null | undefined, email: string) => {
  const palabras = (nombre ?? '').trim().split(/\s+/).filter(Boolean)
  if (palabras.length >= 2) return (palabras[0][0] + palabras[palabras.length - 1][0]).toUpperCase()
  if (palabras.length === 1) return palabras[0].slice(0, 2).toUpperCase()
  return email.slice(0, 2).toUpperCase()
}

type PaginaProps = {
  titulo: string
  seccion: Seccion
  inst: Instalacion
  email: string
  nombre?: string | null
  avisos?: number
  children: Child
}

/** Página de la app con la cabecera «Nube». Los módulos apagados no aparecen en el menú. */
export function Pagina({ titulo, seccion, inst, email, nombre, avisos = 0, children }: PaginaProps) {
  const items = MENU.filter((m) => !m.modulo || inst.modulos.has(m.modulo))
  return (
    <Documento titulo={titulo} inst={inst}>
      <a class="saltar" href="#principal">Saltar al contenido</a>
      <div class="pagina">
        <header class="cabecera">
          <a class="logo" href="/" aria-label="SiroConsultas, ir a Hoy">
            <span class="logo-punto" aria-hidden="true" />
            <span class="logo-nombre">SiroConsultas</span>
            {inst.marca && <span class="logo-marca">{inst.marca}</span>}
          </a>
          <nav class="menu" aria-label="Menú principal">
            {items.map((m) => (
              <a href={m.href} aria-current={m.id === seccion ? 'page' : undefined} data-modulo={m.modulo}>{m.texto}</a>
            ))}
          </nav>
          <div class="cabecera-derecha">
            <a class="redondo" href="/avisos" aria-label={avisos ? `Avisos: ${avisos} nuevos` : 'Avisos'} title="Avisos">
              <Campana />
              {avisos > 0 && <span class="punto" aria-hidden="true" />}
            </a>
            <a class="redondo avatar" href="/configuracion" aria-label="Configuración" title="Configuración">{iniciales(nombre, email)}</a>
          </div>
        </header>
        <main id="principal" class="columna entra">{children}</main>
      </div>
    </Documento>
  )
}

/** Pantallas de ingreso: una caja centrada, sin menú. */
export function Acceso({ titulo, sub, inst, children }: { titulo: string; sub?: string; inst: Instalacion; children: Child }) {
  return (
    <Documento titulo={titulo} inst={inst}>
      <main class="acceso">
        <div class="acceso-caja entra">
          <span class="logo">
            <span class="logo-punto" aria-hidden="true" />
            <span class="logo-nombre">SiroConsultas</span>
            {inst.marca && <span class="logo-marca">{inst.marca}</span>}
          </span>
          <div class="columna">
            <h1>{titulo}</h1>
            {sub && <p class="portada-sub">{sub}</p>}
          </div>
          <div class="tarjeta">{children}</div>
        </div>
      </main>
    </Documento>
  )
}
