// Componentes del estilo «Nube». Las clases viven en public/estilos.css; acá no hay estilos en línea (la CSP no los permite).
import type { Child } from 'hono/jsx'
import { Cruz } from './iconos'

type Hijos = { children?: Child }

// ---------- Botones ----------
export type Variante = 'destacado' | 'oscuro' | 'claro' | 'borde' | 'peligro' | 'texto'
type BotonProps = Hijos & {
  variante?: Variante
  href?: string
  type?: 'submit' | 'button'
  ancho?: boolean
  abre?: string        // id de la ventana que abre
  cierra?: boolean     // cierra la ventana en la que está
  name?: string
  value?: string
  'aria-label'?: string
  'data-modulo'?: string
  disabled?: boolean
}

/** Botón en pastilla. «destacado» (lima) va como máximo una vez por pantalla; «oscuro», una por ventana. */
export function Boton({ variante = 'claro', href, type = 'button', ancho, abre, cierra, children, ...resto }: BotonProps) {
  const clase = ['boton', variante !== 'claro' && variante, ancho && 'ancho'].filter(Boolean).join(' ')
  const datos = { 'data-abre': abre, 'data-cierra': cierra ? '' : undefined }
  if (href) return <a class={clase} href={href} {...datos} {...resto}>{children}</a>
  return <button class={clase} type={type} {...datos} {...resto}>{children}</button>
}

// ---------- Tarjetas ----------
export function Tarjeta({ titulo, accion, tono, etiqueta, children }: Hijos & { titulo?: string; accion?: Child; tono?: 'suave' | 'ambar'; etiqueta?: string }) {
  return (
    <section class={['tarjeta', tono].filter(Boolean).join(' ')} aria-label={etiqueta ?? titulo}>
      {(titulo || accion) && (
        <div class="tarjeta-cabeza">
          {titulo && <h2>{titulo}</h2>}
          {accion}
        </div>
      )}
      {children}
    </section>
  )
}

// ---------- Estados ----------
export type EstadoTurno = 'solicitado' | 'confirmado' | 'atendido' | 'ausente' | 'cancelado'
const ESTADOS: Record<string, { clase: string; texto: string }> = {
  solicitado: { clase: 'pedido', texto: 'Pedido online' },
  confirmado: { clase: 'confirmado', texto: 'Confirmado' },
  atendido: { clase: 'atendido', texto: 'Atendido' },
  ausente: { clase: 'ausente', texto: 'Ausente' },
  cancelado: { clase: 'gris', texto: 'Cancelado' },
  sin_respuesta: { clase: 'gris', texto: 'Sin respuesta' },
  debe: { clase: 'debe', texto: 'Te debe' },
  pagado: { clase: 'atendido', texto: 'Pagado' },
  primera: { clase: 'primera', texto: 'Primera consulta' },
  incompleta: { clase: 'debe', texto: 'Ficha incompleta' },
}

/** Marca de estado con el color acordado: atendido verde, te deben ámbar, ausente rojo, sin respuesta gris. */
export function Estado({ estado, texto }: { estado: keyof typeof ESTADOS | string; texto?: string }) {
  const e = ESTADOS[estado] ?? { clase: 'gris', texto: estado }
  return <span class={`estado ${e.clase}`}><span class="punto-estado" aria-hidden="true" />{texto ?? e.texto}</span>
}

// ---------- Pastillas ----------
export function Pastilla({ href, cuenta, actual, alterna, children }: Hijos & { href?: string; cuenta?: number; actual?: boolean; alterna?: boolean }) {
  const contenido = <>{children}{cuenta !== undefined && <span class="cuenta">{cuenta}</span>}</>
  if (href) return <a class="pastilla" href={href} aria-current={actual ? 'true' : undefined}>{contenido}</a>
  return <button type="button" class="pastilla" aria-pressed={actual ? 'true' : 'false'} data-alterna={alterna ? '' : undefined}>{contenido}</button>
}

// ---------- Pasos con bolitas ----------
export function Pasos({ pasos, actual }: { pasos: string[]; actual: number }) {
  return (
    <ol class="pasos" aria-label="Pasos">
      {pasos.map((p, i) => (
        <li aria-current={i === actual ? 'step' : undefined} data-estado={i < actual ? 'hecho' : undefined}>
          <span class="bolita" aria-hidden="true">{i + 1}</span>{p}
          {i < actual && <span class="oculto-visual"> (hecho)</span>}
        </li>
      ))}
    </ol>
  )
}

