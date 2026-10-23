-- SiroConsultas v2 · esquema completo (etapa 0), según docs/ANALISIS_FUNCIONAL.md del 23/10.
--
-- Convenciones
--  · Fechas y horas de la agenda en horario de Argentina: fecha 'AAAA-MM-DD', hora 'HH:MM'.
--  · Marcas de tiempo («..._en») en UTC, formato ISO: 2026-10-23T21:30:00Z.
--  · Importes en centavos (enteros).
--  · Lo clínico y lo financiero no se borra ni se reescribe: se anula con motivo. Los triggers lo garantizan
--    aunque la aplicación tenga un error o alguien ejecute SQL a mano. Solo el modo restauración de un respaldo
--    (config.restauracion = '1') los saltea.
--  · Las migraciones siguientes son aditivas: esta no se edita una vez publicada.

-- ============================================================================================
-- Configuración interna
-- ============================================================================================
CREATE TABLE config (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);
INSERT INTO config (clave, valor) VALUES ('restauracion', '0');

-- Numeración correlativa propia (comprobante interno). Nunca retrocede ni se reutiliza.
CREATE TABLE numeradores (
  clave TEXT PRIMARY KEY,
  ultimo INTEGER NOT NULL DEFAULT 0 CHECK (ultimo >= 0)
);
INSERT INTO numeradores (clave, ultimo) VALUES ('comprobante_interno', 0);

CREATE TRIGGER numeradores_no_retroceden BEFORE UPDATE ON numeradores
WHEN NEW.ultimo <= OLD.ultimo AND (SELECT valor FROM config WHERE clave = 'restauracion') IS NOT '1'
BEGIN SELECT RAISE(ABORT, 'La numeración no retrocede'); END;
CREATE TRIGGER numeradores_no_se_borran BEFORE DELETE ON numeradores
WHEN (SELECT valor FROM config WHERE clave = 'restauracion') IS NOT '1'
BEGIN SELECT RAISE(ABORT, 'La numeración no se borra'); END;

-- ============================================================================================
-- Profesional (perfil): una sola fila por instalación
-- ============================================================================================
CREATE TABLE profesional (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  nombre TEXT CHECK (nombre IS NULL OR length(nombre) <= 120),
  especialidad TEXT CHECK (especialidad IS NULL OR length(especialidad) <= 120),
  matricula TEXT CHECK (matricula IS NULL OR length(matricula) <= 60),
  foto_clave TEXT,                          -- archivo en R2
  whatsapp TEXT CHECK (whatsapp IS NULL OR length(whatsapp) <= 30),
  correo TEXT CHECK (correo IS NULL OR length(correo) <= 200),
  -- Datos fiscales (factura C de ARCA). El certificado vive como secreto del Worker, nunca en la base.
  cuit TEXT CHECK (cuit IS NULL OR (length(cuit) = 11 AND cuit NOT GLOB '*[^0-9]*')),
  condicion_iva TEXT CHECK (condicion_iva IS NULL OR condicion_iva IN ('monotributo', 'exento')),
  domicilio_fiscal TEXT CHECK (domicilio_fiscal IS NULL OR length(domicilio_fiscal) <= 200),
  punto_venta INTEGER CHECK (punto_venta IS NULL OR punto_venta BETWEEN 1 AND 99999),
  arca_estado TEXT NOT NULL DEFAULT 'sin_configurar' CHECK (arca_estado IN ('sin_configurar', 'homologacion', 'produccion')),
  -- Datos para transferir (la app no mueve plata)
  transferencia_alias TEXT CHECK (transferencia_alias IS NULL OR length(transferencia_alias) <= 40),
  transferencia_cbu TEXT CHECK (transferencia_cbu IS NULL OR (length(transferencia_cbu) = 22 AND transferencia_cbu NOT GLOB '*[^0-9]*')),
  transferencia_titular TEXT CHECK (transferencia_titular IS NULL OR length(transferencia_titular) <= 120),
  transferencia_qr_clave TEXT,              -- imagen del QR en R2 (opcional)
  -- Diseño del comprobante interno
  comprobante_logo_clave TEXT,
  comprobante_color TEXT CHECK (comprobante_color IS NULL OR comprobante_color GLOB '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]'),
  comprobante_pie TEXT CHECK (comprobante_pie IS NULL OR length(comprobante_pie) <= 300),
  correo_contadora TEXT CHECK (correo_contadora IS NULL OR length(correo_contadora) <= 200),
  -- Preferencias
  cobro_ausencia_activo INTEGER NOT NULL DEFAULT 0 CHECK (cobro_ausencia_activo IN (0, 1)),
  cobro_ausencia_horas INTEGER NOT NULL DEFAULT 24 CHECK (cobro_ausencia_horas BETWEEN 1 AND 168),
  pedido_plazo_horas INTEGER NOT NULL DEFAULT 12 CHECK (pedido_plazo_horas BETWEEN 1 AND 72),
  recordatorio_mensaje TEXT CHECK (recordatorio_mensaje IS NULL OR length(recordatorio_mensaje) <= 600),
  recordatorio_correo_activo INTEGER NOT NULL DEFAULT 1 CHECK (recordatorio_correo_activo IN (0, 1)),
  actualizado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
INSERT INTO profesional (id) VALUES (1);

CREATE TRIGGER profesional_no_se_borra BEFORE DELETE ON profesional
WHEN (SELECT valor FROM config WHERE clave = 'restauracion') IS NOT '1'
BEGIN SELECT RAISE(ABORT, 'El perfil no se borra'); END;

-- ============================================================================================
-- Ingreso: segundo factor, códigos de alta y de recuperación, sesiones y aceptación legal
-- ============================================================================================
CREATE TABLE totp (
  email TEXT PRIMARY KEY,
  secreto TEXT NOT NULL,                    -- cifrado con AES-GCM (clave TOTP_KEY, secreto del Worker)
  verificado INTEGER NOT NULL DEFAULT 0 CHECK (verificado IN (0, 1)),
  ultimo_paso INTEGER NOT NULL DEFAULT 0,   -- un código no se puede usar dos veces
  fallos INTEGER NOT NULL DEFAULT 0,
  bloqueado_hasta TEXT,
  creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Código de alta que BC le entrega en persona para activar el segundo factor. En la base solo queda su huella.
CREATE TABLE codigos_alta (
  huella TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  vence_en TEXT NOT NULL,
  usado_en TEXT,
  creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE codigos_recuperacion (
  huella TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  usado_en TEXT,
  creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_recuperacion_email ON codigos_recuperacion(email);

CREATE TABLE sesiones (
  id TEXT PRIMARY KEY,                      -- huella del token; el token va solo en la cookie
  email TEXT NOT NULL,
  creada_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  vence_en TEXT NOT NULL,
  ultima_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ip_huella TEXT,
  cerrada_en TEXT
);
CREATE INDEX idx_sesiones_email ON sesiones(email);

-- Intentos para frenar abusos (ingreso, segundo factor, pedidos online): clave + ventana de tiempo.
CREATE TABLE intentos (
  clave TEXT NOT NULL,
  ventana TEXT NOT NULL,
  cuenta INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (clave, ventana)
);

-- Aceptación de los términos de uso y la política de privacidad. Sin la versión vigente no se entra.
CREATE TABLE aceptaciones_legales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  version TEXT NOT NULL CHECK (length(version) BETWEEN 1 AND 40),
  aceptado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ip_huella TEXT,
  UNIQUE (email, version)
);
CREATE TRIGGER aceptaciones_no_update BEFORE UPDATE ON aceptaciones_legales
WHEN (SELECT valor FROM config WHERE clave = 'restauracion') IS NOT '1'
BEGIN SELECT RAISE(ABORT, 'Una aceptación no se modifica'); END;
CREATE TRIGGER aceptaciones_no_delete BEFORE DELETE ON aceptaciones_legales
WHEN (SELECT valor FROM config WHERE clave = 'restauracion') IS NOT '1'
BEGIN SELECT RAISE(ABORT, 'Una aceptación no se borra'); END;

-- ============================================================================================
-- Consultorios, horarios, prestaciones y obras sociales
-- ============================================================================================
CREATE TABLE consultorios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL CHECK (length(nombre) BETWEEN 1 AND 80),
  modalidad TEXT NOT NULL DEFAULT 'presencial' CHECK (modalidad IN ('presencial', 'videollamada')),
  direccion TEXT CHECK (direccion IS NULL OR length(direccion) <= 200),
  como_llegar TEXT CHECK (como_llegar IS NULL OR length(como_llegar) <= 400),
  activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),  -- apagado: no se ofrece para turnos nuevos; se conserva todo
  orden INTEGER NOT NULL DEFAULT 0,
  creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE TRIGGER consultorios_no_se_borran BEFORE DELETE ON consultorios
WHEN (SELECT valor FROM config WHERE clave = 'restauracion') IS NOT '1'
BEGIN SELECT RAISE(ABORT, 'Un consultorio no se borra: se apaga'); END;

-- Horario por día: 1 = lunes … 7 = domingo. Puede haber más de una franja por día (mañana y tarde).
CREATE TABLE horarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  consultorio_id INTEGER NOT NULL REFERENCES consultorios(id),
  dia INTEGER NOT NULL CHECK (dia BETWEEN 1 AND 7),
  desde TEXT NOT NULL CHECK (desde GLOB '[0-2][0-9]:[0-5][0-9]'),
  hasta TEXT NOT NULL CHECK (hasta GLOB '[0-2][0-9]:[0-5][0-9]'),
  CHECK (desde < hasta)
);
CREATE INDEX idx_horarios_consultorio ON horarios(consultorio_id, dia);

CREATE TABLE prestaciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL CHECK (length(nombre) BETWEEN 1 AND 80),
  duracion_min INTEGER NOT NULL CHECK (duracion_min BETWEEN 5 AND 480),
  importe INTEGER NOT NULL DEFAULT 0 CHECK (importe BETWEEN 0 AND 100000000), -- particular, en centavos; 0 = «Sin cargo»
  activa INTEGER NOT NULL DEFAULT 1 CHECK (activa IN (0, 1)),
  orden INTEGER NOT NULL DEFAULT 0,
  creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE TRIGGER prestaciones_no_se_borran BEFORE DELETE ON prestaciones
WHEN (SELECT valor FROM config WHERE clave = 'restauracion') IS NOT '1'
BEGIN SELECT RAISE(ABORT, 'Una prestación no se borra: se desactiva'); END;

-- Catálogo argentino; «en_uso» son las que usa la profesional.
CREATE TABLE obras_sociales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(nombre) BETWEEN 1 AND 120),
  en_uso INTEGER NOT NULL DEFAULT 0 CHECK (en_uso IN (0, 1))
);
CREATE TRIGGER obras_sociales_no_se_borran BEFORE DELETE ON obras_sociales
WHEN (SELECT valor FROM config WHERE clave = 'restauracion') IS NOT '1'
BEGIN SELECT RAISE(ABORT, 'Una obra social no se borra: se deja de usar'); END;

