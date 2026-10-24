-- X4: foto de los datos y del diseño al emitir. No cambia el contrato de anulación de P4.
ALTER TABLE comprobantes ADD COLUMN foto TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(foto));
CREATE TRIGGER comprobantes_foto_inmutable BEFORE UPDATE OF foto ON comprobantes
WHEN NEW.foto IS NOT OLD.foto AND (SELECT valor FROM config WHERE clave='restauracion') IS NOT '1'
BEGIN SELECT RAISE(ABORT, 'La foto del comprobante no se modifica'); END;
-- El número y la fecha tampoco pueden cambiar al pasar de emitido a anulado.
CREATE TRIGGER comprobantes_interno_numero_inmutable BEFORE UPDATE ON comprobantes
WHEN OLD.tipo='interno' AND (NEW.numero IS NOT OLD.numero OR NEW.fecha IS NOT OLD.fecha)
  AND (SELECT valor FROM config WHERE clave='restauracion') IS NOT '1'
BEGIN SELECT RAISE(ABORT, 'El número y la fecha del comprobante interno no se modifican'); END;

-- D1 limita los patrones GLOB: el CHECK original del color supera ese límite.
-- SQLite requiere reconstruir la tabla para cambiar un CHECK. Se copian todas sus columnas;
-- no hay claves foráneas que apunten a profesional, y se restituye su protección de borrado.
CREATE TABLE profesional_x4 (
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
  comprobante_color TEXT CHECK (comprobante_color IS NULL OR (length(comprobante_color)=7 AND substr(comprobante_color,1,1)='#' AND substr(comprobante_color,2) NOT GLOB '*[^0-9A-Fa-f]*')),
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
INSERT INTO profesional_x4 SELECT * FROM profesional;
DROP TRIGGER profesional_no_se_borra;
DROP TABLE profesional;
ALTER TABLE profesional_x4 RENAME TO profesional;
CREATE TRIGGER profesional_no_se_borra BEFORE DELETE ON profesional
WHEN (SELECT valor FROM config WHERE clave='restauracion') IS NOT '1'
BEGIN SELECT RAISE(ABORT, 'El perfil no se borra'); END;
