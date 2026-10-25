# SiroConsultas v2: lo definido antes de programar

Esta carpeta junta lo aprobado el 23/10 para rehacer SiroConsultas desde cero. Es el punto de partida de la sesión que programa: primero se lee esto y después se arranca por la etapa 0.

| Archivo | Qué es |
|---|---|
| [`ANALISIS_FUNCIONAL.md`](ANALISIS_FUNCIONAL.md) | Análisis funcional v2 aprobado: decisiones, ciclo del turno, los 15 flujos con sus casos, entidades, reglas de negocio y etapas |
| [`DISENO_APROBADO.md`](DISENO_APROBADO.md) | Registro de diseño: base visual y lo que se aprobó de cada pantalla |
| [`pantallas/`](pantallas/) | Fuentes de cada pantalla del tablero (`.dc.html`) y su índice (`canvas.json`) |

Tablero de pantallas para verlas e interactuar: https://claude.ai/artifact/J6jZgJy4gaAuEqsae9dZFq. Los `.dc.html` necesitan el visor del tablero para abrirse; acá están como referencia del marcado, los textos y el comportamiento de cada pantalla (la lógica de cada una está en el bloque `<script type="text/x-dc">` del final).

## Decisiones clave

- **Se rehace desde cero en Cloudflare:** Workers, D1 y R2, con TypeScript y Hono. Del sistema anterior se toman solo las ideas (segundo factor, respaldos cifrados, inmutabilidad con triggers, las pruebas como lista de casos).
- **El DNI es el identificador único del paciente.** Va en el alta rápida (DNI, nombre, apellido, celular y correo opcional). Si el DNI ya existe, se usa esa ficha: no hay fichas duplicadas.
- **Todo turno, consulta y cobro pertenece a una ficha.** No existe el turno sin ficha.
- **La app no mueve plata.** La profesional registra los pagos a mano; puede mandarle al paciente sus datos para transferir (alias, CBU, titular, QR opcional). Sin señas ni pagos online: el botón de Mercado Pago de la app del paciente solo redirige.
- **Un comprobante por pago:** comprobante interno (con su diseño y la leyenda «Documento no válido como factura») o factura C de ARCA. El interno se anula con motivo; la factura se compensa con nota de crédito C. Si ARCA no responde, el pago se guarda y la factura queda pendiente.
- **La app del paciente es solo por invitación:** enlace de la profesional, usuario = DNI, contraseña y aceptación de términos.
- **Una sola profesional, sin roles.** Lo clínico y lo financiero no se borra: se anula con motivo.

## Estado de las pantallas

| # | Pantalla | Archivo | Estado |
|---|---|---|---|
| 1 | Hoy | `Main.dc.html` | Aprobada |
| 2 | Dar turno con ficha mínima | `DarTurno.dc.html` | Aprobada |
| 3 | Cobrar, comprobante y datos de pago | `Cobrar.dc.html` | Aprobada |
| 4 | Comprobante: interno o factura C | `Comprobante.dc.html` | Aprobada |
| 5 | Bloquear la agenda | `Bloqueo.dc.html` | Aprobada |
| 6 | Pedidos de turno online | `Pedidos.dc.html` | Aprobada |
| 7 | Enviar a la contadora | `Contadora.dc.html` | Aprobada |
| 8 | Agenda (día, semana, mes) | `Agenda.dc.html` | Aprobada |
| 9 | Pacientes | `Pacientes.dc.html` | Aprobada |
| 10 | Ficha del paciente (con «Mandar el enlace» de la app) | `Ficha.dc.html` | Aprobada |
| 11 | Consulta: primera vez o control | `Consulta.dc.html` | Aprobada |
| 12 | Estadísticas | `Estadisticas.dc.html` | Aprobada |
| 13 | Configuración | `Configuracion.dc.html` | Aprobada |
| 14 | Términos y privacidad al entrar | `Terminos.dc.html` | Aprobada |
| 15 | Hoy en el celular | `HoyCel.dc.html` | Aprobada |
| 16 | App del paciente | `AppPaciente.dc.html` | Aprobada |
| 17 | Agenda en el celular | `AgendaCel.dc.html` | **En revisión: no programar todavía** |
| 18 | Pacientes en el celular | `PacientesCel.dc.html` | **En revisión: no programar todavía** |
| 19 | Pedidos en el celular | `PedidosCel.dc.html` | **En revisión: no programar todavía** |

Las pantallas 1 a 16 están aprobadas. Agenda, Pacientes y Pedidos en el celular esperan la revisión de Belén. En la app del paciente, «Pagar con Mercado Pago» solo redirige a Mercado Pago: la app no mueve plata. Los documentos no aparecen en la app: le llegan al paciente solo por WhatsApp.

## Para quien programa

- Arrancar por la **etapa 0** del análisis: repositorio madre nuevo, esquema de datos completo, ingreso con segundo factor, componentes, pruebas y despliegue automático. Después, las etapas 1 a 5 en orden.
- La paleta aprobada (estilo «Nube») está escrita con hex en las pantallas porque son maquetas. En el código nuevo va como variables de color, nunca hex sueltos.
- Lo que no esté en estos documentos no se inventa: se le pregunta a Belén.
- Todos los datos de las pantallas son ficticios.