-- ============================================================================================
-- Pacientes
-- ============================================================================================
-- El DNI es el identificador único: obligatorio desde el alta rápida (DNI, nombre, apellido, celular, correo opcional).
-- El resto (nacimiento, domicilio, ocupación, cobertura) se completa antes de la primera consulta: hasta entonces,
-- «Ficha incompleta» (ver la vista v_pacientes).
CREATE TABLE pacientes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dni TEXT NOT NULL UNIQUE CHECK (length(dni) BETWEEN 6 AND 10 AND dni NOT GLOB '*[^0-9]*'),
  nombre TEXT NOT NULL CHECK (length(nombre) BETWEEN 1 AND 80),
  apellido TEXT NOT NULL CHECK (length(apellido) BETWEEN 1 AND 80),
  celular TEXT NOT NULL CHECK (length(celular) BETWEEN 6 AND 30),
  correo TEXT CHECK (correo IS NULL OR length(correo) <= 200),
  fecha_nacimiento TEXT CHECK (fecha_nacimiento IS NULL OR fecha_nacimiento GLOB '[12][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]'),
  domicilio TEXT CHECK (domicilio IS NULL OR length(domicilio) <= 200),
  ocupacion TEXT CHECK (ocupacion IS NULL OR length(ocupacion) <= 120),
  cobertura TEXT CHECK (cobertura IS NULL OR cobertura IN ('particular', 'obra_social')),
  obra_social_id INTEGER REFERENCES obras_sociales(id),
  numero_afiliado TEXT CHECK (numero_afiliado IS NULL OR length(numero_afiliado) <= 60),
  consultorio_id INTEGER REFERENCES consultorios(id),      -- consultorio habitual
  recordatorios_baja INTEGER NOT NULL DEFAULT 0 CHECK (recordatorios_baja IN (0, 1)),
  baja_en TEXT,                                            -- dado de baja (archivado): solo lectura, sin turnos
  baja_motivo TEXT CHECK (baja_motivo IS NULL OR baja_motivo IN ('ya_no_viene', 'se_mudo', 'fallecio', 'duplicada', 'otro')),
  baja_detalle TEXT CHECK (baja_detalle IS NULL OR length(baja_detalle) <= 200),
  creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  actualizado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  CHECK (cobertura IS NOT 'obra_social' OR obra_social_id IS NOT NULL),
  CHECK ((baja_en IS NULL) = (baja_motivo IS NULL))
);
CREATE INDEX idx_pacientes_apellido ON pacientes(apellido, nombre);
CREATE INDEX idx_pacientes_celular ON pacientes(celular);

CREATE TRIGGER pacientes_no_se_borran BEFORE DELETE ON pacientes
WHEN (SELECT valor FROM config WHERE clave = 'restauracion') IS NOT '1'
BEGIN SELECT RAISE(ABORT, 'Un paciente no se borra: se da de baja'); END;

-- Dado de baja: no se edita hasta reactivarlo (la reactivación solo limpia la baja).
CREATE TRIGGER pacientes_baja_solo_lectura BEFORE UPDATE ON pacientes
WHEN OLD.baja_en IS NOT NULL AND NOT (
    NEW.baja_en IS NULL AND NEW.baja_motivo IS NULL AND NEW.baja_detalle IS NULL
    AND NEW.dni IS OLD.dni AND NEW.nombre IS OLD.nombre AND NEW.apellido IS OLD.apellido AND NEW.celular IS OLD.celular
    AND NEW.correo IS OLD.correo AND NEW.fecha_nacimiento IS OLD.fecha_nacimiento AND NEW.domicilio IS OLD.domicilio
    AND NEW.ocupacion IS OLD.ocupacion AND NEW.cobertura IS OLD.cobertura AND NEW.obra_social_id IS OLD.obra_social_id
    AND NEW.numero_afiliado IS OLD.numero_afiliado AND NEW.consultorio_id IS OLD.consultorio_id
    AND NEW.recordatorios_baja IS OLD.recordatorios_baja)
  AND (SELECT valor FROM config WHERE clave = 'restauracion') IS NOT '1'
BEGIN SELECT RAISE(ABORT, 'Paciente dado de baja: solo se puede reactivar'); END;

-- Historial de cambios de datos (el cambio de DNI queda acá).
CREATE TABLE pacientes_cambios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  paciente_id INTEGER NOT NULL REFERENCES pacientes(id),
  campo TEXT NOT NULL,
  antes TEXT,
  despues TEXT,
  en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_pacientes_cambios ON pacientes_cambios(paciente_id, en);

