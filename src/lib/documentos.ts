// X3 · PDF con fuente Unicode incrustada y ZIP sin compresión. Sin dependencias de ejecución nuevas.
export class ErrorDocumento extends Error {
  constructor(message: string, public estado: 400 | 404 | 409 | 422 = 422) { super(message) }
}
const utf8 = new TextEncoder()
export const bytesTexto = (s: string) => utf8.encode(s)
export function unir(partes: Uint8Array[]) {
  const salida = new Uint8Array(partes.reduce((n, b) => n + b.length, 0))
  let i = 0; for (const b of partes) { salida.set(b, i); i += b.length }
  return salida
}
export const nombreSeguro = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '').slice(0, 100) || 'archivo'
export async function sha256(bytes: Uint8Array) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer)), b => b.toString(16).padStart(2, '0')).join('')
}
export function texto(form: FormData, nombre: string, max: number, requerido = false) {
  const v = form.get(nombre)
  if (v !== null && typeof v !== 'string') throw new ErrorDocumento('Revisá el formulario.')
  const s = (v ?? '').trim()
  if (s.length > max || (requerido && !s)) throw new ErrorDocumento(`Revisá ${nombre.replaceAll('_', ' ')}: ${s ? 'el texto es demasiado largo' : 'falta completar este dato'}.`)
  return s
}
export function numero(v: unknown) {
  if (typeof v !== 'string' || !/^\d+$/.test(v) || !Number.isSafeInteger(Number(v)) || Number(v) < 1) throw new ErrorDocumento('Revisá el identificador.', 400)
  return Number(v)
}

// TrueType: cmap 4/12 y métricas de avance. Cada carácter usado recibe su CID y su mapa a Unicode.
function leerFuente(bytes: Uint8Array) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tablas: Record<string, number> = {}
  for (let i = 0; i < v.getUint16(4); i++) {
    const p = 12 + i * 16
    tablas[String.fromCharCode(...bytes.slice(p, p + 4))] = v.getUint32(p + 8)
  }
  const cmap = tablas.cmap, unidades = v.getUint16(tablas.head + 18), met = v.getUint16(tablas.hhea + 34)
  let mapa = 0, preferido = 0
  for (let i = 0; i < v.getUint16(cmap + 2); i++) {
    const p = cmap + 4 + i * 8, sub = cmap + v.getUint32(p + 4), formato = v.getUint16(sub)
    const prioridad = formato === 12 ? 2 : formato === 4 ? 1 : 0
    if (prioridad > preferido) { mapa = sub; preferido = prioridad }
  }
  if (!mapa) throw new ErrorDocumento('La fuente del PDF no está disponible.', 409)
  const glifo = (codigo: number) => {
    if (v.getUint16(mapa) === 12) {
      let a = 0, b = v.getUint32(mapa + 12) - 1
      while (a <= b) {
        const m = (a + b) >>> 1, p = mapa + 16 + m * 12, desde = v.getUint32(p), hasta = v.getUint32(p + 4)
        if (codigo < desde) b = m - 1
        else if (codigo > hasta) a = m + 1
        else return v.getUint32(p + 8) + codigo - desde
      }
    } else if (codigo <= 65535) {
      const n = v.getUint16(mapa + 6) / 2
      for (let i = 0; i < n; i++) {
        const fin = v.getUint16(mapa + 14 + i * 2), inicio = v.getUint16(mapa + 16 + n * 2 + i * 2)
        if (codigo < inicio || codigo > fin) continue
        const delta = v.getInt16(mapa + 16 + n * 4 + i * 2), p = mapa + 16 + n * 6 + i * 2, salto = v.getUint16(p)
        const g = salto ? v.getUint16(p + salto + (codigo - inicio) * 2) : codigo
        return g ? (g + delta) & 65535 : 0
      }
    }
    return 0
  }
  const ancho = (g: number) => Math.round(v.getUint16(tablas.hmtx + Math.min(g, met - 1) * 4) * 1000 / unidades)
  const escalar = (p: number) => Math.round(v.getInt16(p) * 1000 / unidades)
  return { glifo, ancho, bbox: [36, 38, 40, 42].map(i => escalar(tablas.head + i)), ascenso: escalar(tablas.hhea + 4), descenso: escalar(tablas.hhea + 6) }
}
export function pdf(lineas: string[], fuente: Uint8Array): Uint8Array {
  const f = leerFuente(fuente), caracteres = new Map<string, { cid: number; glifo: number; ancho: number }>()
  const caracter = (c: string) => {
    if (!caracteres.has(c)) {
      const glifo = f.glifo(c.codePointAt(0)!)
      if (!glifo) throw new ErrorDocumento(`La fuente del PDF no incluye el carácter «${c}». Revisá el texto antes de emitirlo.`)
      caracteres.set(c, { cid: caracteres.size + 1, glifo, ancho: f.ancho(glifo) })
    }
    return caracteres.get(c)!
  }
  const renglones: string[] = []
  for (const linea of lineas) for (const parrafo of linea.normalize('NFC').replace(/\t/g, '    ').split(/\r?\n/)) {
    let renglon = '', ancho = 0
    for (const c of parrafo) {
      const medida = caracter(c).ancho * 11 / 1000
      if (ancho + medida > 491) { renglones.push(renglon); renglon = ''; ancho = 0 }
      renglon += c; ancho += medida
    }
    renglones.push(renglon)
  }
  const paginas = Array.from({ length: Math.max(1, Math.ceil(renglones.length / 44)) }, (_, i) => renglones.slice(i * 44, (i + 1) * 44))
  const hex = (n: number) => n.toString(16).padStart(4, '0')
  const unicode = (s: string) => Array.from({ length: s.length }, (_, i) => hex(s.charCodeAt(i))).join('')
  const objetos: Uint8Array[] = [], agregar = (s: string | Uint8Array) => objetos.push(typeof s === 'string' ? bytesTexto(s) : s)
  const stream = (b: Uint8Array, extra = '') => unir([bytesTexto(`<< /Length ${b.length} ${extra} >>\nstream\n`), b, bytesTexto('\nendstream')])
  agregar('<< /Type /Catalog /Pages 2 0 R >>')
  agregar(`<< /Type /Pages /Count ${paginas.length} /Kids [${paginas.map((_, i) => `${9 + i * 2} 0 R`).join(' ')}] >>`)
  agregar('<< /Type /Font /Subtype /Type0 /BaseFont /DejaVuSans /Encoding /Identity-H /DescendantFonts [4 0 R] /ToUnicode 5 0 R >>')
  agregar(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /DejaVuSans /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 6 0 R /CIDToGIDMap 7 0 R /W [1 [${[...caracteres.values()].map(c => c.ancho).join(' ')}]] >>`)
  const pares = [...caracteres].map(([c, m]) => `<${hex(m.cid)}> <${unicode(c)}>`)
  let mapa = '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /SiroUnicode def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n'
  for (let i = 0; i < pares.length; i += 100) mapa += `${Math.min(100, pares.length - i)} beginbfchar\n${pares.slice(i, i + 100).join('\n')}\nendbfchar\n`
  agregar(stream(bytesTexto(mapa + 'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend')))
  agregar(`<< /Type /FontDescriptor /FontName /DejaVuSans /Flags 32 /FontBBox [${f.bbox.join(' ')}] /ItalicAngle 0 /Ascent ${f.ascenso} /Descent ${f.descenso} /CapHeight ${f.ascenso} /StemV 80 /FontFile2 8 0 R >>`)
  const gids = new Uint8Array((caracteres.size + 1) * 2), vista = new DataView(gids.buffer)
  for (const m of caracteres.values()) vista.setUint16(m.cid * 2, m.glifo)
  agregar(stream(gids)); agregar(stream(fuente, `/Length1 ${fuente.length}`))
  for (const pagina of paginas) {
    const idContenido = objetos.length + 2
    agregar(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${idContenido} 0 R >>`)
    const contenido = `BT /F1 11 Tf 16 TL 52 786 Td\n${pagina.map(l => `<${[...l].map(c => hex(caracter(c).cid)).join('')}> Tj T*`).join('\n')}\nET`
    agregar(stream(bytesTexto(contenido)))
  }
  const partes = [bytesTexto('%PDF-1.7\n')], offsets = [0]
  let largo = partes[0].length
  objetos.forEach((o, i) => { offsets.push(largo); const b = unir([bytesTexto(`${i + 1} 0 obj\n`), o, bytesTexto('\nendobj\n')]); partes.push(b); largo += b.length })
  partes.push(bytesTexto(`xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${largo}\n%%EOF\n`))
  return unir(partes)
}

