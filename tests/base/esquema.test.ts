// Reglas de negocio que garantiza la base (docs/ANALISIS_FUNCIONAL.md · «Reglas de negocio»), probadas como lista de casos.
import { describe, it, expect, beforeEach } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { baseNueva, errorDe } from './base'

let db: DatabaseSync
const uno = (sql: string) => db.prepare(sql).get() as any

beforeEach(() => {
  db = baseNueva()
  db.exec(`
    INSERT INTO consultorios (id, nombre) VALUES (1, 'Centro');
    INSERT INTO prestaciones (id, nombre, duracion_min, importe) VALUES (1, 'Consulta', 30, 1800000);
    INSERT INTO obras_sociales (id, nombre, en_uso) VALUES (1, 'Obra Social Ficticia', 1);
    INSERT INTO pacientes (id, dni, nombre, apellido, celular) VALUES (1, '30111222', 'Tomás', 'Ferreyra', '3430000000');
  `)
})

const turno = (estado = 'confirmado') =>
  db.prepare(`INSERT INTO turnos (paciente_id, consultorio_id, fecha, hora, duracion_min, estado) VALUES (1, 1, '2026-11-02', '10:00', 30, ?)`).run(estado)
const cobro = (importe = 1800000) => {
  db.prepare(`INSERT INTO cobros (paciente_id, concepto, importe, fecha) VALUES (1, 'Consulta', ?, '2026-11-02')`).run(importe)
  return Number(uno('SELECT max(id) id FROM cobros').id)
}
const pago = (cobroId: number, importe: number, clave?: string) =>
  db.prepare(`INSERT INTO pagos (cobro_id, importe, medio, fecha, clave_unica) VALUES (?, ?, 'efectivo', '2026-11-02', ?)`).run(cobroId, importe, clave ?? null)

describe('Pacientes', () => {
  it('el DNI es único: no hay fichas duplicadas', () => {
    expect(errorDe(db, `INSERT INTO pacientes (dni, nombre, apellido, celular) VALUES ('30111222', 'Otra', 'Persona', '3431111111')`)).toMatch(/UNIQUE/)
  })
  it('el DNI es obligatorio y solo números', () => {
    expect(errorDe(db, `INSERT INTO pacientes (nombre, apellido, celular) VALUES ('Sin', 'DNI', '3431111111')`)).toMatch(/NOT NULL/)
    expect(errorDe(db, `INSERT INTO pacientes (dni, nombre, apellido, celular) VALUES ('30.111.333', 'Con', 'Puntos', '3431111111')`)).toMatch(/CHECK/)
  })
  it('el alta rápida queda como ficha incompleta hasta completar los datos', () => {
    expect(uno('SELECT ficha_completa FROM v_pacientes WHERE id = 1').ficha_completa).toBe(0)
    db.exec(`UPDATE pacientes SET fecha_nacimiento = '1985-03-14', domicilio = 'Calle 1', ocupacion = 'Docente', cobertura = 'particular' WHERE id = 1`)
    expect(uno('SELECT ficha_completa FROM v_pacientes WHERE id = 1').ficha_completa).toBe(1)
  })
  it('el cambio de DNI (y de cualquier dato) queda en el historial', () => {
    db.exec(`UPDATE pacientes SET dni = '30111223', celular = '3439999999' WHERE id = 1`)
    const cambios = db.prepare('SELECT campo, antes, despues FROM pacientes_cambios WHERE paciente_id = 1 ORDER BY campo').all() as any[]
    expect(cambios).toEqual([
      { campo: 'celular', antes: '3430000000', despues: '3439999999' },
      { campo: 'dni', antes: '30111222', despues: '30111223' },
    ])
    expect(errorDe(db, 'DELETE FROM pacientes_cambios')).toMatch(/no se borra/)
  })
  it('un paciente no se borra; dado de baja queda en solo lectura, sin turnos, y se puede reactivar', () => {
    expect(errorDe(db, 'DELETE FROM pacientes WHERE id = 1')).toMatch(/se da de baja/)
    db.exec(`UPDATE pacientes SET baja_en = '2026-11-01T10:00:00Z', baja_motivo = 'se_mudo' WHERE id = 1`)
    expect(errorDe(db, `UPDATE pacientes SET celular = '3438888888' WHERE id = 1`)).toMatch(/solo se puede reactivar/)
    expect(errorDe(db, `INSERT INTO turnos (paciente_id, consultorio_id, fecha, hora, duracion_min) VALUES (1, 1, '2026-11-02', '10:00', 30)`)).toMatch(/no se le dan turnos/)
    expect(errorDe(db, `INSERT INTO consultas (paciente_id, tipo) VALUES (1, 'primera')`)).toMatch(/solo lectura/)
    expect(errorDe(db, `UPDATE pacientes SET baja_en = NULL, baja_motivo = NULL WHERE id = 1`)).toBeNull()
  })
  it('los antecedentes solo suman versiones', () => {
    db.exec(`INSERT INTO antecedentes (paciente_id, alergias) VALUES (1, 'Penicilina')`)
    expect(errorDe(db, `UPDATE antecedentes SET alergias = 'Ninguna'`)).toMatch(/versión nueva/)
    expect(errorDe(db, 'DELETE FROM antecedentes')).toMatch(/no se borran/)
  })
})