// ---------- Formularios ----------
type CampoProps = {
  etiqueta: string
  nombre: string
  tipo?: string
  valor?: string
  ayuda?: string
  error?: string
  requerido?: boolean
  autocompletar?: string
  modoTeclado?: 'numeric' | 'tel' | 'email' | 'text'
  multilinea?: boolean
  clase?: string
  autofocus?: boolean
}

export function Campo({ etiqueta, nombre, tipo = 'text', valor, ayuda, error, requerido, autocompletar, modoTeclado, multilinea, clase, autofocus }: CampoProps) {
  const id = `c-${nombre}`
  const describe = [ayuda && `${id}-ayuda`, error && `${id}-error`].filter(Boolean).join(' ') || undefined
  const comunes = {
    id, name: nombre, class: ['entrada', clase].filter(Boolean).join(' '), required: requerido, autocomplete: autocompletar,
    inputmode: modoTeclado, 'aria-describedby': describe, 'aria-invalid': error ? 'true' : undefined, autofocus,
  }
  return (
    <div class="campo">
      <label for={id}>{etiqueta}</label>
      {multilinea ? <textarea {...comunes}>{valor}</textarea> : <input type={tipo} value={valor} {...comunes} />}
      {ayuda && <p id={`${id}-ayuda`} class="ayuda">{ayuda}</p>}
      {error && <p id={`${id}-error`} class="ayuda" role="alert">{error}</p>}
    </div>
  )
}

/** Opciones de a una con aspecto de pastilla (Todo / Una parte / Nada por ahora). */
export function Opciones({ leyenda, nombre, opciones, elegida }: { leyenda: string; nombre: string; opciones: { valor: string; texto: string }[]; elegida?: string }) {
  return (
    <fieldset class="opciones">
      <legend>{leyenda}</legend>
      {opciones.map((o) => (
        <label class="opcion">
          <input type="radio" name={nombre} value={o.valor} checked={o.valor === elegida} />
          <span>{o.texto}</span>
        </label>
      ))}
    </fieldset>
  )
}

export function Interruptor({ etiqueta, nombre, marcado, ayuda }: { etiqueta: string; nombre: string; marcado?: boolean; ayuda?: string }) {
  const id = `i-${nombre}`
  return (
    <div class="interruptor">
      <label for={id}>
        <span class="etiqueta">{etiqueta}</span>
        {ayuda && <span class="ayuda chico suave"><br />{ayuda}</span>}
      </label>
      <input id={id} type="checkbox" role="switch" name={nombre} value="1" checked={marcado} />
    </div>
  )
}

// ---------- Avisos ----------
export function Aviso({ tipo, children }: Hijos & { tipo?: 'error' | 'ok' | 'ambar' }) {
  return <p class={['aviso', tipo].filter(Boolean).join(' ')} role={tipo === 'error' ? 'alert' : 'status'}>{children}</p>
}

// ---------- Ventanas ----------
/** Ventana sobre la pantalla en la que estás (se abre con un Boton abre="id"). Al cerrar, todo queda como estaba. */
export function Ventana({ id, titulo, sub, pie, children }: Hijos & { id: string; titulo: string; sub?: string; pie?: Child }) {
  return (
    <dialog id={id} class="ventana" aria-labelledby={`${id}-titulo`}>
      <div class="ventana-cuerpo">
        <div class="ventana-cabeza">
          <div>
            <h2 id={`${id}-titulo`}>{titulo}</h2>
            {sub && <p class="suave chico">{sub}</p>}
          </div>
          <button type="button" class="redondo" data-cierra="" aria-label="Cerrar"><Cruz /></button>
        </div>
        {children}
        {pie && <div class="ventana-pie">{pie}</div>}
      </div>
    </dialog>
  )
}

/** Importe en centavos → «$ 12.500» (o con decimales si los tiene). */
export function pesos(centavos: number) {
  const entero = Math.trunc(centavos / 100)
  const resto = Math.abs(centavos % 100)
  const base = entero.toLocaleString('es-AR')
  return `$ ${resto ? `${base},${String(resto).padStart(2, '0')}` : base}`
}
