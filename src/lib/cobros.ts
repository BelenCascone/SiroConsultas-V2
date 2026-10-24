// P4 · Cobros y pagos. La app no mueve plata: la profesional registra lo que cobró.
// Particular: el importe sale de la prestación. Obra social: el importe es el copago (puede ser 0). Importe 0 = «Sin cargo».
// «Cobrado» = pagos vigentes. «Te deben» = saldo de los cobros vigentes y lo atendido que todavía no tiene cobro.

export const MEDIOS = [
  { valor: 'efectivo', texto: 'Efectivo' },
  { valor: 'transferencia', texto: 'Transferencia' },
  { valor: 'tarjeta', texto: 'Tarjeta' },
  { valor: 'otro', texto: 'Otro' },
] as const
export type Medio = (typeof MEDIOS)[number]['valor']
export const textoMedio = (m: string) => MEDIOS.find((x) => x.valor === m)?.texto ?? m

/** Importe escrito por una persona → centavos. Acepta «18000», «18.000», «18.000,50», «$ 18000,5» y «18000.50». Null si no se entiende. */
export function leerImporte(v: unknown): number | null {
  if (typeof v !== 'string') return null
  let s = v.replace(/\$|\s/g, '')
  if (!s) return null
  if (!/^[\d.,]+$/.test(s)) return null
  if (s.includes(',')) {
    // coma decimal; los puntos son de miles
    if ((s.match(/,/g) ?? []).length > 1) return null
    s = s.replace(/\./g, '').replace(',', '.')
  } else if (s.includes('.')) {
    const partes = s.split('.')
    const ultima = partes[partes.length - 1]
    // un solo punto con 1 o 2 cifras después es decimal; si no, son puntos de miles
    s = partes.length === 2 && ultima.length <= 2 ? s : partes.every((p, i) => i === 0 ? p.length >= 1 && p.length <= 3 : p.length === 3) ? partes.join('') : '#'
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null
  const [entero, dec = ''] = s.split('.')
  const total = Number(entero) * 100 + Number(dec.padEnd(2, '0'))
  return total <= 100000000 ? total : null
}

/** Centavos → texto para un campo («18000» o «18000,50»). */
export const importeCampo = (c: number) => (c % 100 ? `${Math.trunc(c / 100)},${String(c % 100).padStart(2, '0')}` : String(c / 100))

// ---------- Lo que hay para cobrar ----------
export type ParaCobrar = {
  tipo: 'turno' | 'cobro'
  id: number                   // turno_id o cobro_id
  paciente_id: number
  nombre: string
  apellido: string
  fecha: string
  hora: string | null
  concepto: string
  cobertura: string
  obra_social: string | null
  importe: number | null       // importe del cobro (null si todavía no hay cobro)
  saldo: number                // lo que falta (para un turno sin cobro: el sugerido)
  pagado: number
  origen: string
}

/** Turnos atendidos sin cobro vigente y cobros con saldo, de un paciente o de todos. */
export async function pendientesDeCobro(db: D1Database, pacienteId?: number): Promise<ParaCobrar[]> {
  const filtroP = pacienteId ? 'AND p.id = ?' : ''
  const args = pacienteId ? [pacienteId] : []
  const [turnos, cobros] = await Promise.all([
    db.prepare(
      `SELECT t.id, t.paciente_id, p.nombre, p.apellido, t.fecha, t.hora, COALESCE(pr.nombre, 'Consulta') concepto, t.cobertura, os.nombre obra_social,
              CASE WHEN t.cobertura = 'obra_social' THEN 0 ELSE COALESCE(pr.importe, 0) END sugerido
         FROM turnos t JOIN pacientes p ON p.id = t.paciente_id
         LEFT JOIN prestaciones pr ON pr.id = t.prestacion_id LEFT JOIN obras_sociales os ON os.id = t.obra_social_id
        WHERE t.estado = 'atendido' ${filtroP}
          AND NOT EXISTS (SELECT 1 FROM cobros cb WHERE cb.turno_id = t.id AND cb.anulado_en IS NULL)
        ORDER BY t.fecha DESC, t.hora DESC LIMIT 200`
    ).bind(...args).all<{ id: number; paciente_id: number; nombre: string; apellido: string; fecha: string; hora: string; concepto: string; cobertura: string; obra_social: string | null; sugerido: number }>(),
    db.prepare(
      `SELECT vc.id, vc.paciente_id, p.nombre, p.apellido, vc.fecha, t.hora, vc.concepto, vc.cobertura, os.nombre obra_social, vc.importe, vc.saldo, vc.pagado, vc.origen
         FROM v_cobros vc JOIN pacientes p ON p.id = vc.paciente_id LEFT JOIN turnos t ON t.id = vc.turno_id
         LEFT JOIN obras_sociales os ON os.id = vc.obra_social_id
        WHERE vc.saldo > 0 ${filtroP} ORDER BY vc.fecha DESC, vc.id DESC LIMIT 200`
    ).bind(...args).all<{ id: number; paciente_id: number; nombre: string; apellido: string; fecha: string; hora: string | null; concepto: string; cobertura: string; obra_social: string | null; importe: number; saldo: number; pagado: number; origen: string }>(),
  ])
  return [
    ...(turnos.results ?? []).map((t) => ({ tipo: 'turno' as const, id: t.id, paciente_id: t.paciente_id, nombre: t.nombre, apellido: t.apellido, fecha: t.fecha, hora: t.hora,
      concepto: t.concepto, cobertura: t.cobertura, obra_social: t.obra_social, importe: null, saldo: t.sugerido, pagado: 0, origen: 'atencion' })),
    ...(cobros.results ?? []).map((x) => ({ tipo: 'cobro' as const, ...x })),
  ].sort((a, b) => `${b.fecha} ${b.hora ?? ''}`.localeCompare(`${a.fecha} ${a.hora ?? ''}`))
}

/** Cobrado (pagos vigentes) en una fecha y lo que te deben en total (saldos y lo atendido sin cobrar, a precio de la prestación). */
export async function plataDeHoy(db: D1Database, hoy: string) {
  const [cobrado, debe] = await Promise.all([
    db.prepare('SELECT COALESCE(SUM(importe), 0) n, COUNT(*) pagos FROM pagos WHERE fecha = ? AND anulado_en IS NULL').bind(hoy).first<{ n: number; pagos: number }>(),
    db.prepare(
      `SELECT COALESCE((SELECT SUM(saldo) FROM v_cobros), 0)
            + COALESCE((SELECT SUM(CASE WHEN t.cobertura = 'obra_social' THEN 0 ELSE COALESCE(pr.importe, 0) END) FROM turnos t
                 LEFT JOIN prestaciones pr ON pr.id = t.prestacion_id
                WHERE t.estado = 'atendido' AND NOT EXISTS (SELECT 1 FROM cobros cb WHERE cb.turno_id = t.id AND cb.anulado_en IS NULL)), 0) n`
    ).first<{ n: number }>(),
  ])
  return { cobrado: cobrado?.n ?? 0, pagos: cobrado?.pagos ?? 0, teDeben: debe?.n ?? 0 }
}

// ---------- Guardar ----------
export type Cuanto = 'todo' | 'parte' | 'nada'
export class ErrorCobro extends Error {}

type Origen =
  | { tipo: 'turno'; turnoId: number }
  | { tipo: 'cobro'; cobroId: number }
  | { tipo: 'libre'; pacienteId: number; prestacionId: number | null; concepto: string }

export type Pedido = { origen: Origen; importe: number | null; cuanto: Cuanto; parte: number | null; medio: string; clave: string; hoy: string }
export type Resultado = { cobroId: number; pagoId: number | null; sinCargo: boolean; repetido?: boolean }

/** Crea el cobro (si hace falta) y el pago, juntos: o entran los dos o ninguno. El mismo `clave` no paga dos veces. */
export async function guardarCobro(db: D1Database, p: Pedido): Promise<Resultado> {
  if (!/^[a-zA-Z0-9-]{8,64}$/.test(p.clave)) throw new ErrorCobro('Volvé a abrir el cobro: faltan datos del formulario.')
  const previo = await db.prepare('SELECT id, cobro_id FROM pagos WHERE clave_unica = ?').bind(p.clave).first<{ id: number; cobro_id: number }>()
  if (previo) return { cobroId: previo.cobro_id, pagoId: previo.id, sinCargo: false, repetido: true }
  if (!MEDIOS.some((m) => m.valor === p.medio) && p.cuanto !== 'nada') throw new ErrorCobro('Elegí cómo pagó.')

  // 1) El cobro: existente, del turno o libre.
  let cobro: { id: number; importe: number; saldo: number } | null = null
  let nuevo: D1PreparedStatement | null = null
  if (p.origen.tipo === 'cobro') {
    cobro = await db.prepare('SELECT id, importe, saldo FROM v_cobros WHERE id = ? AND estado IN (\'debe\', \'parcial\')').bind(p.origen.cobroId).first()
    if (!cobro) throw new ErrorCobro('Ese cobro ya no tiene saldo.')
  } else {
    if (p.importe === null) throw new ErrorCobro('Escribí el importe (puede ser 0).')
    if (p.origen.tipo === 'turno') {
      const t = await db.prepare(
        `SELECT t.id, t.paciente_id, t.fecha, t.prestacion_id, t.consultorio_id, t.cobertura, t.obra_social_id, t.estado, COALESCE(pr.nombre, 'Consulta') concepto,
                EXISTS (SELECT 1 FROM cobros cb WHERE cb.turno_id = t.id AND cb.anulado_en IS NULL) con_cobro
           FROM turnos t LEFT JOIN prestaciones pr ON pr.id = t.prestacion_id WHERE t.id = ?`
      ).bind(p.origen.turnoId).first<{ id: number; paciente_id: number; fecha: string; prestacion_id: number | null; consultorio_id: number; cobertura: string; obra_social_id: number | null; estado: string; concepto: string; con_cobro: number }>()
      if (!t || t.estado !== 'atendido') throw new ErrorCobro('Ese turno no está atendido.')
      if (t.con_cobro) throw new ErrorCobro('Ese turno ya tiene su cobro.')
      nuevo = db.prepare(
        `INSERT INTO cobros (paciente_id, turno_id, prestacion_id, consultorio_id, cobertura, obra_social_id, concepto, importe, fecha) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
      ).bind(t.paciente_id, t.id, t.prestacion_id, t.consultorio_id, t.cobertura, t.obra_social_id, t.concepto, p.importe, t.fecha)
    } else {
      const concepto = p.origen.concepto.trim().slice(0, 120)
      if (!concepto) throw new ErrorCobro('Escribí el concepto.')
      const pac = await db.prepare('SELECT cobertura, obra_social_id, consultorio_id FROM pacientes WHERE id = ? AND baja_en IS NULL').bind(p.origen.pacienteId)
        .first<{ cobertura: string | null; obra_social_id: number | null; consultorio_id: number | null }>()
      if (!pac) throw new ErrorCobro('Ese paciente no está activo.')
      const os = pac.cobertura === 'obra_social' && pac.obra_social_id
      nuevo = db.prepare(
        `INSERT INTO cobros (paciente_id, prestacion_id, consultorio_id, cobertura, obra_social_id, concepto, importe, fecha) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
      ).bind(p.origen.pacienteId, p.origen.prestacionId, pac.consultorio_id, os ? 'obra_social' : 'particular', os ? pac.obra_social_id : null, concepto, p.importe, p.hoy)
    }
  }

  // 2) El pago.
  const total = cobro ? cobro.saldo : p.importe!
  const sinCargo = !cobro && total === 0
  const monto = sinCargo || p.cuanto === 'nada' ? 0 : p.cuanto === 'todo' ? total : p.parte ?? 0
  if (!sinCargo && p.cuanto === 'parte' && (monto <= 0 || monto >= total)) throw new ErrorCobro('Una parte va entre $ 1 y menos que el total.')
  const pago = monto > 0
    ? db.prepare(`INSERT INTO pagos (cobro_id, importe, medio, fecha, clave_unica) VALUES (${cobro ? '?' : 'last_insert_rowid()'}, ?, ?, ?, ?)`)
      .bind(...(cobro ? [cobro.id] : []), monto, p.medio, p.hoy, p.clave)
    : null
  try {
    if (!pago) {
      // Sin pago: «Sin cargo» o «Nada por ahora» (queda en «Te deben»). Solo se crea el cobro.
      if (!nuevo) throw new ErrorCobro('Elegí cuánto pagó.')
      const fila = await nuevo.first<{ id: number }>()
      return { cobroId: fila!.id, pagoId: null, sinCargo }
    }
    await db.batch(nuevo ? [nuevo, pago] : [pago])
    // El pago se busca por su clave: así no depende de cómo devuelve las filas el lote.
    const fila = await db.prepare('SELECT id, cobro_id FROM pagos WHERE clave_unica = ?').bind(p.clave).first<{ id: number; cobro_id: number }>()
    if (!fila) throw new ErrorCobro('No se pudo guardar el pago.')
    return { cobroId: fila.cobro_id, pagoId: fila.id, sinCargo: false }
  } catch (e) {
    const msj = (e as Error).message
    // el doble clic que llegó primero ya lo guardó
    const ya = await db.prepare('SELECT id, cobro_id FROM pagos WHERE clave_unica = ?').bind(p.clave).first<{ id: number; cobro_id: number }>()
    if (ya) return { cobroId: ya.cobro_id, pagoId: ya.id, sinCargo: false, repetido: true }
    if (/supera el saldo/.test(msj)) throw new ErrorCobro('El pago supera lo que falta pagar.')
    if (/UNIQUE/.test(msj)) throw new ErrorCobro('Ese turno ya tiene su cobro.')
    if (/dado de baja/.test(msj)) throw new ErrorCobro('Ese paciente está dado de baja.')
    throw e
  }
}

// ---------- Anular ----------
export const MOTIVO_MAX = 200
export function leerMotivo(v: unknown) {
  const m = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : ''
  if (!m) throw new ErrorCobro('Escribí el motivo.')
  if (m.length > MOTIVO_MAX) throw new ErrorCobro(`El motivo va hasta ${MOTIVO_MAX} caracteres.`)
  return m
}

/** Anula un pago con motivo y, en el mismo lote, su comprobante interno. Una factura C se compensa con nota de crédito (etapa 4). */
export async function anularPago(db: D1Database, pagoId: number, motivo: string, en: string) {
  const pago = await db.prepare('SELECT id, cobro_id, anulado_en FROM pagos WHERE id = ?').bind(pagoId).first<{ id: number; cobro_id: number; anulado_en: string | null }>()
  if (!pago) return null
  if (pago.anulado_en) return pago
  const factura = await db.prepare(
    `SELECT 1 FROM comprobantes c WHERE c.pago_id = ? AND c.tipo = 'factura_c' AND c.estado IN ('emitido', 'pendiente')
       AND NOT EXISTS (SELECT 1 FROM comprobantes nc WHERE nc.asociado_id = c.id AND nc.tipo = 'nota_credito_c')`
  ).bind(pagoId).first()
  if (factura) throw new ErrorCobro('Ese pago tiene factura C: se anula con una nota de crédito (llega con la factura de ARCA).')
  await db.batch([
    db.prepare(`UPDATE comprobantes SET estado = 'anulado', anulado_en = ?, anulado_motivo = ? WHERE pago_id = ? AND tipo = 'interno' AND estado = 'emitido'`)
      .bind(en, motivo, pagoId),
    db.prepare('UPDATE pagos SET anulado_en = ?, anulado_motivo = ? WHERE id = ? AND anulado_en IS NULL').bind(en, motivo, pagoId),
  ])
  return pago
}

/** Anula un cobro sin pagos vigentes (la base no deja anular uno con pagos). */
export async function anularCobro(db: D1Database, cobroId: number, motivo: string, en: string) {
  const vigentes = await db.prepare('SELECT COUNT(*) n FROM pagos WHERE cobro_id = ? AND anulado_en IS NULL').bind(cobroId).first<{ n: number }>()
  if ((vigentes?.n ?? 0) > 0) throw new ErrorCobro('Primero anulá sus pagos.')
  const r = await db.prepare('UPDATE cobros SET anulado_en = ?, anulado_motivo = ? WHERE id = ? AND anulado_en IS NULL').bind(en, motivo, cobroId).run()
  return r.meta.changes > 0
}

/** Mensaje de «Enviar datos de pago». La app no mueve plata: solo le pasa los datos. */
export function mensajeDatosPago(d: { nombre: string; concepto: string; importe: number; alias: string | null; cbu: string | null; titular: string | null; qr: boolean }, pesos: (c: number) => string) {
  return [
    `Hola ${d.nombre}, te paso los datos para pagar ${d.concepto.toLowerCase()}:`,
    `Importe: ${pesos(d.importe)}`,
    d.alias && `Alias: ${d.alias}`,
    d.cbu && `CBU: ${d.cbu}`,
    d.titular && `Titular: ${d.titular}`,
    d.qr && 'También te mando el QR para pagar desde tu app.',
  ].filter(Boolean).join('\n')
}
