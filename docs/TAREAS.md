# Tareas y reparto

Una tarea = una rama = un PR. Estado: pendiente · en curso · en revisión · hecha. Las etapas son las del análisis («Alcance por etapas»).

| # | Tarea | Quién | Estado |
|---|---|---|---|
| E0 | **Etapa 0 · base del repositorio madre:** esquema completo de la base con sus triggers, ingreso con Google y segundo código, componentes del estilo «Nube», pruebas y despliegue automático | Claude | hecha |
| E1 | **Etapa 1 · base ordenada** (repartida abajo en tres tandas) | Claude y Codex | hecha |
| E2 | **Etapa 2 · comprobante interno:** cobrar, datos fiscales, comprobante interno por pago con numeración, anulación con el pago, envío por WhatsApp o correo, enviar a la contadora (repartida abajo en dos tandas) | Claude y Codex | en curso |
| E3 | **Etapa 3 · puerta de producción:** términos y privacidad (texto del abogado), aceptación al entrar, staging, simulacro de restauración, dominio propio, repositorios de cliente | — | pendiente |
| E4 | **Etapa 4 · factura C de ARCA** con nota de crédito, pendientes y reintentos | — | pendiente |
| E5 | **Etapa 5 · autogestión del paciente:** pedido de turno online, cobro por ausencia, estadísticas por rango y consultorio | — | pendiente |

Las pantallas del celular (Hoy en el celular y la app del paciente) siguen en diseño: no se programan hasta que se aprueben.

## Etapa 1: reparto entre Claude y Codex

Cada tanda tiene una tarea para cada uno, que se pueden hacer en paralelo. Una tanda empieza cuando la anterior está unida, porque usa lo que dejó. Cada tarea arma su pantalla siguiendo su maqueta aprobada (`docs/pantallas/`) y lo escrito en `docs/DISENO_APROBADO.md`.

| # | Tanda | Tarea | Maquetas | Quién | Estado |
|---|---|---|---|---|---|
| P1 | 1 | **Pacientes:** lista con buscador (nombre, DNI o celular, sin importar tildes), filtros con cantidad (Todos, Te deben, Control vencido, Sin próximo turno, Primera consulta, Ficha incompleta, Dados de baja) y orden; alta rápida (DNI, nombre, apellido, celular, correo opcional; si el DNI existe, muestra esa ficha); ficha con sus pestañas (Resumen, Historia clínica, Turnos, Pagos, Documentos: por ahora solo lo que ya hay en la base); editar todos los datos (cambio de DNI con confirmación); dar de baja con motivo (cancela turnos próximos; si debe, no deja) y reactivar | `Pacientes`, `Ficha` | Claude | hecha |
| X1 | 1 | **Configuración:** se entra por la foto; menú de siete secciones. Esta tarea hace cuatro: Tu perfil (foto en R2, nombre, especialidad, matrícula, WhatsApp, correo); Consultorios y horarios (agregar, editar horarios por día con mañana y tarde, apagar); Prestaciones (nombre, duración, importe, activa; 0 = «Sin cargo»); Obras sociales (catálogo con buscador, usar y dejar de usar). Las otras tres secciones (Cobros y comprobantes, Recordatorios, Cuenta y seguridad) quedan visibles como «Próximamente» | `Configuracion` | Codex | hecha |
| P2 | 2 | **Dar turno y agenda:** ventana de tres pasos (paciente con alta rápida, día y hora con huecos por mañana y tarde, guardar con «Repetir» y «Avisarle»); agenda Día, Semana y Mes con consultorio, hoy y hora actual; huecos libres, horas sin atención, bloqueos y feriados rayados; ventana del turno con sus acciones (Mover, Cancelar y avisar, No vino, Atender, Darle otro turno, Ver ficha); avisos de superposición y fuera de horario. **Se hizo en dos PR:** P2a = Dar turno; P2b = agenda y ventana del turno | `DarTurno`, `Agenda` | Claude | hecha |
| X2 | 2 | **Consulta e historia clínica:** primera vez (completar la ficha si está incompleta) y control; borrador que se crea al primer guardado y se autoguarda, sin pisarse en dos pestañas (`version`); finalizar con la foto de los datos; aclaraciones; signos vitales y mediciones; adjuntar estudios a R2 con su huella; próximo control; «Empezar consulta sin turno» desde la ficha; la pestaña Historia clínica de la ficha. Los documentos (certificado, pedido, receta) van en una tarea aparte | `Consulta` y la pestaña de `Ficha` | Codex | hecha |
| P3 | 3 | **Bloqueos, feriados y Hoy completo:** bloquear la agenda (desde y hasta, todo el día o franja, consultorio, motivo) y resolver uno por uno los turnos que caen adentro (Mover con 3 horarios sugeridos, Cancelar y avisar); feriados nacionales con «¿Atendés?»; Hoy con «Ahora», Atender y No vino, Para resolver y Controles por agendar | `Bloqueo`, `Main` | Claude | hecha |
| X3 | 3 | **Documentos clínicos y exportar:** certificado y pedido de estudios en PDF con nombre y matrícula (re-descarga idéntica), medicación recetada (MisRx), anular con motivo, «¿Se lo mandás?» (WhatsApp, correo o PDF), pestaña Documentos de la ficha; exportar la historia clínica en ZIP con LEEME y huellas | La pestaña de `Ficha` y las ventanas de `Consulta` | Codex | hecha |

