-- Datos FICTICIOS para la demo y las pruebas. Nunca datos reales.
-- Los turnos se cargan relativos a la fecha de hoy en Argentina (UTC−3).

UPDATE profesional SET nombre = 'Julia Paredes', especialidad = 'Clínica médica', matricula = 'MP 00000',
  whatsapp = '+54 9 343 000-0000', correo = 'demo@siroconsultas.test' WHERE id = 1;

INSERT INTO consultorios (id, nombre, modalidad, direccion, orden) VALUES
  (1, 'Centro', 'presencial', 'San Martín 100 (dirección ficticia)', 1),
  (2, 'Norte', 'presencial', 'Belgrano 2000 (dirección ficticia)', 2),
  (3, 'Videollamada', 'videollamada', NULL, 3);

INSERT INTO horarios (consultorio_id, dia, desde, hasta) VALUES
  (1, 1, '08:00', '12:00'), (1, 1, '15:00', '19:00'),
  (1, 3, '08:00', '12:00'), (1, 3, '15:00', '19:00'),
  (1, 5, '08:00', '13:00'),
  (2, 2, '09:00', '13:00'), (2, 4, '14:00', '20:00'),
  (3, 6, '09:00', '12:00');

INSERT INTO prestaciones (id, nombre, duracion_min, importe, orden) VALUES
  (1, 'Primera consulta', 45, 2500000, 1),
  (2, 'Consulta de control', 30, 1800000, 2),
  (3, 'Videoconsulta', 30, 1500000, 3);

INSERT INTO obras_sociales (id, nombre, en_uso) VALUES
  (1, 'OSDE', 1), (2, 'Swiss Medical', 1), (3, 'Galeno', 0), (4, 'IOSFA', 0);

INSERT INTO pacientes (id, dni, nombre, apellido, celular, correo, fecha_nacimiento, domicilio, ocupacion, cobertura, obra_social_id, numero_afiliado, consultorio_id) VALUES
  (1, '30111222', 'Tomás', 'Ferreyra', '+54 9 343 111-1111', 'tomas@ejemplo.test', '1985-03-14', 'Calle Ficticia 123', 'Docente', 'obra_social', 1, '000-111', 1),
  (2, '28333444', 'Ana', 'Gómez', '+54 9 343 222-2222', NULL, '1979-11-02', 'Calle Inventada 45', 'Contadora', 'particular', NULL, NULL, 1),
  (3, '40555666', 'Lucía', 'Benítez', '+54 9 343 333-3333', 'lucia@ejemplo.test', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (4, '35777888', 'Martín', 'Sosa', '+54 9 343 444-4444', NULL, '1992-07-21', 'Pasaje Demo 7', 'Programador', 'obra_social', 2, '22-333', 2);

-- Historia: Tomás y Ana ya vinieron; Lucía es primera consulta con ficha incompleta.
INSERT INTO turnos (paciente_id, consultorio_id, fecha, hora, duracion_min, prestacion_id, cobertura, obra_social_id, atencion, estado, cerrado_en) VALUES
  (1, 1, date('now', '-3 hours', '-35 days'), '10:00', 45, 1, 'obra_social', 1, 'primera', 'confirmado', NULL),
  (2, 1, date('now', '-3 hours', '-20 days'), '11:00', 30, 2, 'particular', NULL, 'control', 'confirmado', NULL);
UPDATE turnos SET estado = 'atendido', cerrado_en = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id IN (1, 2);

INSERT INTO turnos (paciente_id, consultorio_id, fecha, hora, duracion_min, prestacion_id, cobertura, obra_social_id, atencion) VALUES
  (1, 1, date('now', '-3 hours'), '09:30', 30, 2, 'obra_social', 1, 'control'),
  (3, 1, date('now', '-3 hours'), '10:30', 45, 1, 'particular', NULL, 'primera'),
  (2, 1, date('now', '-3 hours'), '11:30', 30, 2, 'particular', NULL, 'control'),
  (4, 2, date('now', '-3 hours', '+2 days'), '16:00', 30, 2, 'obra_social', 2, 'control');

-- Una deuda de antes: Ana pagó una parte de su control.
INSERT INTO cobros (id, paciente_id, turno_id, prestacion_id, consultorio_id, cobertura, concepto, importe, fecha) VALUES
  (1, 2, 2, 2, 1, 'particular', 'Consulta de control', 1800000, date('now', '-3 hours', '-20 days'));
INSERT INTO pagos (cobro_id, importe, medio, fecha) VALUES (1, 1000000, 'efectivo', date('now', '-3 hours', '-20 days'));

INSERT INTO notificaciones (tipo, texto, enlace) VALUES
  ('confirmo', 'Tomás Ferreyra confirmó su turno de hoy a las 09:30.', '/agenda');
