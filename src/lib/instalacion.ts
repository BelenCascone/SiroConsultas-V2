// Una instalación por profesional: su marca y los módulos que contrató.
// Un módulo apagado desaparece del menú y TODAS sus rutas responden 404 en el servidor; sus datos se conservan.

export const MODULOS = ['agenda', 'documentos', 'cobros', 'estadisticas'] as const
export type Modulo = (typeof MODULOS)[number]

/** Rutas de cada módulo. Toda ruta nueva de un módulo se registra acá. */
export const PREFIJOS: Record<Modulo, string[]> = {
  agenda: ['/agenda', '/turnos', '/bloqueos', '/pedidos'],
  documentos: ['/documentos'],
  cobros: ['/cobros', '/pagos', '/comprobantes', '/contadora', '/configuracion/cobros'],
  estadisticas: ['/estadisticas'],
}

export type Instalacion = { marca: string; modulos: Set<Modulo> }

export function leerInstalacion(env: { MARCA?: string; MODULOS?: string }): Instalacion {
  const marca = String(env.MARCA ?? '').replace(/[^\p{L}\p{N} .'-]/gu, '').trim().slice(0, 40)
  const pedidos = String(env.MODULOS ?? '').split(',').map((s) => s.trim().toLowerCase())
  return { marca, modulos: new Set(MODULOS.filter((m) => pedidos.includes(m))) }
}

/** Módulo al que pertenece una ruta, o null si es del núcleo. */
export function moduloDe(ruta: string): Modulo | null {
  const coincide = (p: string) => ruta === p || ruta.startsWith(p + '/') || ruta.startsWith(p + '?')
  for (const m of MODULOS) if (PREFIJOS[m].some(coincide)) return m
  return null
}

export const habilitado = (inst: Instalacion, m: Modulo) => inst.modulos.has(m)
