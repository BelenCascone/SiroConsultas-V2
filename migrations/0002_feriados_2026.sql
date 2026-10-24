-- Feriados nacionales y días no laborables con fines turísticos de 2026 (Argentina).
-- Quedan «sin decidir» (atiende NULL): figuran sin atención hasta que la profesional diga si atiende.
-- Cada año hay que cargar los del siguiente (migración nueva): las fechas trasladables las fija el Gobierno.
INSERT OR IGNORE INTO feriados (fecha, nombre) VALUES
  ('2026-01-01', 'Año Nuevo'),
  ('2026-02-16', 'Carnaval'),
  ('2026-02-17', 'Carnaval'),
  ('2026-03-23', 'Día no laborable con fines turísticos'),
  ('2026-03-24', 'Día Nacional de la Memoria por la Verdad y la Justicia'),
  ('2026-04-02', 'Día del Veterano y de los Caídos en la Guerra de Malvinas'),
  ('2026-04-03', 'Viernes Santo'),
  ('2026-05-01', 'Día del Trabajador'),
  ('2026-05-25', 'Día de la Revolución de Mayo'),
  ('2026-06-15', 'Paso a la Inmortalidad del General Martín Miguel de Güemes'),
  ('2026-06-20', 'Paso a la Inmortalidad del General Manuel Belgrano'),
  ('2026-07-09', 'Día de la Independencia'),
  ('2026-07-10', 'Día no laborable con fines turísticos'),
  ('2026-08-17', 'Paso a la Inmortalidad del General José de San Martín'),
  ('2026-10-12', 'Día del Respeto a la Diversidad Cultural'),
  ('2026-11-23', 'Día de la Soberanía Nacional'),
  ('2026-12-07', 'Día no laborable con fines turísticos'),
  ('2026-12-08', 'Día de la Inmaculada Concepción de María'),
  ('2026-12-25', 'Navidad');
