-- Datos FICTICIOS ampliados para mostrar el producto (capturas, landing, demos). Nunca datos reales.
-- Se carga DESPUÉS de seed/seed.sql (npm run db:demo). No lo usan las pruebas: ellas dependen del seed base.
-- Las fechas salen del lunes de la semana actual en Argentina (UTC−3), así los turnos caen en los días y consultorios
-- que atienden (Centro: lun/mié/vie · Norte: mar/jue · Videollamada: sáb) cualquier día que se cargue.

UPDATE obras_sociales SET en_uso = 1 WHERE id = 3;

INSERT INTO pacientes (id, dni, nombre, apellido, celular, correo, fecha_nacimiento, domicilio, ocupacion, cobertura, obra_social_id, numero_afiliado, consultorio_id) VALUES
  (5,  '27444111', 'Marcos',   'Ibarra',   '+54 9 343 555-0105', 'marcos@ejemplo.test',  '1982-05-09', 'Calle Ficticia 210',  'Arquitecto',     'obra_social', 1,    '000-512', 1),
  (6,  '33222999', 'Valeria',  'Núñez',    '+54 9 343 555-0106', 'valeria@ejemplo.test', '1988-09-30', 'Calle Inventada 88',  'Enfermera',      'obra_social', 2,    '31-4410', 1),
  (7,  '22876543', 'Hugo',     'Ledesma',  '+54 9 343 555-0107', NULL,                   '1971-01-17', 'Pasaje Demo 12',      'Remisero',       'particular',  NULL, NULL,      2),
  (8,  '36100200', 'Camila',   'Rojas',    '+54 9 343 555-0108', 'camila@ejemplo.test',  '1994-12-04', 'Calle Ficticia 455',  'Diseñadora',     'obra_social', 1,    '000-873', 2),
  (9,  '18765432', 'Norma',    'Villalba', '+54 9 343 555-0109', NULL,                   '1962-06-22', 'Calle Inventada 301', 'Jubilada',       'particular',  NULL, NULL,      1),
  (10, '39555777', 'Joaquín',  'Acosta',   '+54 9 343 555-0110', 'joaquin@ejemplo.test', '1998-02-11', 'Pasaje Demo 99',      'Estudiante',     'obra_social', 2,    '31-7782', 2),
  (11, '25999888', 'Silvia',   'Cabrera',  '+54 9 343 555-0111', 'silvia@ejemplo.test',  '1976-08-19', 'Calle Ficticia 77',   'Abogada',        'particular',  NULL, NULL,      2),
  (12, '31456123', 'Federico', 'Maidana',  '+54 9 343 555-0112', NULL,                   '1986-10-27', 'Calle Inventada 12',  'Electricista',   'obra_social', 3,    'G-20931',  1),
  (13, '29321654', 'Paula',    'Domínguez','+54 9 343 555-0113', 'paula@ejemplo.test',   '1981-04-03', 'Pasaje Demo 540',     'Docente',        'particular',  NULL, NULL,      1),
  (14, '41222333', 'Ignacio',  'Quiroga',  '+54 9 343 555-0114', 'nacho@ejemplo.test',   '2001-07-15', 'Calle Ficticia 9',    'Programador',    'obra_social', 1,    '000-990', 3),
  (15, '20111000', 'Rosa',     'Peralta',  '+54 9 343 555-0115', NULL,                   '1958-03-28', 'Calle Inventada 650', 'Jubilada',       'obra_social', 2,    '31-1203', 1),
  (16, '34888111', 'Lautaro',  'Medina',   '+54 9 343 555-0116', 'lautaro@ejemplo.test', '1991-11-08', 'Pasaje Demo 31',      'Kinesiólogo',    'obra_social', 1,    '000-345', 1);

-- Antecedentes (versión vigente = la última de cada paciente).
INSERT INTO antecedentes (paciente_id, ninguno, alergias, medicacion, grupo_sanguineo, personales, familiares) VALUES
  (1,  0, 'Penicilina', NULL, 'A+', 'Asma leve en la infancia.', 'Padre con hipertensión.'),
  (5,  0, NULL, 'Enalapril 10 mg por día', '0+', 'Hipertensión arterial desde 2021.', 'Madre con diabetes tipo 2.'),
  (6,  1, NULL, NULL, 'B+', NULL, NULL),
  (7,  0, NULL, 'Metformina 850 mg', 'A-', 'Diabetes tipo 2 (2019). Tabaquismo.', 'Hermano con infarto a los 55.'),
  (9,  0, 'Ibuprofeno', 'Levotiroxina 75 mcg', '0+', 'Hipotiroidismo. Artrosis de rodilla.', NULL),
  (13, 1, NULL, NULL, 'AB+', NULL, NULL),
  (15, 0, NULL, 'Atorvastatina 20 mg, Aspirina 100 mg', 'A+', 'Dislipemia.', 'Madre con ACV.');