describe('Turnos', () => {
  it('todo turno pertenece a una ficha', () => {
    expect(errorDe(db, `INSERT INTO turnos (consultorio_id, fecha, hora, duracion_min) VALUES (1, '2026-11-02', '10:00', 30)`)).toMatch(/NOT NULL/)
    expect(errorDe(db, `INSERT INTO turnos (paciente_id, consultorio_id, fecha, hora, duracion_min) VALUES (99, 1, '2026-11-02', '10:00', 30)`)).toMatch(/FOREIGN KEY/)
  })
  it('nace confirmado y no nace cerrado', () => {
    turno()
    expect(uno('SELECT estado, origen FROM turnos').estado).toBe('confirmado')
    expect(errorDe(db, `INSERT INTO turnos (paciente_id, consultorio_id, fecha, hora, duracion_min, estado, cerrado_en) VALUES (1, 1, '2026-11-02', '11:00', 30, 'atendido', 'x')`)).toMatch(/nace confirmado/)
  })
  it('un turno cerrado (atendido, ausente o cancelado) no se modifica ni se borra', () => {
    turno()
    db.exec(`UPDATE turnos SET estado = 'atendido', cerrado_en = '2026-11-02T13:10:00Z' WHERE id = 1`)
    expect(errorDe(db, `UPDATE turnos SET hora = '11:00' WHERE id = 1`)).toMatch(/Turno cerrado/)
    expect(errorDe(db, `UPDATE turnos SET estado = 'confirmado', cerrado_en = NULL WHERE id = 1`)).toMatch(/Turno cerrado/)
    expect(errorDe(db, 'DELETE FROM turnos WHERE id = 1')).toMatch(/se cancela/)
  })
  it('cancelar pide quién canceló; cerrar pide la fecha', () => {
    turno()
    expect(errorDe(db, `UPDATE turnos SET estado = 'cancelado', cerrado_en = 'x' WHERE id = 1`)).toMatch(/CHECK/)
    expect(errorDe(db, `UPDATE turnos SET estado = 'ausente' WHERE id = 1`)).toMatch(/CHECK/)
    expect(errorDe(db, `UPDATE turnos SET estado = 'cancelado', cancelado_por = 'paciente', cerrado_en = 'x' WHERE id = 1`)).toBeNull()
  })
  it('un turno «solicitado» viene del paciente y tiene vencimiento', () => {
    expect(errorDe(db, `INSERT INTO turnos (paciente_id, consultorio_id, fecha, hora, duracion_min, estado) VALUES (1, 1, '2026-11-02', '10:00', 30, 'solicitado')`)).toMatch(/CHECK/)
    expect(errorDe(db, `INSERT INTO turnos (paciente_id, consultorio_id, fecha, hora, duracion_min, estado, origen, solicitado_vence_en) VALUES (1, 1, '2026-11-02', '10:00', 30, 'solicitado', 'paciente', '2026-11-01T22:00:00Z')`)).toBeNull()
  })
  it('obra social pide cuál', () => {
    expect(errorDe(db, `INSERT INTO turnos (paciente_id, consultorio_id, fecha, hora, duracion_min, cobertura) VALUES (1, 1, '2026-11-02', '10:00', 30, 'obra_social')`)).toMatch(/CHECK/)
  })
})