CREATE TRIGGER pacientes_registran_cambios AFTER UPDATE ON pacientes
BEGIN
  INSERT INTO pacientes_cambios (paciente_id, campo, antes, despues) SELECT NEW.id, 'dni', OLD.dni, NEW.dni WHERE OLD.dni IS NOT NEW.dni;
  INSERT INTO pacientes_cambios (paciente_id, campo, antes, despues) SELECT NEW.id, 'nombre', OLD.nombre, NEW.nombre WHERE OLD.nombre IS NOT NEW.nombre;
  INSERT INTO pacientes_cambios (paciente_id, campo, antes, despues) SELECT NEW.id, 'apellido', OLD.apellido, NEW.apellido WHERE OLD.apellido IS NOT NEW.apellido;
  INSERT INTO pacientes_cambios (paciente_id, campo, antes, despues) SELECT NEW.id, 'celular', OLD.celular, NEW.celular WHERE OLD.celular IS NOT NEW.celular;
  INSERT INTO pacientes_cambios (paciente_id, campo, antes, despues) SELECT NEW.id, 'correo', OLD.correo, NEW.correo WHERE OLD.correo IS NOT NEW.correo;
  INSERT INTO pacientes_cambios (paciente_id, campo, antes, despues) SELECT NEW.id, 'fecha_nacimiento', OLD.fecha_nacimiento, NEW.fecha_nacimiento WHERE OLD.fecha_nacimiento IS NOT NEW.fecha_nacimiento;
  INSERT INTO pacientes_cambios (paciente_id, campo, antes, despues) SELECT NEW.id, 'domicilio', OLD.domicilio, NEW.domicilio WHERE OLD.domicilio IS NOT NEW.domicilio;
  INSERT INTO pacientes_cambios (paciente_id, campo, antes, despues) SELECT NEW.id, 'ocupacion', OLD.ocupacion, NEW.ocupacion WHERE OLD.ocupacion IS NOT NEW.ocupacion;
  INSERT INTO pacientes_cambios (paciente_id, campo, antes, despues) SELECT NEW.id, 'cobertura', OLD.cobertura, NEW.cobertura WHERE OLD.cobertura IS NOT NEW.cobertura;
  INSERT INTO pacientes_cambios (paciente_id, campo, antes, despues) SELECT NEW.id, 'obra_social_id', OLD.obra_social_id, NEW.obra_social_id WHERE OLD.obra_social_id IS NOT NEW.obra_social_id;
  INSERT INTO pacientes_cambios (paciente_id, campo, antes, despues) SELECT NEW.id, 'numero_afiliado', OLD.numero_afiliado, NEW.numero_afiliado WHERE OLD.numero_afiliado IS NOT NEW.numero_afiliado;
  INSERT INTO pacientes_cambios (paciente_id, campo, antes, despues) SELECT NEW.id, 'consultorio_id', OLD.consultorio_id, NEW.consultorio_id WHERE OLD.consultorio_id IS NOT NEW.consultorio_id;
  INSERT INTO pacientes_cambios (paciente_id, campo, antes, despues) SELECT NEW.id, 'recordatorios_baja', OLD.recordatorios_baja, NEW.recordatorios_baja WHERE OLD.recordatorios_baja IS NOT NEW.recordatorios_baja;
  INSERT INTO pacientes_cambios (paciente_id, campo, antes, despues) SELECT NEW.id, 'baja', OLD.baja_motivo, NEW.baja_motivo WHERE OLD.baja_motivo IS NOT NEW.baja_motivo;
END;

CREATE TRIGGER pacientes_cambios_no_update BEFORE UPDATE ON pacientes_cambios
WHEN (SELECT valor FROM config WHERE clave = 'restauracion') IS NOT '1'
BEGIN SELECT RAISE(ABORT, 'El historial de cambios no se modifica'); END;
CREATE TRIGGER pacientes_cambios_no_delete BEFORE DELETE ON pacientes_cambios
WHEN (SELECT valor FROM config WHERE clave = 'restauracion') IS NOT '1'
BEGIN SELECT RAISE(ABORT, 'El historial de cambios no se borra'); END;

-- Antecedentes: solo se agregan versiones. La vigente es la última del paciente.
CREATE TABLE antecedentes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  paciente_id INTEGER NOT NULL REFERENCES pacientes(id),
  ninguno INTEGER NOT NULL DEFAULT 0 CHECK (ninguno IN (0, 1)),
  alergias TEXT CHECK (alergias IS NULL OR length(alergias) <= 2000),
  medicacion TEXT CHECK (medicacion IS NULL OR length(medicacion) <= 2000),
  grupo_sanguineo TEXT CHECK (grupo_sanguineo IS NULL OR grupo_sanguineo IN ('0+', '0-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-')),
  personales TEXT CHECK (personales IS NULL OR length(personales) <= 4000),
  familiares TEXT CHECK (familiares IS NULL OR length(familiares) <= 4000),
  registrado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_antecedentes_paciente ON antecedentes(paciente_id, id);
CREATE TRIGGER antecedentes_no_update BEFORE UPDATE ON antecedentes
WHEN (SELECT valor FROM config WHERE clave = 'restauracion') IS NOT '1'
BEGIN SELECT RAISE(ABORT, 'Los antecedentes no se modifican: se agrega una versión nueva'); END;
CREATE TRIGGER antecedentes_no_delete BEFORE DELETE ON antecedentes
WHEN (SELECT valor FROM config WHERE clave = 'restauracion') IS NOT '1'
BEGIN SELECT RAISE(ABORT, 'Los antecedentes no se borran'); END;
CREATE TRIGGER antecedentes_paciente_activo BEFORE INSERT ON antecedentes
WHEN (SELECT baja_en FROM pacientes WHERE id = NEW.paciente_id) IS NOT NULL AND (SELECT valor FROM config WHERE clave = 'restauracion') IS NOT '1'
BEGIN SELECT RAISE(ABORT, 'Paciente dado de baja: solo lectura'); END;

-- ============================================================================================
-- Agenda: turnos, series, bloqueos y feriados
-- ============================================================================================
CREATE TABLE series (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cada_semanas INTEGER NOT NULL CHECK (cada_semanas BETWEEN 1 AND 12),
  hasta TEXT NOT NULL CHECK (hasta GLOB '[12][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]'),
  creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Estados: confirmado (inicial) → atendido | ausente | cancelado (cerrados, no se modifican).
-- «solicitado» queda para el pedido online (etapa 5).
CREATE TABLE turnos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  paciente_id INTEGER NOT NULL REFERENCES pacientes(id),  -- todo turno pertenece a una ficha
  consultorio_id INTEGER NOT NULL REFERENCES consultorios(id),
  fecha TEXT NOT NULL CHECK (fecha GLOB '[12][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]'),
  hora TEXT NOT NULL CHECK (hora GLOB '[0-2][0-9]:[0-5][0-9]'),
  duracion_min INTEGER NOT NULL CHECK (duracion_min BETWEEN 5 AND 480),
  prestacion_id INTEGER REFERENCES prestaciones(id),
  cobertura TEXT NOT NULL DEFAULT 'particular' CHECK (cobertura IN ('particular', 'obra_social')),
  obra_social_id INTEGER REFERENCES obras_sociales(id),
  modalidad TEXT NOT NULL DEFAULT 'presencial' CHECK (modalidad IN ('presencial', 'videollamada')),
  enlace_video TEXT CHECK (enlace_video IS NULL OR (length(enlace_video) <= 300 AND enlace_video LIKE 'https://%')),
  atencion TEXT CHECK (atencion IS NULL OR atencion IN ('primera', 'control', 'otra')),
  estado TEXT NOT NULL DEFAULT 'confirmado' CHECK (estado IN ('solicitado', 'confirmado', 'atendido', 'ausente', 'cancelado')),
  origen TEXT NOT NULL DEFAULT 'profesional' CHECK (origen IN ('profesional', 'paciente')),
  cancelado_por TEXT CHECK (cancelado_por IS NULL OR cancelado_por IN ('profesional', 'paciente', 'sistema')),
  cierre_motivo TEXT CHECK (cierre_motivo IS NULL OR length(cierre_motivo) <= 200),
  cerrado_en TEXT,
  solicitado_vence_en TEXT,
  serie_id INTEGER REFERENCES series(id),
  -- Respuesta del paciente por el enlace: no cambia el estado, avisa.
  confirmacion TEXT CHECK (confirmacion IS NULL OR confirmacion IN ('voy', 'no_puedo')),
  confirmacion_cambios INTEGER NOT NULL DEFAULT 0 CHECK (confirmacion_cambios BETWEEN 0 AND 4),
  confirmacion_en TEXT,
  enlace_huella TEXT UNIQUE,                -- huella del enlace de confirmación (se renueva al reprogramar)
  recordatorio_whatsapp_en TEXT,
  recordatorio_correo_en TEXT,
  creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  actualizado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  CHECK (cobertura IS NOT 'obra_social' OR obra_social_id IS NOT NULL),
  CHECK ((estado = 'cancelado') = (cancelado_por IS NOT NULL)),
  CHECK ((estado IN ('atendido', 'ausente', 'cancelado')) = (cerrado_en IS NOT NULL)),
  CHECK (estado <> 'solicitado' OR (solicitado_vence_en IS NOT NULL AND origen = 'paciente'))
);
CREATE INDEX idx_turnos_fecha ON turnos(fecha, hora);
CREATE INDEX idx_turnos_paciente ON turnos(paciente_id, fecha);
CREATE INDEX idx_turnos_serie ON turnos(serie_id);