## Etapa 2: reparto entre Claude y Codex

Igual que la etapa 1: una tarea para cada uno por tanda, en paralelo y en archivos propios. La tanda 5 empieza cuando la 4 está unida.

| # | Tanda | Tarea | Maquetas | Quién | Estado |
|---|---|---|---|---|---|
| P4 | 4 | **Cobrar y cobros:** `/cobros/nuevo` paso 1 «¿A quién le cobrás?» («Terminaron y falta cobrar» en ámbar, «Te deben de antes» y «Hoy cobraste $ X»), que se saltea si llega `?turno=`, `?paciente=` o `?consulta=`; paso 2: importe sugerido y editable (particular: la prestación; obra social: el copago, puede ser 0; importe 0 = «Sin cargo», sin pago ni comprobante), «¿Cuánto pagó?» Todo / Una parte (muestra cuánto queda debiendo) / Nada por ahora, «¿Cómo pagó?» y «Guardar pago de $ X» sin duplicar por doble clic (`pagos.clave_unica`); después del pago lleva a `/comprobantes/nuevo?pago=<id>` (X4). Ventana «Enviar datos de pago» (importe, alias, CBU, titular y QR si está cargado, por WhatsApp) con «La app no mueve plata». `/cobros` (menú Cobros): cobros y pagos con búsqueda, «Te deben» y estado. `POST /pagos/:id/anular` con motivo, que en el mismo lote anula su comprobante interno; anular un cobro sin pagos. «Plata de hoy» en Hoy (cobrado y te deben). Pestaña Pagos de la ficha con el enlace a cada comprobante | `Cobrar`, `Main`, pestaña de `Ficha` | Claude | pendiente |
| X4 | 4 | **Comprobante interno:** Configuración → «Cobros y comprobantes»: datos fiscales (CUIT, condición frente al IVA, domicilio, punto de venta; el estado de ARCA solo se lee), datos para transferir (alias, CBU, titular e imagen del QR en R2), diseño del comprobante (logo en R2, color, pie) con vista previa, correo de la contadora y cobro por ausencia (apagado; horas de anticipación). `/comprobantes/nuevo?pago=<id>` (paso 3 de Cobrar): interno o factura C (la factura se ve deshabilitada: «llega en la etapa 4»), a nombre del paciente u otra persona (nombre y DNI o CUIT), emitir con numeración correlativa (`numeradores`, en el mismo lote que el comprobante), y «Ahora no». PDF con logo, color, pie y «Documento no válido como factura» (con el motor PDF de X3), guardado en R2 con su huella: pedirlo de nuevo devuelve el mismo. `/comprobantes/:id`: vista previa, mandarlo por WhatsApp o descargar el PDF y el botón «Anular el pago» (manda a `POST /pagos/:id/anular` de P4) | `Comprobante`, `Configuracion` (sección Cobros y comprobantes) | Codex | en revisión |
| P5 | 5 | **Correo y contadora:** correo saliente para la instalación (SMTP con secretos, como los recordatorios del sistema anterior), «Por correo» en datos de pago, comprobantes y documentos, recordatorio automático por correo 48 h antes; «Enviar a la contadora» (período, totales cobrado / facturado / sin factura, planilla .xlsx con tres hojas Cobros, Pagos y Comprobantes, sin datos clínicos; enviar o solo descargar, copia a la profesional, envíos anteriores); Configuración → «Recordatorios» | `Contadora`, `Configuracion` (sección Recordatorios) | Claude | pendiente |
| X5 | 5 | **Estadísticas:** filtros de período (este mes, el anterior, trimestre, elegir fechas) y consultorio; consultas con la diferencia contra el período anterior, primera vez, pacientes que vuelven, ausencias; gráfico de los últimos 6 meses en SVG sin dependencias (tocar un mes muestra el detalle, «Ver como tabla»); coberturas, ausencias y cancelaciones, por consultorio y tipo de atención; cobros: cobrado, particulares, copagos, te deben, ticket promedio, por prestación, facturado y comprobante interno, por medio de pago; botón «Enviar a la contadora» | `Estadisticas` | Codex | pendiente |