describe('Bloqueos', () => {
  it('franja con desde y hasta, o todo el día; no se borran', () => {
    expect(errorDe(db, `INSERT INTO bloqueos (desde, hasta, motivo) VALUES ('2026-12-01', '2026-12-10', 'vacaciones')`)).toBeNull()
    expect(errorDe(db, `INSERT INTO bloqueos (desde, hasta, hora_desde) VALUES ('2026-12-01', '2026-12-01', '10:00')`)).toMatch(/CHECK/)
    expect(errorDe(db, `INSERT INTO bloqueos (desde, hasta) VALUES ('2026-12-10', '2026-12-01')`)).toMatch(/CHECK/)
    expect(errorDe(db, 'DELETE FROM bloqueos')).toMatch(/se quita/)
  })
})

describe('Historia clínica', () => {
  const consulta = () => { db.exec(`INSERT INTO consultas (paciente_id, tipo, motivo) VALUES (1, 'primera', 'Control anual')`); return 1 }
  it('nace como borrador; finalizar pide fecha y foto', () => {
    expect(errorDe(db, `INSERT INTO consultas (paciente_id, tipo, estado) VALUES (1, 'primera', 'finalizada')`)).toMatch(/borrador/)
    consulta()
    expect(errorDe(db, `UPDATE consultas SET estado = 'finalizada' WHERE id = 1`)).toMatch(/fecha y la foto/)
  })
  it('una consulta finalizada no se edita: se aclara', () => {
    consulta()
    expect(errorDe(db, `INSERT INTO aclaraciones (consulta_id, texto) VALUES (1, 'Aclaración')`)).toMatch(/finalizada/)
    db.exec(`UPDATE consultas SET estado = 'finalizada', finalizada_en = '2026-11-02T13:00:00Z', foto = '{}' WHERE id = 1`)
    expect(errorDe(db, `UPDATE consultas SET plan = 'Otro plan' WHERE id = 1`)).toMatch(/no se modifica/)
    expect(errorDe(db, 'DELETE FROM consultas')).toMatch(/no se borra/)
    expect(errorDe(db, `INSERT INTO aclaraciones (consulta_id, texto) VALUES (1, 'Corrijo la dosis')`)).toBeNull()
    expect(errorDe(db, `UPDATE aclaraciones SET texto = 'x'`)).toMatch(/no se modifican/)
  })
  it('descartar un borrador pide motivo y queda registrado', () => {
    consulta()
    expect(errorDe(db, `UPDATE consultas SET estado = 'descartada' WHERE id = 1`)).toMatch(/motivo/)
    expect(errorDe(db, `UPDATE consultas SET estado = 'descartada', descartada_en = 'x', descarte_motivo = 'Era de otro paciente' WHERE id = 1`)).toBeNull()
  })
  it('documentos: se registra el PDF una vez y se anulan con motivo; nunca se reescriben', () => {
    db.exec(`INSERT INTO documentos (paciente_id, tipo, datos, fecha) VALUES (1, 'certificado', '{"dias":2}', '2026-11-02')`)
    const h = 'a'.repeat(64)
    expect(errorDe(db, `UPDATE documentos SET pdf_clave = 'doc/1.pdf', pdf_sha256 = '${h}' WHERE id = 1`)).toBeNull()
    expect(errorDe(db, `UPDATE documentos SET pdf_clave = 'doc/otro.pdf' WHERE id = 1`)).toMatch(/no se modifica/)
    expect(errorDe(db, `UPDATE documentos SET datos = '{"dias":5}' WHERE id = 1`)).toMatch(/no se modifica/)
    expect(errorDe(db, `UPDATE documentos SET anulado_en = 'x', anulado_motivo = 'Fecha mal' WHERE id = 1`)).toBeNull()
    expect(errorDe(db, 'DELETE FROM documentos')).toMatch(/se anula/)
  })
  it('mediciones y archivos solo se anulan', () => {
    db.exec(`INSERT INTO mediciones (paciente_id, tipo, valor, unidad, fecha) VALUES (1, 'peso', '72.5', 'kg', '2026-11-02')`)
    expect(errorDe(db, `UPDATE mediciones SET valor = '80' WHERE id = 1`)).toMatch(/solo se anula/)
    expect(errorDe(db, `UPDATE mediciones SET anulado_en = 'x', anulado_motivo = 'Error de carga' WHERE id = 1`)).toBeNull()
    expect(errorDe(db, 'DELETE FROM mediciones')).toMatch(/se anula/)
  })
})

