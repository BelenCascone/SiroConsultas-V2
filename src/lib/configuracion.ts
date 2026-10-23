// Validación de Configuración. Importes en centavos; horarios locales de Argentina.
export class DatosInvalidos extends Error {}
export const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
export function texto(form: FormData, clave: string, max: number, requerido = false) {
  const valor = form.get(clave)
  if (valor !== null && typeof valor !== 'string') throw new DatosInvalidos('Revisá los datos del formulario.')
  const limpio = (valor ?? '').trim()
  if ((requerido && !limpio) || limpio.length > max) throw new DatosInvalidos(`Revisá ${clave.replaceAll('_', ' ')}: ${requerido ? 'es obligatorio y ' : ''}admite hasta ${max} caracteres.`)
  return limpio
}
export function entero(valor: FormDataEntryValue | null, min: number, max: number) {
  if (typeof valor !== 'string' || !/^\d+$/.test(valor) || Number(valor) < min || Number(valor) > max) throw new DatosInvalidos(`Ingresá un número entero entre ${min} y ${max}.`)
  return Number(valor)
}
export function centavos(valor: string) {
  // El campo no usa separador de miles: admite coma o punto decimal, sin redondear dinero.
  if (!/^\d{1,7}([.,]\d{1,2})?$/.test(valor)) throw new DatosInvalidos('Ingresá el importe sin puntos de miles, con hasta dos decimales.')
  const [pesos, decimales = ''] = valor.replace(',', '.').split('.')
  const total = Number(pesos) * 100 + Number(decimales.padEnd(2, '0'))
  if (total > 100000000) throw new DatosInvalidos('El importe no puede superar $ 1.000.000.')
  return total
}
export type Horario = { dia: number; desde: string; hasta: string }
export function leerHorarios(form: FormData, prefijo: string): Horario[] {
  const horarios: Horario[] = []
  for (let dia = 1; dia <= 7; dia++) {
    if (form.get(`${prefijo}_dia_${dia}`) !== '1') continue
    const desde = form.getAll(`${prefijo}_desde_${dia}`)
    const hasta = form.getAll(`${prefijo}_hasta_${dia}`)
    if (desde.length !== hasta.length || !desde.length || desde.length > 12) throw new DatosInvalidos('Revisá las franjas del día.')
    const franjas: Horario[] = []
    for (let i = 0; i < desde.length; i++) {
      const a = desde[i], b = hasta[i]
      if (a === '' && b === '') continue
      if (typeof a !== 'string' || typeof b !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(a) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(b) || a >= b) throw new DatosInvalidos(`${DIAS[dia - 1]}: completá desde y hasta, con la hora final después de la inicial.`)
      franjas.push({ dia, desde: a, hasta: b })
    }
    if (!franjas.length) throw new DatosInvalidos(`${DIAS[dia - 1]}: agregá al menos un horario o apagá el día.`)
    franjas.sort((a, b) => a.desde.localeCompare(b.desde))
    if (franjas.some((h, i) => i > 0 && h.desde < franjas[i - 1].hasta)) throw new DatosInvalidos(`${DIAS[dia - 1]}: los horarios no pueden superponerse.`)
    horarios.push(...franjas)
  }
  if (!horarios.length) throw new DatosInvalidos('Elegí al menos un día con horario de atención.')
  return horarios
}
export const normalizar = (valor: string) => valor.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('es-AR')

// Solo imágenes raster; no se sirven SVG ni contenido activo como foto del perfil.
export async function leerFoto(archivo: File) {
  if (archivo.size > 5 * 1024 * 1024) throw new DatosInvalidos('La foto puede pesar hasta 5 MB.')
  const bytes = new Uint8Array(await archivo.arrayBuffer())
  const es = (...firma: number[]) => firma.every((b, i) => bytes[i] === b)
  const tipo = es(137, 80, 78, 71, 13, 10, 26, 10) ? 'image/png'
    : es(255, 216, 255) ? 'image/jpeg'
    : es(82, 73, 70, 70) && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP' ? 'image/webp' : null
  if (!tipo || tipo !== archivo.type) throw new DatosInvalidos('Elegí una foto JPG, PNG o WebP válida.')
  return { bytes, tipo }
}