CREATE TRIGGER turnos_no_se_borran BEFORE DELETE ON turnos
WHEN (SELECT valor FROM config WHERE clave = 'restauracion') IS NOT '1'
BEGIN SELECT RAISE(ABORT, 'Un turno no se borra: se cancela'); END;

CREATE TRIGGER turnos_cerrado_inmutable BEFORE UPDATE ON turnos
WHEN OLD.estado IN ('atendido', 'ausente', 'cancelado') AND (SELECT valor FROM config WHERE clave = 'restauracion') IS NOT '1'
BEGIN SELECT RAISE(ABORT, 'Turno cerrado: no se puede modificar'); END;

CREATE TRIGGER turnos_nace_abierto BEFORE INSERT ON turnos
WHEN NEW.estado NOT IN ('solicitado', 'confirmado') AND (SELECT valor FROM config WHERE clave = 'restauracion') IS NOT '1'
BEGIN SELECT RAISE(ABORT, 'Un turno nace confirmado o solicitado'); END;

CREATE TRIGGER turnos_paciente_activo BEFORE INSERT ON turnos
WHEN (SELECT baja_en FROM pacientes WHERE id = NEW.paciente_id) IS NOT NULL AND (SELECT valor FROM config WHERE clave = 'restauracion') IS NOT '1'
BEGIN SELECT RAISE(ABORT, 'Paciente dado de baja: no se le dan turnos'); END;

CREATE TRIGGER turnos_no_vuelve_a_solicitado BEFORE UPDATE OF estado ON turnos
WHEN NEW.estado = 'solicitado' AND OLD.estado <> 'solicitado'
BEGIN SELECT RAISE(ABORT, 'Un turno no vuelve a solicitado'); END;

-- Bloqueos de agenda: no cancelan ni mueven turnos; los listan para que la profesional decida.
CREATE TABLE bloqueos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  desde TEXT NOT NULL CHECK (desde GLOB '[12][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]'),
  hasta TEXT NOT NULL CHECK (hasta GLOB '[12][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]'),
  hora_desde TEXT CHECK (hora_desde IS NULL OR hora_desde GLOB '[0-2][0-9]:[0-5][0-9]'),  -- sin horas = todo el día
  hora_hasta TEXT CHECK (hora_hasta IS NULL OR hora_hasta GLOB '[0-2][0-9]:[0-5][0-9]'),
  consultorio_id INTEGER REFERENCES consultorios(id),     -- vacío = todos
  motivo TEXT CHECK (motivo IS NULL OR motivo IN ('congreso', 'vacaciones', 'personal', 'otro')),
  detalle TEXT CHECK (detalle IS NULL OR length(detalle) <= 200),
  quitado_en TEXT,                                        -- al quitarlo el hueco vuelve a ofrecerse
  creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  CHECK (desde <= hasta),
  CHECK ((hora_desde IS NULL) = (hora_hasta IS NULL)),
  CHECK (hora_desde IS NULL OR hora_desde < hora_hasta)
);
CREATE INDEX idx_bloqueos_fechas ON bloqueos(desde, hasta);
CREATE TRIGGER bloqueos_no_se_borran BEFORE DELETE ON bloqueos
WHEN (SELECT valor FROM config WHERE clave = 'restauracion') IS NOT '1'
BEGIN SELECT RAISE(ABORT, 'Un bloqueo no se borra: se quita'); END;

-- Feriados nacionales cargados; la profesional decide si atiende (NULL = todavía no lo dijo: no atiende).
CREATE TABLE feriados (
  fecha TEXT PRIMARY KEY CHECK (fecha GLOB '[12][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]'),
  nombre TEXT NOT NULL CHECK (length(nombre) BETWEEN 1 AND 120),
  atiende INTEGER CHECK (atiende IS NULL OR atiende IN (0, 1))
);

-- Pedido de turno online (etapa 5): el paciente todavía puede no tener ficha. Al aceptarlo se vincula
-- o se crea la ficha por DNI y nace el turno. Retiene el hueco hasta que vence.
CREATE TABLE pedidos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dni TEXT NOT NULL CHECK (length(dni) BETWEEN 6 AND 10 AND dni NOT GLOB '*[^0-9]*'),
  nombre TEXT NOT NULL CHECK (length(nombre) BETWEEN 1 AND 80),
  apellido TEXT NOT NULL CHECK (length(apellido) BETWEEN 1 AND 80),
  celular TEXT NOT NULL CHECK (length(celular) BETWEEN 6 AND 30),
  correo TEXT CHECK (correo IS NULL OR length(correo) <= 200),
  cobertura_texto TEXT CHECK (cobertura_texto IS NULL OR length(cobertura_texto) <= 120),
  consultorio_id INTEGER NOT NULL REFERENCES consultorios(id),
  prestacion_id INTEGER REFERENCES prestaciones(id),
  fecha TEXT NOT NULL CHECK (fecha GLOB '[12][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]'),
  hora TEXT NOT NULL CHECK (hora GLOB '[0-2][0-9]:[0-5][0-9]'),
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aceptado', 'otro_horario', 'rechazado', 'vencido')),
  vence_en TEXT NOT NULL,
  privacidad_aceptada_en TEXT NOT NULL,
  turno_id INTEGER REFERENCES turnos(id),
  respondido_en TEXT,
  ip_huella TEXT,
  creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  CHECK ((estado = 'aceptado') = (turno_id IS NOT NULL))
);
CREATE INDEX idx_pedidos_estado ON pedidos(estado, vence_en);
CREATE TRIGGER pedidos_no_se_borran BEFORE DELETE ON pedidos
WHEN (SELECT valor FROM config WHERE clave = 'restauracion') IS NOT '1'
BEGIN SELECT RAISE(ABORT, 'Un pedido no se borra'); END;

-- Horarios propuestos al paciente («Otro horario» en un pedido, o «Que elija el paciente» al mover un turno):
-- hasta 3, reservados hasta que elige o vencen.
CREATE TABLE propuestas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  turno_id INTEGER REFERENCES turnos(id),
  pedido_id INTEGER REFERENCES pedidos(id),
  consultorio_id INTEGER NOT NULL REFERENCES consultorios(id),
  fecha TEXT NOT NULL CHECK (fecha GLOB '[12][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]'),
  hora TEXT NOT NULL CHECK (hora GLOB '[0-2][0-9]:[0-5][0-9]'),
  duracion_min INTEGER NOT NULL CHECK (duracion_min BETWEEN 5 AND 480),
  estado TEXT NOT NULL DEFAULT 'reservada' CHECK (estado IN ('reservada', 'elegida', 'liberada')),
  vence_en TEXT NOT NULL,
  creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  CHECK ((turno_id IS NULL) <> (pedido_id IS NULL))
);
CREATE INDEX idx_propuestas_fecha ON propuestas(fecha, estado);