-- Historia de las últimas dos semanas, la semana actual y la que viene.
-- (id, paciente, consultorio, días desde el lunes de esta semana, hora, prestación, atención)
WITH v(id, paciente, consultorio, dias, hora, prestacion, atencion) AS (VALUES
  (10, 1,  1, -14, '09:00', 2, 'control'), (11, 5,  1, -14, '09:45', 1, 'primera'), (12, 6,  1, -14, '10:30', 1, 'primera'),
  (13, 7,  2, -13, '09:00', 1, 'primera'), (14, 8,  2, -13, '10:00', 1, 'primera'),
  (15, 2,  1, -12, '08:30', 2, 'control'), (16, 9,  1, -12, '09:15', 1, 'primera'),
  (17, 10, 2, -11, '14:30', 1, 'primera'), (18, 11, 2, -11, '15:30', 1, 'primera'),
  (19, 12, 1, -10, '08:30', 1, 'primera'), (20, 13, 1, -10, '09:30', 1, 'primera'),
  (21, 14, 3, -9,  '09:00', 3, 'primera'),
  (22, 5,  1, -7,  '09:00', 2, 'control'), (23, 6,  1, -7,  '09:45', 2, 'control'), (24, 15, 1, -7,  '15:30', 1, 'primera'),
  (25, 7,  2, -6,  '09:30', 2, 'control'), (26, 9,  2, -6,  '11:00', 2, 'control'),
  (27, 1,  1, -5,  '08:30', 2, 'control'), (28, 16, 1, -5,  '10:00', 1, 'primera'),
  (29, 8,  2, -4,  '15:00', 2, 'control'), (30, 10, 2, -4,  '16:00', 2, 'control'), (31, 11, 2, -4,  '17:00', 2, 'control'),
  (32, 13, 1, -3,  '09:00', 2, 'control'), (33, 2,  1, -3,  '10:00', 2, 'control'),
  (34, 14, 3, -2,  '10:00', 3, 'control'), (35, 12, 3, -2,  '11:00', 3, 'control'),
  -- Lunes (hoy se suman a los 3 del seed base)
  (40, 5,  1, 0, '08:00', 2, 'control'), (41, 7,  1, 0, '15:00', 2, 'control'), (42, 8,  1, 0, '16:00', 2, 'control'), (43, 15, 1, 0, '17:00', 2, 'control'),
  -- Martes
  (44, 9,  2, 1, '09:00', 2, 'control'), (45, 10, 2, 1, '09:45', 2, 'control'), (46, 11, 2, 1, '10:30', 2, 'control'), (47, 16, 2, 1, '11:30', 2, 'control'),
  -- Miércoles
  (48, 12, 1, 2, '08:30', 2, 'control'), (49, 13, 1, 2, '09:15', 2, 'control'), (50, 14, 1, 2, '10:00', 2, 'control'),
  (51, 5,  1, 2, '15:30', 2, 'control'), (52, 6,  1, 2, '16:30', 2, 'control'),
  -- Jueves
  (53, 1,  2, 3, '14:30', 2, 'control'), (54, 7,  2, 3, '15:15', 2, 'control'), (55, 15, 2, 3, '16:30', 2, 'control'),
  (56, 8,  2, 3, '17:00', 2, 'control'), (57, 2,  2, 3, '18:00', 2, 'control'),
  -- Viernes
  (58, 9,  1, 4, '08:30', 2, 'control'), (59, 10, 1, 4, '09:30', 2, 'control'), (60, 16, 1, 4, '10:30', 2, 'control'), (61, 11, 1, 4, '11:30', 2, 'control'),
  -- Sábado (videollamada)
  (62, 13, 3, 5, '09:00', 3, 'control'), (63, 14, 3, 5, '10:00', 3, 'control'), (64, 12, 3, 5, '11:00', 3, 'control'),
  -- Semana que viene
  (65, 5,  1, 7, '09:00', 2, 'control'), (66, 6,  1, 7, '10:00', 2, 'control'), (67, 15, 1, 9, '08:30', 2, 'control'), (68, 7,  2, 8, '14:30', 2, 'control')
)
INSERT INTO turnos (id, paciente_id, consultorio_id, fecha, hora, duracion_min, prestacion_id, cobertura, obra_social_id, modalidad, atencion)
SELECT v.id, v.paciente, v.consultorio, date('now', '-3 hours', '-6 days', 'weekday 1', v.dias || ' days'), v.hora,
  pr.duracion_min, v.prestacion, pa.cobertura, pa.obra_social_id,
  CASE WHEN v.consultorio = 3 THEN 'videollamada' ELSE 'presencial' END, v.atencion