describe('Cobros y pagos', () => {
  it('un pago nunca supera el saldo', () => {
    const c = cobro()
    pago(c, 1000000)
    expect(errorDe(db, `INSERT INTO pagos (cobro_id, importe, medio, fecha) VALUES (${c}, 900000, 'efectivo', '2026-11-02')`)).toMatch(/supera el saldo/)
    pago(c, 800000)
    expect(uno(`SELECT estado, saldo FROM v_cobros WHERE id = ${c}`)).toMatchObject({ estado: 'pagado', saldo: 0 })
  })
  it('el doble clic no duplica el pago', () => {
    const c = cobro()
    pago(c, 500000, 'clic-1')
    expect(errorDe(db, `INSERT INTO pagos (cobro_id, importe, medio, fecha, clave_unica) VALUES (${c}, 500000, 'efectivo', '2026-11-02', 'clic-1')`)).toMatch(/UNIQUE/)
  })
  it('estados: debe, parcial, pagado y sin cargo', () => {
    const debe = cobro(), parcial = cobro(), sinCargo = cobro(0)
    pago(parcial, 100000)
    expect(uno(`SELECT estado FROM v_cobros WHERE id = ${debe}`).estado).toBe('debe')
    expect(uno(`SELECT estado, saldo FROM v_cobros WHERE id = ${parcial}`)).toMatchObject({ estado: 'parcial', saldo: 1700000 })
    expect(uno(`SELECT estado FROM v_cobros WHERE id = ${sinCargo}`).estado).toBe('sin_cargo')
    expect(uno('SELECT saldo FROM v_pacientes WHERE id = 1').saldo).toBe(3500000)
  })
  it('un pago mal cargado se anula con motivo y deja de contar', () => {
    const c = cobro()
    pago(c, 1800000)
    expect(errorDe(db, 'UPDATE pagos SET importe = 1000 WHERE id = 1')).toMatch(/solo se anula/)
    expect(errorDe(db, `UPDATE pagos SET anulado_en = 'x' WHERE id = 1`)).toMatch(/CHECK/)
    db.exec(`UPDATE pagos SET anulado_en = 'x', anulado_motivo = 'Importe equivocado' WHERE id = 1`)
    expect(uno(`SELECT saldo FROM v_cobros WHERE id = ${c}`).saldo).toBe(1800000)
    expect(errorDe(db, 'DELETE FROM pagos')).toMatch(/se anula/)
  })
  it('un cobro con pagos vigentes no se anula; sin pagos sí', () => {
    const c = cobro()
    pago(c, 500000)
    expect(errorDe(db, `UPDATE cobros SET anulado_en = 'x', anulado_motivo = 'm' WHERE id = ${c}`)).toMatch(/primero se anulan los pagos/)
    db.exec(`UPDATE pagos SET anulado_en = 'x', anulado_motivo = 'm' WHERE cobro_id = ${c}`)
    expect(errorDe(db, `UPDATE cobros SET anulado_en = 'x', anulado_motivo = 'Cargado dos veces' WHERE id = ${c}`)).toBeNull()
    expect(errorDe(db, `INSERT INTO pagos (cobro_id, importe, medio, fecha) VALUES (${c}, 100, 'efectivo', '2026-11-02')`)).toMatch(/anulado o perdonado/)
  })
  it('un cobro no se reescribe', () => {
    const c = cobro()
    expect(errorDe(db, `UPDATE cobros SET importe = 1 WHERE id = ${c}`)).toMatch(/no se modifica/)
  })
  it('solo el cobro por ausencia se perdona, con motivo', () => {
    const c = cobro()
    expect(errorDe(db, `UPDATE cobros SET perdonado_en = 'x', perdonado_motivo = 'm' WHERE id = ${c}`)).toMatch(/CHECK/)
    db.exec(`INSERT INTO cobros (paciente_id, concepto, importe, origen, fecha) VALUES (1, 'Ausencia', 1800000, 'ausencia', '2026-11-02')`)
    const a = Number(uno('SELECT max(id) id FROM cobros').id)
    expect(errorDe(db, `UPDATE cobros SET perdonado_en = 'x', perdonado_motivo = 'Avisó por enfermedad' WHERE id = ${a}`)).toBeNull()
    expect(uno(`SELECT estado, saldo FROM v_cobros WHERE id = ${a}`)).toMatchObject({ estado: 'perdonado', saldo: 0 })
  })
})