-- ============================================================================================
-- Historia clínica: consultas, aclaraciones, mediciones, archivos y documentos
-- ============================================================================================
CREATE TABLE consultas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  paciente_id INTEGER NOT NULL REFERENCES pacientes(id),
  turno_id INTEGER UNIQUE REFERENCES turnos(id),          -- vacío = consulta sin turno
  consultorio_id INTEGER REFERENCES consultorios(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('primera', 'control')),
  estado TEXT NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador', 'finalizada', 'descartada')),
  motivo TEXT CHECK (motivo IS NULL OR length(motivo) <= 8000),       -- ¿Por qué consulta? / ¿Cómo sigue?
  antecedentes_texto TEXT CHECK (antecedentes_texto IS NULL OR length(antecedentes_texto) <= 8000),
  examen TEXT CHECK (examen IS NULL OR length(examen) <= 8000),
  plan TEXT CHECK (plan IS NULL OR length(plan) <= 8000),             -- plan e indicaciones
  proximo_control TEXT CHECK (proximo_control IS NULL OR proximo_control GLOB '[12][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]'),
  version INTEGER NOT NULL DEFAULT 1,       -- la misma consulta en dos pestañas no se pisa
  foto TEXT,                                -- datos del paciente y antecedentes tal como estaban al finalizar (JSON)
  finalizada_en TEXT,
  descartada_en TEXT,
  descarte_motivo TEXT CHECK (descarte_motivo IS NULL OR length(descarte_motivo) <= 200),
  creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  actualizado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_consultas_paciente ON consultas(paciente_id, creado_en);

CREATE TRIGGER consultas_no_se_borran BEFORE DELETE ON consultas
WHEN (SELECT valor FROM config WHERE clave = 'restauracion') IS NOT '1'
BEGIN SELECT RAISE(ABORT, 'Una consulta no se borra'); END;
CREATE TRIGGER consultas_nace_borrador BEFORE INSERT ON consultas
WHEN NEW.estado <> 'borrador' AND (SELECT valor FROM config WHERE clave = 'restauracion') IS NOT '1'
BEGIN SELECT RAISE(ABORT, 'Una consulta nace como borrador'); END;
CREATE TRIGGER consultas_cerrada_inmutable BEFORE UPDATE ON consultas
WHEN OLD.estado IN ('finalizada', 'descartada') AND (SELECT valor FROM config WHERE clave = 'restauracion') IS NOT '1'
BEGIN SELECT RAISE(ABORT, 'Consulta finalizada: no se modifica, se aclara'); END;
CREATE TRIGGER consultas_finalizar_completa BEFORE UPDATE OF estado ON consultas
WHEN NEW.estado = 'finalizada' AND (NEW.finalizada_en IS NULL OR NEW.foto IS NULL)
BEGIN SELECT RAISE(ABORT, 'Al finalizar hay que registrar la fecha y la foto de los datos'); END;
CREATE TRIGGER consultas_descartar_con_motivo BEFORE UPDATE OF estado ON consultas
WHEN NEW.estado = 'descartada' AND (NEW.descartada_en IS NULL OR NEW.descarte_motivo IS NULL)
BEGIN SELECT RAISE(ABORT, 'Descartar un borrador pide motivo'); END;
CREATE TRIGGER consultas_paciente_activo BEFORE INSERT ON consultas
WHEN (SELECT baja_en FROM pacientes WHERE id = NEW.paciente_id) IS NOT NULL AND (SELECT valor FROM config WHERE clave = 'restauracion') IS NOT '1'
BEGIN SELECT RAISE(ABORT, 'Paciente dado de baja: solo lectura'); END;

CREATE TABLE aclaraciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  consulta_id INTEGER NOT NULL REFERENCES consultas(id),
  texto TEXT NOT NULL CHECK (length(texto) BETWEEN 1 AND 4000),
  creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE TRIGGER aclaraciones_solo_finalizadas BEFORE INSERT ON aclaraciones
WHEN (SELECT estado FROM consultas WHERE id = NEW.consulta_id) IS NOT 'finalizada'
BEGIN SELECT RAISE(ABORT, 'Solo se aclara una consulta finalizada'); END;
CREATE TRIGGER aclaraciones_no_update BEFORE UPDATE ON aclaraciones
WHEN (SELECT valor FROM config WHERE clave = 'restauracion') IS NOT '1'
BEGIN SELECT RAISE(ABORT, 'Las aclaraciones no se modifican'); END;
CREATE TRIGGER aclaraciones_no_delete BEFORE DELETE ON aclaraciones
WHEN (SELECT valor FROM config WHERE clave = 'restauracion') IS NOT '1'
BEGIN SELECT RAISE(ABORT, 'Las aclaraciones no se borran'); END;

-- Signos vitales de una consulta y mediciones fuera de consulta (peso, talla…).
CREATE TABLE mediciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  paciente_id INTEGER NOT NULL REFERENCES pacientes(id),
  consulta_id INTEGER REFERENCES consultas(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('peso', 'talla', 'presion', 'frecuencia_cardiaca', 'temperatura', 'saturacion', 'glucemia', 'perimetro_cintura', 'otra')),
  valor TEXT NOT NULL CHECK (length(valor) BETWEEN 1 AND 40),   -- texto: la presión es «120/80»
  unidad TEXT CHECK (unidad IS NULL OR length(unidad) <= 20),
  fecha TEXT NOT NULL CHECK (fecha GLOB '[12][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]'),
  anulado_en TEXT,
  anulado_motivo TEXT CHECK (anulado_motivo IS NULL OR length(anulado_motivo) <= 200),
  creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_mediciones_paciente ON mediciones(paciente_id, fecha);

-- Estudios e imágenes. El archivo original vive en R2; acá su huella para probar que no cambió.
CREATE TABLE archivos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  paciente_id INTEGER NOT NULL REFERENCES pacientes(id),
  consulta_id INTEGER REFERENCES consultas(id),
  tipo TEXT NOT NULL DEFAULT 'estudio' CHECK (tipo IN ('estudio', 'imagen', 'otro')),
  nombre TEXT NOT NULL CHECK (length(nombre) BETWEEN 1 AND 200),
  clave TEXT NOT NULL UNIQUE,
  mime TEXT NOT NULL,
  tamano INTEGER NOT NULL CHECK (tamano > 0),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  anulado_en TEXT,
  anulado_motivo TEXT CHECK (anulado_motivo IS NULL OR length(anulado_motivo) <= 200),
  creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_archivos_paciente ON archivos(paciente_id, creado_en);

-- Certificados, pedidos de estudios y medicación recetada (la receta se hace en MisRx; acá se anota).
-- El PDF emitido se guarda tal cual: la re-descarga es idéntica.
CREATE TABLE documentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  paciente_id INTEGER NOT NULL REFERENCES pacientes(id),
  consulta_id INTEGER REFERENCES consultas(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('certificado', 'pedido', 'medicacion')),
  datos TEXT NOT NULL CHECK (json_valid(datos)),
  fecha TEXT NOT NULL CHECK (fecha GLOB '[12][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]'),
  pdf_clave TEXT UNIQUE,                    -- certificado y pedido; la medicación no lleva PDF
  pdf_sha256 TEXT CHECK (pdf_sha256 IS NULL OR length(pdf_sha256) = 64),
  anulado_en TEXT,
  anulado_motivo TEXT CHECK (anulado_motivo IS NULL OR length(anulado_motivo) <= 200),
  creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_documentos_paciente ON documentos(paciente_id, creado_en);

-- Patrón común de mediciones, archivos y documentos: no se borran; lo único que cambia es la anulación,
-- una sola vez y con motivo. (El PDF se puede registrar una vez, cuando se genera.)
CREATE TRIGGER mediciones_no_delete BEFORE DELETE ON mediciones
WHEN (SELECT valor FROM config WHERE clave = 'restauracion') IS NOT '1'
BEGIN SELECT RAISE(ABORT, 'Una medición no se borra: se anula'); END;
CREATE TRIGGER mediciones_solo_anular BEFORE UPDATE ON mediciones
WHEN (OLD.anulado_en IS NOT NULL OR NEW.anulado_en IS NULL OR NEW.anulado_motivo IS NULL
      OR NEW.paciente_id IS NOT OLD.paciente_id OR NEW.consulta_id IS NOT OLD.consulta_id OR NEW.tipo IS NOT OLD.tipo
      OR NEW.valor IS NOT OLD.valor OR NEW.unidad IS NOT OLD.unidad OR NEW.fecha IS NOT OLD.fecha OR NEW.creado_en IS NOT OLD.creado_en)
  AND (SELECT valor FROM config WHERE clave = 'restauracion') IS NOT '1'