export type EntradaZip = { nombre: string; cargar: () => Promise<Uint8Array> }
export function crc32(b: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of b) { crc ^= byte; for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0) }
  return (crc ^ 0xffffffff) >>> 0
}
function cabeceraZip(largo: number, campos: [number, number, 2 | 4][]) {
  const b = new Uint8Array(largo), v = new DataView(b.buffer)
  for (const [p, n, ancho] of campos) ancho === 2 ? v.setUint16(p, n, true) : v.setUint32(p, n, true)
  return b
}
/** Se carga un archivo a la vez. Una huella inválida corta el stream: nunca entrega un ZIP válido incompleto. */
export function zip(entradas: EntradaZip[], terminado?: () => Promise<void>) {
  async function* generar() {
    let offset = 0
    const indice: Uint8Array[] = [], huellas: string[] = []
    for (let i = 0; i <= entradas.length; i++) {
      const entrada = entradas[i]
      const nombre = bytesTexto(entrada ? entrada.nombre : 'LEEME.txt')
      const b = entrada ? await entrada.cargar() : bytesTexto('Historia clínica exportada. Contiene datos de salud: guardá este archivo en un lugar seguro.\n\nIncluye documentos y estudios anulados para conservar la historia. Consultá los motivos y fechas en historia.json.\nHuellas SHA-256 de todos los archivos (excepto este LEEME):\n' + huellas.join('\n') + '\n')
      if (entrada) huellas.push(`${await sha256(b)}  ${entrada.nombre}`)
      const crc = crc32(b), local = cabeceraZip(30, [[0,0x04034b50,4],[4,20,2],[6,0x800,2],[12,33,2],[14,crc,4],[18,b.length,4],[22,b.length,4],[26,nombre.length,2]])
      const central = cabeceraZip(46, [[0,0x02014b50,4],[4,20,2],[6,20,2],[8,0x800,2],[14,33,2],[16,crc,4],[20,b.length,4],[24,b.length,4],[28,nombre.length,2],[42,offset,4]])
      indice.push(unir([central, nombre])); yield unir([local, nombre]); yield b
      offset += local.length + nombre.length + b.length
      if (offset > 0xffffffff || indice.length >= 65535) throw new ErrorDocumento('La historia supera el tamaño admitido por ZIP. No se generó un archivo completo.', 409)
    }
    const directorio = unir(indice)
    yield directorio
    yield cabeceraZip(22, [[0,0x06054b50,4],[8,indice.length,2],[10,indice.length,2],[12,directorio.length,4],[16,offset,4]])
    await terminado?.()
  }
  const iterador = generar()
  return new ReadableStream<Uint8Array>({ async pull(c) { try { const r = await iterador.next(); if (r.done) c.close(); else c.enqueue(r.value) } catch (e) { c.error(e) } }, async cancel() { await iterador.return(undefined) } })
}
