// P5 · «Enviar a la contadora»: período, totales y la planilla .xlsx (Cobros, Pagos, Comprobantes). Sin datos clínicos.
import { MESES, esFecha, sumarDias } from './fechas'
import { crc32 } from './documentos'
import { numeroTexto } from './comprobantes'

export type Periodo = { clave: 'mes' | 'anterior' | 'trimestre' | 'fechas'; desde: string; hasta: string; nombre: string; titulo: string }
export const MAX_DIAS = 366

const ultimoDia = (anio: number, mes: number) => new Date(Date.UTC(anio, mes, 0)).getUTCDate()
const iso = (anio: number, mes: number, dia: number) => `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
const mayuscula = (s: string) => s[0].toUpperCase() + s.slice(1)
export const fechaCorta = (f: string) => `${Number(f.slice(8, 10))}/${Number(f.slice(5, 7))}`
const ORDINAL = ['Primer', 'Segundo', 'Tercer', 'Cuarto']

/** Las cuatro pastillas: este mes, el anterior, el último trimestre cerrado y «Elegir fechas». */
export function periodos(hoy: string, desde?: string, hasta?: string): Periodo[] {
  const anio = Number(hoy.slice(0, 4)), mes = Number(hoy.slice(5, 7))
  const mesDe = (a: number, m: number, clave: 'mes' | 'anterior'): Periodo => ({
    clave, desde: iso(a, m, 1), hasta: iso(a, m, ultimoDia(a, m)), nombre: MESES[m - 1], titulo: mayuscula(MESES[m - 1]),
  })
  const anterior = mes === 1 ? mesDe(anio - 1, 12, 'anterior') : mesDe(anio, mes - 1, 'anterior')
  const q = Math.floor((mes - 1) / 3), qa = q === 0 ? 3 : q - 1, aq = q === 0 ? anio - 1 : anio
  const trimestre: Periodo = {
    clave: 'trimestre', desde: iso(aq, qa * 3 + 1, 1), hasta: iso(aq, qa * 3 + 3, ultimoDia(aq, qa * 3 + 3)),
    nombre: `el ${ORDINAL[qa].toLowerCase()} trimestre`, titulo: `${ORDINAL[qa]} trimestre`,
  }
  const d = desde && esFecha(desde) ? desde : iso(anio, mes, 1), h = hasta && esFecha(hasta) ? hasta : hoy
  const fechas: Periodo = { clave: 'fechas', desde: d, hasta: h, nombre: `del ${fechaCorta(d)} al ${fechaCorta(h)}`, titulo: 'Elegir fechas' }
  return [mesDe(anio, mes, 'mes'), anterior, trimestre, fechas]
}

/** El período pedido por la dirección, o el error para mostrar. */
export function elegirPeriodo(hoy: string, q: { periodo?: string; desde?: string; hasta?: string }): { periodo: Periodo; error?: string } {
  const lista = periodos(hoy, q.desde, q.hasta)
  const p = lista.find((x) => x.clave === q.periodo) ?? lista[0]
  if (p.clave !== 'fechas') return { periodo: p }
  if (!q.desde || !q.hasta || !esFecha(q.desde) || !esFecha(q.hasta)) return { periodo: p, error: 'Elegí las dos fechas.' }
  if (q.desde > q.hasta) return { periodo: p, error: 'La fecha «Desde» tiene que ser anterior a «Hasta».' }
  if (sumarDias(q.desde, MAX_DIAS) <= q.hasta) return { periodo: p, error: 'Elegí hasta un año por envío.' }
  return { periodo: p }
}

export type Totales = { cobrado: number; pagos: number; facturado: number; facturas: number; sin_factura: number; internos: number }

export async function totales(db: D1Database, desde: string, hasta: string): Promise<Totales> {
  type Suma = { total: number; n: number }
  const [pr, fr, ir] = await Promise.all([
    db.prepare('SELECT COALESCE(SUM(importe), 0) total, COUNT(*) n FROM pagos WHERE anulado_en IS NULL AND fecha BETWEEN ? AND ?').bind(desde, hasta).first<Suma>(),
    // Facturado neto: las facturas C emitidas menos sus notas de crédito.
    db.prepare(`SELECT COALESCE(SUM(CASE tipo WHEN 'factura_c' THEN importe ELSE -importe END), 0) total, COUNT(CASE tipo WHEN 'factura_c' THEN 1 END) n
                  FROM comprobantes WHERE tipo IN ('factura_c', 'nota_credito_c') AND estado = 'emitido' AND fecha BETWEEN ? AND ?`).bind(desde, hasta).first<Suma>(),
    db.prepare("SELECT COUNT(*) n FROM comprobantes WHERE tipo = 'interno' AND estado = 'emitido' AND fecha BETWEEN ? AND ?").bind(desde, hasta).first<{ n: number }>(),
  ]).then((r) => r.map((x) => x!) as [Suma, Suma, { n: number }])
  return { cobrado: pr.total, pagos: pr.n, facturado: fr.total, facturas: fr.n, sin_factura: Math.max(0, pr.total - fr.total), internos: ir.n }
}

// ---------- Planilla ----------
export type Celda = string | number | null
export type Hoja = { nombre: string; columnas: { titulo: string; ancho: number; plata?: boolean }[]; filas: Celda[][] }

const COBERTURA: Record<string, string> = { particular: 'Particular', obra_social: 'Obra social' }
const ESTADO_COBRO: Record<string, string> = { anulado: 'Anulado', perdonado: 'Perdonado', sin_cargo: 'Sin cargo', pagado: 'Pagado', parcial: 'Pagó una parte', debe: 'Debe' }
const MEDIO: Record<string, string> = { efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta', otro: 'Otro' }
const TIPO_COMP: Record<string, string> = { interno: 'Comprobante interno', factura_c: 'Factura C', nota_credito_c: 'Nota de crédito C' }
const ESTADO_COMP: Record<string, string> = { emitido: 'Emitido', pendiente: 'Pendiente', anulado: 'Anulado' }
const plata = (c: number) => c / 100

export async function hojas(db: D1Database, desde: string, hasta: string): Promise<Hoja[]> {
  const [cobros, pagos, comps] = await Promise.all([
    db.prepare(`SELECT c.fecha, p.apellido || ', ' || p.nombre paciente, p.dni, c.concepto, c.cobertura, o.nombre obra, c.importe, c.pagado, c.saldo, c.estado,
                       COALESCE(c.anulado_motivo, c.perdonado_motivo) motivo
                  FROM v_cobros c JOIN pacientes p ON p.id = c.paciente_id LEFT JOIN obras_sociales o ON o.id = c.obra_social_id
                 WHERE c.fecha BETWEEN ? AND ? ORDER BY c.fecha, c.id`).bind(desde, hasta).all(),
    db.prepare(`SELECT g.fecha, p.apellido || ', ' || p.nombre paciente, p.dni, c.concepto, g.medio, g.importe, g.anulado_motivo,
                       (SELECT tipo || ':' || COALESCE(punto_venta, '') || ':' || COALESCE(numero, '') FROM comprobantes k WHERE k.pago_id = g.id AND k.tipo IN ('interno', 'factura_c')) comprobante
                  FROM pagos g JOIN cobros c ON c.id = g.cobro_id JOIN pacientes p ON p.id = c.paciente_id
                 WHERE g.fecha BETWEEN ? AND ? ORDER BY g.fecha, g.id`).bind(desde, hasta).all(),
    db.prepare(`SELECT fecha, tipo, punto_venta, numero, receptor_nombre, receptor_doc_tipo, receptor_doc, importe, cae, cae_vence, estado, anulado_motivo
                  FROM comprobantes WHERE fecha BETWEEN ? AND ? ORDER BY fecha, id`).bind(desde, hasta).all(),
  ])
  type C = { fecha: string; paciente: string; dni: string; concepto: string; cobertura: string; obra: string | null; importe: number; pagado: number; saldo: number; estado: string; motivo: string | null }
  type P = { fecha: string; paciente: string; dni: string; concepto: string; medio: string; importe: number; anulado_motivo: string | null; comprobante: string | null }
  type K = { fecha: string; tipo: string; punto_venta: number | null; numero: number | null; receptor_nombre: string; receptor_doc_tipo: string; receptor_doc: string; importe: number; cae: string | null; cae_vence: string | null; estado: string; anulado_motivo: string | null }
  const numero = (tipo: string, pv: number | null, n: number | null) =>
    n === null ? 'Sin número' : tipo === 'interno' ? numeroTexto(n) : `${String(pv ?? 0).padStart(5, '0')}-${String(n).padStart(8, '0')}`
  return [
    {
      nombre: 'Cobros',
      columnas: [{ titulo: 'Fecha', ancho: 12 }, { titulo: 'Paciente', ancho: 28 }, { titulo: 'DNI', ancho: 12 }, { titulo: 'Prestación', ancho: 26 }, { titulo: 'Cobertura', ancho: 13 },
        { titulo: 'Obra social', ancho: 20 }, { titulo: 'Importe', ancho: 13, plata: true }, { titulo: 'Pagado', ancho: 13, plata: true }, { titulo: 'Saldo', ancho: 13, plata: true },
        { titulo: 'Estado', ancho: 15 }, { titulo: 'Motivo (anulado o perdonado)', ancho: 30 }],
      filas: (cobros.results as C[]).map((r) => [r.fecha, r.paciente, r.dni, r.concepto, COBERTURA[r.cobertura] ?? r.cobertura, r.obra, plata(r.importe), plata(r.pagado), plata(r.saldo), ESTADO_COBRO[r.estado] ?? r.estado, r.motivo]),
    },
    {
      nombre: 'Pagos',
      columnas: [{ titulo: 'Fecha', ancho: 12 }, { titulo: 'Paciente', ancho: 28 }, { titulo: 'DNI', ancho: 12 }, { titulo: 'Concepto', ancho: 26 }, { titulo: 'Medio', ancho: 15 },
        { titulo: 'Importe', ancho: 13, plata: true }, { titulo: 'Comprobante', ancho: 26 }, { titulo: 'Estado', ancho: 11 }, { titulo: 'Motivo de anulación', ancho: 30 }],
      filas: (pagos.results as P[]).map((r) => {
        const [tipo, pv, n] = r.comprobante?.split(':') ?? []
        const comp = tipo ? `${TIPO_COMP[tipo] ?? tipo} ${numero(tipo, pv ? Number(pv) : null, n ? Number(n) : null)}` : 'Sin comprobante'
        return [r.fecha, r.paciente, r.dni, r.concepto, MEDIO[r.medio] ?? r.medio, plata(r.importe), comp, r.anulado_motivo ? 'Anulado' : 'Vigente', r.anulado_motivo]
      }),
    },
    {
      nombre: 'Comprobantes',
      columnas: [{ titulo: 'Fecha', ancho: 12 }, { titulo: 'Tipo', ancho: 22 }, { titulo: 'Número', ancho: 16 }, { titulo: 'Receptor', ancho: 28 }, { titulo: 'Documento', ancho: 18 },
        { titulo: 'Importe', ancho: 13, plata: true }, { titulo: 'CAE', ancho: 16 }, { titulo: 'Vence CAE', ancho: 12 }, { titulo: 'Estado', ancho: 11 }, { titulo: 'Motivo de anulación', ancho: 30 }],
      filas: (comps.results as K[]).map((r) => [r.fecha, TIPO_COMP[r.tipo] ?? r.tipo, numero(r.tipo, r.punto_venta, r.numero), r.receptor_nombre, `${r.receptor_doc_tipo.toUpperCase()} ${r.receptor_doc}`,
        plata(r.importe), r.cae, r.cae_vence, ESTADO_COMP[r.estado] ?? r.estado, r.anulado_motivo]),
    },
  ]
}

const xml = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const columna = (i: number) => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s }
// Excel ejecuta las celdas que empiezan con «=», «+», «-» o «@»: se guardan como texto con un apóstrofo delante.
const textoSeguro = (s: string) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s)

function hojaXml(h: Hoja) {
  const fila = (r: number, celdas: Celda[], estilo: (i: number) => number) =>
    `<row r="${r}">${celdas.map((v, i) => {
      const ref = `${columna(i)}${r}`, s = estilo(i)
      if (v === null || v === '') return `<c r="${ref}" s="${s}"/>`
      if (typeof v === 'number') return `<c r="${ref}" s="${s}"><v>${Number.isFinite(v) ? v : 0}</v></c>`
      return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xml(textoSeguro(v))}</t></is></c>`
    }).join('')}</row>`
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    + `<cols>${h.columnas.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.ancho}" customWidth="1"/>`).join('')}</cols>`
    + `<sheetData>${fila(1, h.columnas.map((c) => c.titulo), () => 1)}${h.filas.map((f, j) => fila(j + 2, f, (i) => (h.columnas[i]?.plata ? 2 : 0))).join('')}</sheetData>`
    + '</worksheet>'
}

/** Arma el .xlsx (un ZIP sin comprimir con sus XML). Sin dependencias. */
export function planilla(lista: Hoja[]): Uint8Array {
  const archivos: [string, string][] = [
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + lista.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
      + '</Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
      + lista.map((h, i) => `<sheet name="${xml(h.nombre)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + lista.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
      + `<Relationship Id="rId${lista.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    // Estilos: 0 normal, 1 encabezado en negrita, 2 importe con miles y dos decimales.
    ['xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>'
      + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
      + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
      + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
      + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
      + '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
      + '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>'],
    ...lista.map((h, i): [string, string] => [`xl/worksheets/sheet${i + 1}.xml`, hojaXml(h)]),
  ]
  return zipGuardado(archivos.map(([n, t]) => [n, new TextEncoder().encode(t)]))
}

function zipGuardado(archivos: [string, Uint8Array][]) {
  const enc = new TextEncoder(), partes: Uint8Array[] = [], centrales: Uint8Array[] = []
  let offset = 0
  const cabecera = (largo: number, campos: [number, number, 2 | 4][]) => {
    const b = new Uint8Array(largo), v = new DataView(b.buffer)
    for (const [p, n, ancho] of campos) ancho === 2 ? v.setUint16(p, n, true) : v.setUint32(p, n, true)
    return b
  }
  // Fecha DOS fija (1/1/2026): la planilla del mismo período sale siempre igual.
  const fecha = ((2026 - 1980) << 9) | (1 << 5) | 1
  for (const [nombre, datos] of archivos) {
    const n = enc.encode(nombre), crc = crc32(datos)
    const local = cabecera(30, [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x800, 2], [12, fecha, 2], [14, crc, 4], [18, datos.length, 4], [22, datos.length, 4], [26, n.length, 2]])
    centrales.push(cabecera(46, [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x800, 2], [14, fecha, 2], [16, crc, 4], [20, datos.length, 4], [24, datos.length, 4], [28, n.length, 2], [42, offset, 4]]), n)
    partes.push(local, n, datos)
    offset += local.length + n.length + datos.length
  }
  const largoCentral = centrales.reduce((s, b) => s + b.length, 0)
  const fin = cabecera(22, [[0, 0x06054b50, 4], [8, archivos.length, 2], [10, archivos.length, 2], [12, largoCentral, 4], [16, offset, 4]])
  const todo = [...partes, ...centrales, fin], salida = new Uint8Array(todo.reduce((s, b) => s + b.length, 0))
  let p = 0
  for (const b of todo) { salida.set(b, p); p += b.length }
  return salida
}

export const nombrePlanilla = (desde: string, hasta: string) => `cobros_${desde}_a_${hasta}.xlsx`
export const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