BEGIN SELECT RAISE(ABORT, 'Una medición solo se anula, con motivo'); END;

CREATE TRIGGER archivos_no_delete BEFORE DELETE ON archivos
WHEN (SELECT valor FROM config WHERE clave = 'restauracion') IS NOT '1'
BEGIN SELECT RAISE(ABORT, 'Un archivo no se borra: se anula'); END;
CREATE TRIGGER archivos_solo_anular BEFORE UPDATE ON archivos
WHEN (OLD.anulado_en IS NOT NULL OR NEW.anulado_en IS NULL OR NEW.anulado_motivo IS NULL
      OR NEW.paciente_id IS NOT OLD.paciente_id OR NEW.consulta_id IS NOT OLD.consulta_id OR NEW.tipo IS NOT OLD.tipo
      OR NEW.nombre IS NOT OLD.nombre OR NEW.clave IS NOT OLD.clave OR NEW.mime IS NOT OLD.mime
      OR NEW.tamano IS NOT OLD.tamano OR NEW.sha256 IS NOT OLD.sha256 OR NEW.creado_en IS NOT OLD.creado_en)
  AND (SELECT valor FROM config WHERE clave = 'restauracion') IS NOT '1'
BEGIN SELECT RAISE(ABORT, 'Un archivo solo se anula, con motivo'); END;

CREATE TRIGGER documentos_no_delete BEFORE DELETE ON documentos
WHEN (SELECT valor FROM config WHERE clave = 'restauracion') IS NOT '1'
BEGIN SELECT RAISE(ABORT, 'Un documento no se borra: se anula'); END;
CREATE TRIGGER documentos_solo_anular_o_pdf BEFORE UPDATE ON documentos
WHEN NOT (
    -- registrar el PDF una sola vez
    (OLD.pdf_clave IS NULL AND NEW.pdf_clave IS NOT NULL AND NEW.pdf_sha256 IS NOT NULL
      AND NEW.anulado_en IS OLD.anulado_en AND NEW.anulado_motivo IS OLD.anulado_motivo)
    -- o anular una sola vez, con motivo
    OR (OLD.anulado_en IS NULL AND NEW.anulado_en IS NOT NULL AND NEW.anulado_motivo IS NOT NULL
      AND NEW.pdf_clave IS OLD.pdf_clave AND NEW.pdf_sha256 IS OLD.pdf_sha256))
  OR NEW.paciente_id IS NOT OLD.paciente_id OR NEW.consulta_id IS NOT OLD.consulta_id OR NEW.tipo IS NOT OLD.tipo
  OR NEW.datos IS NOT OLD.datos OR NEW.fecha IS NOT OLD.fecha OR NEW.creado_en IS NOT OLD.creado_en
BEGIN SELECT RAISE(ABORT, 'Un documento emitido no se modifica: se anula con motivo'); END;

-- ============================================================================================
-- Cobros, pagos y comprobantes
-- ============================================================================================
-- Particular: importe de la prestación (editable), puede ser 0 («Sin cargo»). Obra social: el importe es el copago (0 u otro).
CREATE TABLE cobros (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  paciente_id INTEGER NOT NULL REFERENCES pacientes(id),
  turno_id INTEGER REFERENCES turnos(id),
  prestacion_id INTEGER REFERENCES prestaciones(id),
  consultorio_id INTEGER REFERENCES consultorios(id),
  cobertura TEXT NOT NULL DEFAULT 'particular' CHECK (cobertura IN ('particular', 'obra_social')),
  obra_social_id INTEGER REFERENCES obras_sociales(id),
  concepto TEXT NOT NULL CHECK (length(concepto) BETWEEN 1 AND 120),
  importe INTEGER NOT NULL CHECK (importe BETWEEN 0 AND 100000000),
  origen TEXT NOT NULL DEFAULT 'atencion' CHECK (origen IN ('atencion', 'ausencia', 'cancelacion_tardia')),
  fecha TEXT NOT NULL CHECK (fecha GLOB '[12][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]'),
  perdonado_en TEXT,                        -- cobro por ausencia perdonado, con motivo
  perdonado_motivo TEXT CHECK (perdonado_motivo IS NULL OR length(perdonado_motivo) <= 200),
  anulado_en TEXT,
  anulado_motivo TEXT CHECK (anulado_motivo IS NULL OR length(anulado_motivo) <= 200),
  creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  CHECK (cobertura IS NOT 'obra_social' OR obra_social_id IS NOT NULL),
  CHECK ((perdonado_en IS NULL) = (perdonado_motivo IS NULL)),
  CHECK ((anulado_en IS NULL) = (anulado_motivo IS NULL)),
  CHECK (perdonado_en IS NULL OR origen <> 'atencion')
);
CREATE INDEX idx_cobros_paciente ON cobros(paciente_id, fecha);
CREATE INDEX idx_cobros_fecha ON cobros(fecha);
CREATE UNIQUE INDEX ux_cobro_vigente_por_turno ON cobros(turno_id, origen) WHERE turno_id IS NOT NULL AND anulado_en IS NULL;

CREATE TRIGGER cobros_no_delete BEFORE DELETE ON cobros
WHEN (SELECT valor FROM config WHERE clave = 'restauracion') IS NOT '1'
BEGIN SELECT RAISE(ABORT, 'Un cobro no se borra: se anula'); END;
CREATE TRIGGER cobros_nace_vigente BEFORE INSERT ON cobros
WHEN (NEW.anulado_en IS NOT NULL OR NEW.perdonado_en IS NOT NULL) AND (SELECT valor FROM config WHERE clave = 'restauracion') IS NOT '1'
BEGIN SELECT RAISE(ABORT, 'Un cobro nuevo nace vigente'); END;
CREATE TRIGGER cobros_solo_anular_o_perdonar BEFORE UPDATE ON cobros
WHEN (OLD.anulado_en IS NOT NULL
      OR (OLD.perdonado_en IS NOT NULL AND NEW.perdonado_en IS NOT OLD.perdonado_en)
      OR NEW.paciente_id IS NOT OLD.paciente_id OR NEW.turno_id IS NOT OLD.turno_id OR NEW.prestacion_id IS NOT OLD.prestacion_id
      OR NEW.consultorio_id IS NOT OLD.consultorio_id OR NEW.cobertura IS NOT OLD.cobertura OR NEW.obra_social_id IS NOT OLD.obra_social_id
      OR NEW.concepto IS NOT OLD.concepto OR NEW.importe IS NOT OLD.importe OR NEW.origen IS NOT OLD.origen
      OR NEW.fecha IS NOT OLD.fecha OR NEW.creado_en IS NOT OLD.creado_en)
  AND (SELECT valor FROM config WHERE clave = 'restauracion') IS NOT '1'
BEGIN SELECT RAISE(ABORT, 'Un cobro no se modifica: se anula (o se perdona) con motivo'); END;
CREATE TRIGGER cobros_anular_sin_pagos BEFORE UPDATE OF anulado_en ON cobros
WHEN NEW.anulado_en IS NOT NULL AND EXISTS (SELECT 1 FROM pagos WHERE cobro_id = NEW.id AND anulado_en IS NULL)
  AND (SELECT valor FROM config WHERE clave = 'restauracion') IS NOT '1'
BEGIN SELECT RAISE(ABORT, 'Un cobro con pagos no se anula: primero se anulan los pagos'); END;
CREATE TRIGGER cobros_paciente_activo BEFORE INSERT ON cobros
WHEN (SELECT baja_en FROM pacientes WHERE id = NEW.paciente_id) IS NOT NULL AND (SELECT valor FROM config WHERE clave = 'restauracion') IS NOT '1'
BEGIN SELECT RAISE(ABORT, 'Paciente dado de baja: no se le cargan cobros'); END;