FROM v
JOIN prestaciones pr ON pr.id = v.prestacion
JOIN pacientes pa ON pa.id = v.paciente;

-- Los turnos de días anteriores a hoy ya se atendieron; algunos faltaron o se cancelaron.
UPDATE turnos SET estado = 'atendido', cerrado_en = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
  WHERE id >= 10 AND fecha < date('now', '-3 hours') AND id NOT IN (18, 24, 30, 31);
UPDATE turnos SET estado = 'ausente', cerrado_en = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id IN (18, 30);
UPDATE turnos SET estado = 'cancelado', cancelado_por = 'paciente', cierre_motivo = 'Avisó que no podía venir', cerrado_en = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = 31;
UPDATE turnos SET estado = 'cancelado', cancelado_por = 'profesional', cierre_motivo = 'Congreso', cerrado_en = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = 24;

-- De los turnos de hoy, los que ya pasaron de hora también se atendieron.
UPDATE turnos SET estado = 'atendido', cerrado_en = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
  WHERE fecha = date('now', '-3 hours') AND hora < strftime('%H:%M', 'now', '-3 hours') AND estado = 'confirmado';

-- Algunos pacientes ya confirmaron desde el enlace del recordatorio.
UPDATE turnos SET confirmacion = 'voy', confirmacion_cambios = 1, confirmacion_en = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id IN (41, 44, 46, 48, 51, 53, 62) AND estado = 'confirmado';
UPDATE turnos SET confirmacion = 'no_puedo', confirmacion_cambios = 1, confirmacion_en = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = 55 AND estado = 'confirmado';

-- Consultas finalizadas de los turnos atendidos (los del seed base incluidos).
INSERT INTO consultas (paciente_id, turno_id, consultorio_id, tipo, motivo, examen, plan, proximo_control)
SELECT t.paciente_id, t.id, t.consultorio_id, CASE WHEN t.atencion = 'primera' THEN 'primera' ELSE 'control' END,
  CASE t.id % 5
    WHEN 0 THEN 'Dolor lumbar de una semana, sin irradiación.'
    WHEN 1 THEN 'Control de presión arterial y resultados de laboratorio.'
    WHEN 2 THEN 'Tos y congestión hace cinco días, sin fiebre.'
    WHEN 3 THEN 'Cefaleas frecuentes por las tardes.'
    ELSE 'Chequeo anual y renovación de indicaciones.' END,
  CASE t.id % 5
    WHEN 0 THEN 'Buen estado general. Contractura paravertebral, sin déficit neurológico.'
    WHEN 1 THEN 'TA 125/80. Ritmo regular, sin soplos. Abdomen blando e indoloro.'
    WHEN 2 THEN 'Faringe levemente congestiva. Pulmones con buena entrada de aire bilateral.'
    WHEN 3 THEN 'Examen neurológico normal. Fondo de ojo sin particularidades.'
    ELSE 'Examen físico sin hallazgos. Peso estable.' END,
  CASE t.id % 5
    WHEN 0 THEN 'Reposo relativo, calor local y ejercicios. Control si persiste.'
    WHEN 1 THEN 'Continúa con la medicación. Pedido de laboratorio de control.'
    WHEN 2 THEN 'Hidratación, reposo y tratamiento sintomático. Consultar si aparece fiebre.'
    WHEN 3 THEN 'Registro de cefaleas por dos semanas. Control de visión.'
    ELSE 'Hábitos saludables. Se pide laboratorio de rutina.' END,
  CASE WHEN t.estado = 'atendido' THEN date(t.fecha, '+30 days') END