### Lo que se cruza en la tanda 4
- **P4 lleva al comprobante y X4 lo arma:** después de guardar un pago, Cobrar redirige a `/comprobantes/nuevo?pago=<id>`, que es de X4. Si P4 se une primero, la ruta da «Próximamente» (queda en `PROXIMAS` hasta que llegue X4).
- **Anular el pago es de P4:** `POST /pagos/:id/anular` con `motivo`. En el mismo lote anula el comprobante interno del pago (`estado = 'anulado'` con el mismo motivo); los triggers no dejan anular un pago con comprobante vigente. La pantalla del comprobante (X4) solo tiene el botón que manda a esa ruta.
- **Los datos para transferir los carga X4 y los lee P4** directo de la tabla `profesional` (`transferencia_alias`, `transferencia_cbu`, `transferencia_titular`, `transferencia_qr_clave`).
- **El correo llega en la tanda 5 (P5).** En la tanda 4 se manda por WhatsApp o se descarga; P5 suma «Por correo» en todos lados.

### Para no pisarse (vale para todas las tandas)
- **Cada tarea vive en sus propios archivos:** `src/rutas/<tarea>.tsx` y, si hace falta lógica, `src/lib/<tarea>.ts`. Pruebas en `tests/unidad/<tarea>.test.ts` y `tests/e2e/<tarea>.spec.ts` (sumar el nombre a `ARCHIVOS` en `playwright.config.ts`).
- **Archivos compartidos, con el cambio mínimo y avisado en el PR:**
  - `src/index.tsx`: solo agregar la línea `app.route(...)` y sacar la ruta de la lista `PROXIMAS`.
  - `public/estilos.css`: los estilos nuevos van al final, dentro de un bloque con el comentario `/* ---------- <tarea> ---------- */`.
  - `src/ui/componentes.tsx`: un componente nuevo solo si lo van a usar las dos tareas; si es de una sola, va en su propio archivo.
- **La base:** el esquema de la etapa 0 ya tiene cobros, pagos, comprobantes y numeradores. Si a alguien le falta algo, va en una migración aditiva nueva con el número que sigue y se avisa en el PR; P4 usa los números pares y X4 los impares para que no haya dos con el mismo número.
- **Lo que una tarea necesita de la otra de la misma tanda,** se lee de la base con su propia consulta, sin importar el código de la otra. Por ejemplo, Pacientes lista las consultas para la pestaña Historia clínica sin esperar a X2.
- Antes de abrir el PR: `npm run typecheck`, `npm test` y `npm run test:e2e`, todo en verde (reglas completas en `CLAUDE.md` / `AGENTS.md`).

## Preguntas abiertas para Belén
- **Pedido online de un paciente sin ficha:** el análisis dice que todo turno pertenece a una ficha y que, si el paciente nunca vino, la ficha se crea al aceptar. El esquema lo resuelve con una tabla de pedidos aparte (`pedidos`) que retiene el hueco hasta que la profesional responde; al aceptar nace la ficha (o se vincula por DNI) y el turno. Hay que confirmar si también un paciente conocido pasa por esa tabla o queda como turno «Solicitado». (Recién hace falta en la etapa 5).
- **Largo del DNI:** se aceptan de 6 a 10 números, para no dejar afuera documentos viejos o de extranjeros. ¿Va bien así?
- **Duración de la sesión:** se cierra sola a las 12 horas. ¿Va bien así o preferís otro plazo?