CREATE TABLE pagos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cobro_id INTEGER NOT NULL REFERENCES cobros(id),
  importe INTEGER NOT NULL CHECK (importe BETWEEN 1 AND 100000000),
  medio TEXT NOT NULL CHECK (medio IN ('efectivo', 'transferencia', 'tarjeta', 'otro')),
  fecha TEXT NOT NULL CHECK (fecha GLOB '[12][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]'),
  clave_unica TEXT UNIQUE,                  -- el doble clic no duplica
  anulado_en TEXT,
  anulado_motivo TEXT CHECK (anulado_motivo IS NULL OR length(anulado_motivo) <= 200),
  creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  CHECK ((anulado_en IS NULL) = (anulado_motivo IS NULL))
);
CREATE INDEX idx_pagos_cobro ON pagos(cobro_id);
CREATE INDEX idx_pagos_fecha ON pagos(fecha);

CREATE TRIGGER pagos_no_delete BEFORE DELETE ON pagos
WHEN (SELECT valor FROM config WHERE clave = 'restauracion') IS NOT '1'
BEGIN SELECT RAISE(ABORT, 'Un pago no se borra: se anula'); END;
CREATE TRIGGER pagos_nace_vigente BEFORE INSERT ON pagos
WHEN NEW.anulado_en IS NOT NULL AND (SELECT valor FROM config WHERE clave = 'restauracion') IS NOT '1'
BEGIN SELECT RAISE(ABORT, 'Un pago nuevo nace vigente'); END;
CREATE TRIGGER pagos_solo_anular BEFORE UPDATE ON pagos
WHEN (OLD.anulado_en IS NOT NULL OR NEW.anulado_en IS NULL
      OR NEW.cobro_id IS NOT OLD.cobro_id OR NEW.importe IS NOT OLD.importe OR NEW.medio IS NOT OLD.medio
      OR NEW.fecha IS NOT OLD.fecha OR NEW.clave_unica IS NOT OLD.clave_unica OR NEW.creado_en IS NOT OLD.creado_en)
  AND (SELECT valor FROM config WHERE clave = 'restauracion') IS NOT '1'
BEGIN SELECT RAISE(ABORT, 'Un pago solo se anula, con motivo'); END;
CREATE TRIGGER pagos_cobro_vigente BEFORE INSERT ON pagos
WHEN (SELECT anulado_en IS NOT NULL OR perdonado_en IS NOT NULL FROM cobros WHERE id = NEW.cobro_id)
  AND (SELECT valor FROM config WHERE clave = 'restauracion') IS NOT '1'
BEGIN SELECT RAISE(ABORT, 'El cobro está anulado o perdonado'); END;
CREATE TRIGGER pagos_sin_exceso BEFORE INSERT ON pagos
WHEN (SELECT COALESCE(SUM(importe), 0) FROM pagos WHERE cobro_id = NEW.cobro_id AND anulado_en IS NULL) + NEW.importe
     > (SELECT importe FROM cobros WHERE id = NEW.cobro_id)
  AND (SELECT valor FROM config WHERE clave = 'restauracion') IS NOT '1'
BEGIN SELECT RAISE(ABORT, 'El pago supera el saldo del cobro'); END;
-- Anular un pago con comprobante obliga a anular el comprobante interno (o pedir la nota de crédito) en el mismo paso:
-- el pago solo se anula si su comprobante ya no está vigente.
CREATE TRIGGER pagos_anular_con_comprobante BEFORE UPDATE OF anulado_en ON pagos
WHEN NEW.anulado_en IS NOT NULL AND EXISTS (
    SELECT 1 FROM comprobantes c WHERE c.pago_id = NEW.id AND c.tipo IN ('interno', 'factura_c') AND c.estado IN ('emitido', 'pendiente')
      AND NOT EXISTS (SELECT 1 FROM comprobantes nc WHERE nc.asociado_id = c.id AND nc.tipo = 'nota_credito_c'))
  AND (SELECT valor FROM config WHERE clave = 'restauracion') IS NOT '1'
BEGIN SELECT RAISE(ABORT, 'Primero hay que anular el comprobante (o emitir la nota de crédito)'); END;

-- Un comprobante por pago: interno (numeración propia) o factura C de ARCA; la factura se compensa con nota de crédito C.
CREATE TABLE comprobantes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pago_id INTEGER NOT NULL REFERENCES pagos(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('interno', 'factura_c', 'nota_credito_c')),
  punto_venta INTEGER,                      -- facturas de ARCA
  numero INTEGER,                           -- interno: correlativo propio; ARCA: el que asigna ARCA
  asociado_id INTEGER REFERENCES comprobantes(id),        -- la nota de crédito apunta a su factura
  receptor_nombre TEXT NOT NULL CHECK (length(receptor_nombre) BETWEEN 1 AND 160),
  receptor_doc_tipo TEXT NOT NULL CHECK (receptor_doc_tipo IN ('dni', 'cuit')),
  receptor_doc TEXT NOT NULL CHECK (length(receptor_doc) BETWEEN 6 AND 11 AND receptor_doc NOT GLOB '*[^0-9]*'),
  importe INTEGER NOT NULL CHECK (importe BETWEEN 1 AND 100000000),
  fecha TEXT NOT NULL CHECK (fecha GLOB '[12][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]'),
  cae TEXT CHECK (cae IS NULL OR (length(cae) = 14 AND cae NOT GLOB '*[^0-9]*')),
  cae_vence TEXT CHECK (cae_vence IS NULL OR cae_vence GLOB '[12][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]'),
  estado TEXT NOT NULL CHECK (estado IN ('emitido', 'pendiente', 'anulado')),
  anulado_en TEXT,
  anulado_motivo TEXT CHECK (anulado_motivo IS NULL OR length(anulado_motivo) <= 200),
  pdf_clave TEXT UNIQUE,
  pdf_sha256 TEXT CHECK (pdf_sha256 IS NULL OR length(pdf_sha256) = 64),
  intentos INTEGER NOT NULL DEFAULT 0,      -- reintentos con ARCA
  ultimo_error TEXT CHECK (ultimo_error IS NULL OR length(ultimo_error) <= 500),
  creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  CHECK (tipo = 'interno' OR punto_venta IS NOT NULL),
  CHECK (tipo <> 'interno' OR (numero IS NOT NULL AND cae IS NULL AND estado <> 'pendiente')),
  CHECK (tipo = 'interno' OR estado <> 'anulado'),        -- la factura no se anula: se compensa
  CHECK ((tipo = 'nota_credito_c') = (asociado_id IS NOT NULL)),
  CHECK (tipo = 'interno' OR estado <> 'emitido' OR (cae IS NOT NULL AND cae_vence IS NOT NULL AND numero IS NOT NULL)),
  CHECK ((estado = 'anulado') = (anulado_en IS NOT NULL AND anulado_motivo IS NOT NULL))
);
CREATE UNIQUE INDEX ux_comprobante_por_pago ON comprobantes(pago_id) WHERE tipo IN ('interno', 'factura_c');
CREATE UNIQUE INDEX ux_comprobante_interno_numero ON comprobantes(numero) WHERE tipo = 'interno';
CREATE UNIQUE INDEX ux_comprobante_arca_numero ON comprobantes(tipo, punto_venta, numero) WHERE tipo <> 'interno' AND numero IS NOT NULL;
CREATE UNIQUE INDEX ux_nota_credito_unica ON comprobantes(asociado_id) WHERE tipo = 'nota_credito_c';
CREATE INDEX idx_comprobantes_fecha ON comprobantes(fecha);

CREATE TRIGGER comprobantes_no_delete BEFORE DELETE ON comprobantes
WHEN (SELECT valor FROM config WHERE clave = 'restauracion') IS NOT '1'
BEGIN SELECT RAISE(ABORT, 'Un comprobante no se borra'); END;
CREATE TRIGGER comprobantes_pago_vigente BEFORE INSERT ON comprobantes
WHEN NEW.tipo IN ('interno', 'factura_c') AND (SELECT anulado_en FROM pagos WHERE id = NEW.pago_id) IS NOT NULL
  AND (SELECT valor FROM config WHERE clave = 'restauracion') IS NOT '1'
