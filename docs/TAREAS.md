# Tareas y reparto

Una tarea = una rama = un PR. Estado: pendiente · en curso · en revisión · hecha. Las etapas son las del análisis («Alcance por etapas»).

| # | Tarea | Quién | Estado |
|---|---|---|---|
| E0 | **Etapa 0 · base del repositorio madre:** esquema completo de la base con sus triggers, ingreso con Google y segundo código, componentes del estilo «Nube», pruebas (base, app y punta a punta) y despliegue automático | Claude | en revisión |
| E1 | **Etapa 1 · base ordenada:** pacientes (alta rápida con DNI, lista con filtros, ficha), dar turno, agenda (día, semana, mes), bloqueos y feriados con «¿atendés?», turnos que se repiten, Hoy completo, consulta e historia clínica | — | pendiente |
| E2 | **Etapa 2 · comprobante interno:** cobrar, datos fiscales, comprobante interno por pago con numeración, anulación con el pago, envío por WhatsApp o correo, enviar a la contadora | — | pendiente |
| E3 | **Etapa 3 · puerta de producción:** términos y privacidad (texto del abogado), aceptación al entrar, staging, simulacro de restauración, dominio propio, repositorios de cliente | — | pendiente |
| E4 | **Etapa 4 · factura C de ARCA** con nota de crédito, pendientes y reintentos | — | pendiente |
| E5 | **Etapa 5 · autogestión del paciente:** pedido de turno online, cobro por ausencia, estadísticas por rango y consultorio | — | pendiente |

Las pantallas del celular (Hoy en el celular y la app del paciente) siguen en diseño: no se programan hasta que se aprueben.

## Preguntas abiertas para Belén
- **Pedido online de un paciente sin ficha:** el análisis dice que todo turno pertenece a una ficha y que, si el paciente nunca vino, la ficha se crea al aceptar. El esquema lo resuelve con una tabla de pedidos aparte (`pedidos`) que retiene el hueco hasta que la profesional responde; al aceptar nace la ficha (o se vincula por DNI) y el turno. Hay que confirmar si también un paciente conocido pasa por esa tabla o queda como turno «Solicitado».
- **Largo del DNI:** se aceptan de 6 a 10 números, para no dejar afuera documentos viejos o de extranjeros. ¿Va bien así?
- **Duración de la sesión:** se cierra sola a las 12 horas. ¿Va bien así o preferís otro plazo?