describe('Comprobantes', () => {
  const interno = (pagoId: number, numero: number, importe = 1800000) =>
    errorDe(db, `INSERT INTO comprobantes (pago_id, tipo, numero, receptor_nombre, receptor_doc_tipo, receptor_doc, importe, fecha, estado)
      VALUES (${pagoId}, 'interno', ${numero}, 'Tomás Ferreyra', 'dni', '30111222', ${importe}, '2026-11-02', 'emitido')`)

  it('un comprobante por pago, por el importe del pago, con numeración única', () => {
    const c = cobro(); pago(c, 1800000)
    expect(interno(1, 1, 1000)).toMatch(/importe del pago/)
    expect(interno(1, 1)).toBeNull()
    expect(interno(1, 2)).toMatch(/UNIQUE/)
    const c2 = cobro(); pago(c2, 1800000)
    expect(interno(2, 1)).toMatch(/UNIQUE/)
  })
  it('un comprobante emitido no se modifica; el interno se anula con motivo', () => {
    const c = cobro(); pago(c, 1800000); interno(1, 1)
    expect(errorDe(db, `UPDATE comprobantes SET receptor_nombre = 'Otra' WHERE id = 1`)).toMatch(/no se modifica/)
    expect(errorDe(db, `UPDATE comprobantes SET estado = 'anulado', anulado_en = 'x', anulado_motivo = 'Pago mal cargado' WHERE id = 1`)).toBeNull()
    expect(errorDe(db, `UPDATE comprobantes SET estado = 'emitido', anulado_en = NULL, anulado_motivo = NULL WHERE id = 1`)).toMatch(/no se modifica/)
    expect(errorDe(db, 'DELETE FROM comprobantes')).toMatch(/no se borra/)
  })
  it('anular un pago con comprobante obliga a anular el comprobante primero', () => {
    const c = cobro(); pago(c, 1800000); interno(1, 1)
    expect(errorDe(db, `UPDATE pagos SET anulado_en = 'x', anulado_motivo = 'm' WHERE id = 1`)).toMatch(/Primero hay que anular el comprobante/)
    db.exec(`UPDATE comprobantes SET estado = 'anulado', anulado_en = 'x', anulado_motivo = 'm' WHERE id = 1`)
    expect(errorDe(db, `UPDATE pagos SET anulado_en = 'x', anulado_motivo = 'm' WHERE id = 1`)).toBeNull()
  })
  it('la factura C no se anula: se compensa con nota de crédito C; pendiente pasa a emitida con CAE', () => {
    const c = cobro(); pago(c, 1800000)
    db.exec(`INSERT INTO comprobantes (pago_id, tipo, punto_venta, receptor_nombre, receptor_doc_tipo, receptor_doc, importe, fecha, estado)
      VALUES (1, 'factura_c', 2, 'Tomás Ferreyra', 'dni', '30111222', 1800000, '2026-11-02', 'pendiente')`)
    expect(errorDe(db, `UPDATE comprobantes SET estado = 'emitido' WHERE id = 1`)).toMatch(/CHECK/)
    expect(errorDe(db, `UPDATE comprobantes SET estado = 'emitido', numero = 15, cae = '12345678901234', cae_vence = '2026-11-12' WHERE id = 1`)).toBeNull()
    expect(errorDe(db, `UPDATE comprobantes SET estado = 'anulado', anulado_en = 'x', anulado_motivo = 'm' WHERE id = 1`)).toMatch(/CHECK|no se modifica/)
    expect(errorDe(db, `UPDATE pagos SET anulado_en = 'x', anulado_motivo = 'm' WHERE id = 1`)).toMatch(/nota de crédito/)
    db.exec(`INSERT INTO comprobantes (pago_id, tipo, punto_venta, asociado_id, receptor_nombre, receptor_doc_tipo, receptor_doc, importe, fecha, estado)
      VALUES (1, 'nota_credito_c', 2, 1, 'Tomás Ferreyra', 'dni', '30111222', 1800000, '2026-11-03', 'pendiente')`)
    expect(errorDe(db, `UPDATE pagos SET anulado_en = 'x', anulado_motivo = 'm' WHERE id = 1`)).toBeNull()
  })
  it('no se emite comprobante de un pago anulado', () => {
    const c = cobro(); pago(c, 1800000)
    db.exec(`UPDATE pagos SET anulado_en = 'x', anulado_motivo = 'm' WHERE id = 1`)
    expect(interno(1, 1)).toMatch(/pago anulado/)
  })
  it('la numeración interna no retrocede ni se borra', () => {
    db.exec(`UPDATE numeradores SET ultimo = 5 WHERE clave = 'comprobante_interno'`)
    expect(errorDe(db, `UPDATE numeradores SET ultimo = 4 WHERE clave = 'comprobante_interno'`)).toMatch(/no retrocede/)
    expect(errorDe(db, 'DELETE FROM numeradores')).toMatch(/no se borra/)
  })
})