BEGIN SELECT RAISE(ABORT, 'No se emite comprobante de un pago anulado'); END;
CREATE TRIGGER comprobantes_importe_del_pago BEFORE INSERT ON comprobantes
WHEN NEW.importe <> (SELECT importe FROM pagos WHERE id = NEW.pago_id) AND (SELECT valor FROM config WHERE clave = 'restauracion') IS NOT '1'
BEGIN SELECT RAISE(ABORT, 'El comprobante es por el importe del pago'); END;
CREATE TRIGGER comprobantes_nc_de_factura BEFORE INSERT ON comprobantes
WHEN NEW.tipo = 'nota_credito_c' AND (SELECT tipo FROM comprobantes WHERE id = NEW.asociado_id) IS NOT 'factura_c'
BEGIN SELECT RAISE(ABORT, 'La nota de crédito compensa una factura C'); END;
CREATE TRIGGER comprobantes_nace_valido BEFORE INSERT ON comprobantes
WHEN NEW.estado = 'anulado' AND (SELECT valor FROM config WHERE clave = 'restauracion') IS NOT '1'
BEGIN SELECT RAISE(ABORT, 'Un comprobante nace emitido o pendiente'); END;
-- Cambios permitidos: interno emitido → anulado (con motivo); ARCA pendiente → emitido (con CAE) o un reintento;
-- registrar el PDF una vez. Nada más.
CREATE TRIGGER comprobantes_inmutables BEFORE UPDATE ON comprobantes
WHEN (NEW.pago_id IS NOT OLD.pago_id OR NEW.tipo IS NOT OLD.tipo OR NEW.asociado_id IS NOT OLD.asociado_id
      OR NEW.receptor_nombre IS NOT OLD.receptor_nombre OR NEW.receptor_doc_tipo IS NOT OLD.receptor_doc_tipo
      OR NEW.receptor_doc IS NOT OLD.receptor_doc OR NEW.importe IS NOT OLD.importe OR NEW.creado_en IS NOT OLD.creado_en
      OR NEW.punto_venta IS NOT OLD.punto_venta
      OR (OLD.pdf_clave IS NOT NULL AND (NEW.pdf_clave IS NOT OLD.pdf_clave OR NEW.pdf_sha256 IS NOT OLD.pdf_sha256))
      OR (OLD.estado = 'anulado')
      OR (OLD.estado = 'emitido' AND NEW.estado = 'emitido' AND (NEW.numero IS NOT OLD.numero OR NEW.fecha IS NOT OLD.fecha OR NEW.cae IS NOT OLD.cae OR NEW.cae_vence IS NOT OLD.cae_vence))
      OR (OLD.estado = 'emitido' AND NEW.estado = 'pendiente')
      OR (OLD.estado = 'pendiente' AND NEW.estado = 'anulado'))
  AND (SELECT valor FROM config WHERE clave = 'restauracion') IS NOT '1'
BEGIN SELECT RAISE(ABORT, 'Un comprobante emitido no se modifica'); END;

-- Envíos al paciente (comprobantes, documentos, datos de pago, avisos): por dónde y a quién.
CREATE TABLE envios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  que TEXT NOT NULL CHECK (que IN ('comprobante', 'documento', 'datos_pago', 'recordatorio', 'aviso_turno', 'propuesta')),
  objeto_id INTEGER,
  paciente_id INTEGER REFERENCES pacientes(id),
  canal TEXT NOT NULL CHECK (canal IN ('whatsapp', 'correo', 'descarga')),
  destino TEXT CHECK (destino IS NULL OR length(destino) <= 200),
  estado TEXT NOT NULL DEFAULT 'enviado' CHECK (estado IN ('enviado', 'fallido')),
  creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_envios_objeto ON envios(que, objeto_id);

-- «Enviar a la contadora»: período, a quién y totales. Sin datos clínicos.
CREATE TABLE envios_contadora (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  desde TEXT NOT NULL CHECK (desde GLOB '[12][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]'),
  hasta TEXT NOT NULL CHECK (hasta GLOB '[12][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]'),
  para TEXT,                                -- vacío = solo descargó la planilla
  cobrado INTEGER NOT NULL,
  facturado INTEGER NOT NULL,
  sin_factura INTEGER NOT NULL,
  creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  CHECK (desde <= hasta)
);

-- ============================================================================================
-- Auditoría, campanita y respaldos
-- ============================================================================================
CREATE TABLE auditoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evento TEXT NOT NULL,
  detalle TEXT,
  usuario TEXT,
  ip_huella TEXT,
  en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_auditoria_en ON auditoria(en);
CREATE TRIGGER auditoria_no_update BEFORE UPDATE ON auditoria
WHEN (SELECT valor FROM config WHERE clave = 'restauracion') IS NOT '1'
BEGIN SELECT RAISE(ABORT, 'La auditoría no se modifica'); END;
CREATE TRIGGER auditoria_no_delete BEFORE DELETE ON auditoria
WHEN (SELECT valor FROM config WHERE clave = 'restauracion') IS NOT '1'
BEGIN SELECT RAISE(ABORT, 'La auditoría no se borra'); END;

-- Avisos de la campanita. Nunca llevan motivo de consulta ni datos clínicos.
CREATE TABLE notificaciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL CHECK (tipo IN ('pedido', 'no_puede_ir', 'confirmo', 'factura_pendiente', 'correo_rechazado', 'pedido_vencido', 'sistema')),
  texto TEXT NOT NULL CHECK (length(texto) BETWEEN 1 AND 300),
  enlace TEXT CHECK (enlace IS NULL OR (length(enlace) <= 300 AND enlace LIKE '/%')),
  leida_en TEXT,
  creada_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_notificaciones ON notificaciones(leida_en, creada_en);

CREATE TABLE respaldos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clave TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  tamano INTEGER NOT NULL,
  creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ============================================================================================
-- Vistas de lectura
-- ============================================================================================
-- Saldo y estado de cada cobro. «Cobrado» = pagos vigentes; «Te deben» = saldo.
CREATE VIEW v_cobros AS
SELECT c.*,
  COALESCE((SELECT SUM(p.importe) FROM pagos p WHERE p.cobro_id = c.id AND p.anulado_en IS NULL), 0) AS pagado,
  CASE WHEN c.anulado_en IS NOT NULL OR c.perdonado_en IS NOT NULL THEN 0
       ELSE c.importe - COALESCE((SELECT SUM(p.importe) FROM pagos p WHERE p.cobro_id = c.id AND p.anulado_en IS NULL), 0) END AS saldo,
  CASE WHEN c.anulado_en IS NOT NULL THEN 'anulado'
       WHEN c.perdonado_en IS NOT NULL THEN 'perdonado'
       WHEN c.importe = 0 THEN 'sin_cargo'
       WHEN COALESCE((SELECT SUM(p.importe) FROM pagos p WHERE p.cobro_id = c.id AND p.anulado_en IS NULL), 0) >= c.importe THEN 'pagado'
       WHEN COALESCE((SELECT SUM(p.importe) FROM pagos p WHERE p.cobro_id = c.id AND p.anulado_en IS NULL), 0) > 0 THEN 'parcial'
       ELSE 'debe' END AS estado
FROM cobros c;

-- Paciente con sus marcas: ficha incompleta, saldo, último y próximo turno, faltas y veces que vino.
CREATE VIEW v_pacientes AS
SELECT p.*,
  CASE WHEN p.fecha_nacimiento IS NULL OR p.domicilio IS NULL OR p.ocupacion IS NULL OR p.cobertura IS NULL THEN 0 ELSE 1 END AS ficha_completa,
  COALESCE((SELECT SUM(saldo) FROM v_cobros vc WHERE vc.paciente_id = p.id), 0) AS saldo,
  (SELECT COUNT(*) FROM turnos t WHERE t.paciente_id = p.id AND t.estado = 'atendido') AS veces_vino,
  (SELECT COUNT(*) FROM turnos t WHERE t.paciente_id = p.id AND t.estado = 'ausente') AS faltas,
  (SELECT MAX(t.fecha) FROM turnos t WHERE t.paciente_id = p.id AND t.estado = 'atendido') AS ultimo_turno,
  (SELECT t.fecha || ' ' || t.hora FROM turnos t WHERE t.paciente_id = p.id AND t.estado IN ('confirmado', 'solicitado')
     ORDER BY t.fecha, t.hora LIMIT 1) AS proximo_turno
FROM pacientes p;