FROM turnos t WHERE t.estado = 'atendido';
UPDATE consultas SET estado = 'finalizada', finalizada_en = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), foto = '{}';

INSERT INTO mediciones (paciente_id, consulta_id, tipo, valor, unidad, fecha)
SELECT c.paciente_id, c.id, 'presion', CASE c.id % 3 WHEN 0 THEN '120/80' WHEN 1 THEN '130/85' ELSE '125/80' END, 'mmHg', t.fecha
FROM consultas c JOIN turnos t ON t.id = c.turno_id;
INSERT INTO mediciones (paciente_id, consulta_id, tipo, valor, unidad, fecha)
SELECT c.paciente_id, c.id, 'peso', CAST(60 + (c.paciente_id * 7) % 30 AS TEXT) || '.' || CAST(c.id % 10 AS TEXT), 'kg', t.fecha
FROM consultas c JOIN turnos t ON t.id = c.turno_id;

-- Cobros de lo atendido: particular = importe de la prestación; obra social = copago de $ 3.000.
INSERT INTO cobros (paciente_id, turno_id, prestacion_id, consultorio_id, cobertura, obra_social_id, concepto, importe, fecha)
SELECT t.paciente_id, t.id, t.prestacion_id, t.consultorio_id, t.cobertura, t.obra_social_id, pr.nombre,
  CASE WHEN t.cobertura = 'obra_social' THEN 300000 ELSE pr.importe END, t.fecha
FROM turnos t JOIN prestaciones pr ON pr.id = t.prestacion_id
WHERE t.estado = 'atendido' AND t.id >= 3;

-- Casi todo está pagado: quedan dos deudas (turnos 29 y 32) y un pago parcial (turno 25).
INSERT INTO pagos (cobro_id, importe, medio, fecha)
SELECT c.id, CASE WHEN c.turno_id = 25 THEN c.importe / 2 ELSE c.importe END,
  CASE c.id % 3 WHEN 0 THEN 'efectivo' WHEN 1 THEN 'transferencia' ELSE 'tarjeta' END, c.fecha
FROM cobros c WHERE c.turno_id >= 3 AND c.importe > 0 AND c.turno_id NOT IN (29, 32);

-- Comprobante interno para los pagos de particulares (numeración correlativa propia).
INSERT INTO comprobantes (pago_id, tipo, numero, receptor_nombre, receptor_doc_tipo, receptor_doc, importe, fecha, estado)
SELECT pg.id, 'interno', ROW_NUMBER() OVER (ORDER BY pg.id), pa.nombre || ' ' || pa.apellido, 'dni', pa.dni, pg.importe, pg.fecha, 'emitido'
FROM pagos pg JOIN cobros c ON c.id = pg.cobro_id JOIN pacientes pa ON pa.id = c.paciente_id
WHERE c.cobertura = 'particular' AND pg.id > 1;
UPDATE numeradores SET ultimo = (SELECT COALESCE(MAX(numero), 0) FROM comprobantes WHERE tipo = 'interno') WHERE clave = 'comprobante_interno'
  AND (SELECT COALESCE(MAX(numero), 0) FROM comprobantes WHERE tipo = 'interno') > ultimo;

-- Pedidos de turno online esperando respuesta.
INSERT INTO pedidos (dni, nombre, apellido, celular, correo, cobertura_texto, consultorio_id, prestacion_id, fecha, hora, vence_en, privacidad_aceptada_en) VALUES
  ('37111222', 'Florencia', 'Acuña', '+54 9 343 555-0201', 'flor@ejemplo.test', 'OSDE', 1, 1, date('now', '-3 hours', '-6 days', 'weekday 1', '9 days'), '09:30',
    strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+10 hours'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-2 hours')),
  ('24333444', 'Ramón', 'Sánchez', '+54 9 343 555-0202', NULL, 'Particular', 2, 1, date('now', '-3 hours', '-6 days', 'weekday 1', '8 days'), '15:00',
    strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+11 hours'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-1 hours'));

INSERT INTO notificaciones (tipo, texto, enlace) VALUES
  ('pedido', 'Florencia Acuña pidió un turno para la semana que viene.', '/pedidos'),
  ('no_puede_ir', 'Rosa Peralta avisó que no puede ir a su turno del jueves.', '/agenda'),
  ('confirmo', 'Silvia Cabrera confirmó su turno de mañana.', '/agenda');