describe('Registros que no se tocan', () => {
  it('auditoría y aceptaciones legales: solo se agregan', () => {
    db.exec(`INSERT INTO auditoria (evento) VALUES ('ingreso')`)
    expect(errorDe(db, `UPDATE auditoria SET evento = 'x'`)).toMatch(/no se modifica/)
    expect(errorDe(db, 'DELETE FROM auditoria')).toMatch(/no se borra/)
    db.exec(`INSERT INTO aceptaciones_legales (email, version) VALUES ('demo@siroconsultas.test', '1.0')`)
    expect(errorDe(db, `INSERT INTO aceptaciones_legales (email, version) VALUES ('demo@siroconsultas.test', '1.0')`)).toMatch(/UNIQUE/)
    expect(errorDe(db, 'DELETE FROM aceptaciones_legales')).toMatch(/no se borra/)
  })
  it('el modo restauración de un respaldo es lo único que saltea los triggers', () => {
    db.exec(`INSERT INTO auditoria (evento) VALUES ('ingreso')`)
    db.exec(`UPDATE config SET valor = '1' WHERE clave = 'restauracion'`)
    expect(errorDe(db, 'DELETE FROM auditoria')).toBeNull()
  })
})

describe('Datos ficticios', () => {
  it('la semilla entra completa sobre el esquema', () => {
    const conDatos = baseNueva({ conDatos: true })
    expect((conDatos.prepare('SELECT COUNT(*) n FROM pacientes').get() as any).n).toBe(4)
    expect((conDatos.prepare(`SELECT estado FROM v_cobros WHERE id = 1`).get() as any).estado).toBe('parcial')
  })
})
