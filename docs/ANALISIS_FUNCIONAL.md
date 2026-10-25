# SiroConsultas: análisis funcional v2

23/10/2026 · Belén (BC Informática) · versión aprobada

> Pasado del documento original (https://claude.ai/artifact/97rHnjLosy9TmtobEngtdV) al repo el 23/10. Ajustes al pasarlo: el diagrama del ciclo del turno quedó como lista; donde el texto dice que el DNI puede faltar al dar el turno, vale lo decidido después el 23/10: **el DNI es obligatorio en el alta rápida y es el identificador único del paciente**. El «Siguiente paso» del final ya está cumplido: la segunda ronda está respondida y el diseño, aprobado (`DISENO_APROBADO.md`). **Mercado Pago:** «Pagar con Mercado Pago» es solo un enlace que lleva al paciente a Mercado Pago (el enlace de cobro de la profesional): la app no cobra, no procesa ni guarda nada del pago. La profesional lo registra a mano cuando ve la plata, como cualquier otro pago (decidido el 25/10).

## Resumen

SiroConsultas le da a una profesional de la salud que trabaja sin secretaria todo lo necesario para gestionarse sola: agenda, pacientes con ficha e historia clínica, cobros con comprobante (interno o factura de ARCA), documentos clínicos y estadísticas. Se instala un sistema por profesional, con su repositorio, su base, su marca y sus módulos.

- **Una sola usuaria:** la profesional, desde la compu o el celular. No hay roles ni cuentas de equipo.
- **El paciente** entra a su app solo si la profesional lo invita (ver «App del paciente»). Ahí ve sus turnos y sus pagos y puede pagar. Recordatorios, comprobantes y documentos le siguen llegando por WhatsApp o correo.
- **Todo paciente tiene ficha.** No hay turnos, atenciones ni cobros de personas sin ficha.
- **Nada clínico ni financiero se borra:** se anula con motivo y queda quién y cuándo.

Este documento reemplaza al [análisis anterior](https://claude.ai/artifact/3xzF7oNaB84uEMcey7GYTq), que queda como foto del código al 23/10. Sigue el formato del análisis de Estudio Aura: decisiones, ciclo del turno, flujos con sus casos, entidades, reglas y etapas. El diseño va en otro hilo, después de aprobar esto.

## Decisiones tomadas (23/10)

Se suman a las definiciones del 20/10 (`docs/PRODUCTO.md`): una profesional, sin roles, módulos por instalación y la especialidad como adaptación del registro clínico.

| Tema | Decisión | Qué implica en el sistema |
| --- | --- | --- |
| Comprobantes | Como en Aura: al cobrar se elige comprobante interno o factura electrónica de ARCA, y se le envía al paciente | Datos fiscales y certificado de ARCA por instalación; un comprobante por pago; el interno se anula con motivo y la factura con nota de crédito. Cambia la definición vigente, que dejaba ARCA afuera |
| Bloqueos de agenda | Como en Aura: desde y hasta, día completo o franja, motivo opcional | Los turnos ya dados en el bloqueo se listan para reprogramar o cancelar avisando; el bloqueo no se ofrece como hueco libre; feriados nacionales marcados y la profesional decide si atiende |
| Ficha obligatoria | Todos los pacientes tienen ficha | Al dar turno a alguien nuevo se crea su ficha con lo mínimo; se termina el «turno sin ficha · primera vez» que hoy existe |
| Turno cerrado sin ficha | No puede pasar | Deja de existir por la regla anterior: toda ausencia o atención queda en una ficha |
| Términos y privacidad | No hay borradores: hay que crearlos | Redactar términos de uso, política de privacidad y consentimiento del paciente para recibir mensajes; revisión jurídica antes de cargar datos reales |
| Instalaciones | Cada cliente tiene su repositorio y su entorno propio | Hace falta una forma de llevar las mejoras del núcleo a cada repositorio sin copiar código a mano (segunda ronda) |

### Acciones rápidas y celular (decidido el 23/10)

Las acciones del flujo principal se hacen en **3 o 4 pasos como máximo**, como en Aura. Un paso es un toque o un dato que hay que escribir; lo que el sistema ya sabe (paciente del turno, prestación, importe) viene cargado. Propuesta de pasos por acción:

| Acción | Pasos | Cómo |
| --- | --- | --- |
| Dar un turno | 3 | Tocar el hueco libre → elegir o crear paciente → guardar (prestación y duración por defecto) |
| Paciente que llega | 1 | «Atender» |
| Finalizar la consulta | 2 | Finalizar → confirmar |
| Registrar el cobro | 3 | Importe sugerido → cuánto pagó y medio → guardar |
| Comprobante | 2 | Interno o ARCA → enviar por WhatsApp o correo |
| Agendar el próximo control | 2 | Elegir día y hora sugeridos → guardar |
| Reprogramar o cancelar | 3 | Abrir el turno → nueva hora o cancelar → avisar al paciente |
| No vino | 2 | Abrir el turno → «No vino» |
| Bloquear la agenda | 3 | Desde y hasta → motivo → guardar (y resolver los turnos que haya) |

En el **celular** la profesional no ve todo: solo lo que necesita hacer rápido sin la compu. Propuesta:

- **Sí en el celular:** agenda de hoy y de los próximos días; dar, mover y cancelar turnos; vino o no vino; registrar cobro y mandar el comprobante; buscar un paciente y ver su resumen (contacto, alergias, última consulta, saldo); mandar un recordatorio; bloquear la agenda; la campanita.
- **Solo en la compu:** escribir la primera consulta y las evoluciones, estudios, documentos clínicos, estadísticas, configuración, prestaciones y obras sociales, exportaciones y respaldos.

### App del paciente (decidido el 23/10)

El paciente tiene una app propia, en el celular, solo con invitación. No es una cuenta de equipo: ve únicamente lo suyo.

- **Cómo llega:** la profesional le manda el enlace por WhatsApp desde Hoy (al tocar un turno) o desde la ficha («Mandar el enlace» / «Reenviar enlace»). El enlace vence y sirve una sola vez (en el diseño, 7 días). Sin enlace no hay cuenta: el ingreso no ofrece «Crear mi cuenta».
- **Alta:** con el enlace, el usuario es su DNI (ya cargado) y elige una contraseña. Lee los términos de uso y la política de privacidad y los acepta para entrar. Se guarda la versión y la fecha.
- **Ingreso:** usuario y contraseña. Si cambian los términos, los vuelve a aceptar al entrar. Si se olvida la contraseña, le llega un código por WhatsApp al celular de su ficha.
- **Qué ve:** su próximo turno (confirmar, pedir otro horario o cancelar), sus turnos anteriores, lo que debe con «Pagar con Mercado Pago» (solo redirige a Mercado Pago; la app no mueve plata), lo que pagó con su comprobante y sus datos (para corregirlos, avisa por WhatsApp).
- **Qué no ve:** nada clínico (historia, notas, diagnósticos). Los documentos (certificados, recetas, pedidos) le llegan solo por WhatsApp y no aparecen en la app.
- **Pedir turno:** el botón abre la misma página de turnos online, con sus datos ya cargados.

## Decisiones de la segunda ronda

Respondidas por Belén el 23/10. Todas quedan como decisión; la 4 y la 10 traen una propuesta de cómo resolverlas.

| # | Tema | Decisión | Qué implica en el sistema |
| --- | --- | --- | --- |
| 1 | Pedido de turno online | Sí, como en Aura: el paciente pide y no queda confirmado hasta que la profesional lo aprueba | Estado «Solicitado»; la profesional acepta, propone otro horario o rechaza; el hueco se retiene durante el plazo de respuesta |
| 2 | Cobro por ausencia o cancelación tardía | Lo configura la profesional | Apagado por defecto; horas de anticipación configurables (24 por defecto); el cargo se perdona con motivo |
| 3 | Recordatorios | WhatsApp con un toque y correo automático | WhatsApp automático (API de Meta) queda para más adelante |
| 4 | Plata | Sin señas y sin mover plata desde la app. La profesional registra el pago a mano y puede mandarle al paciente sus datos para pagar | Botón «Enviar datos de pago»: mensaje por WhatsApp o correo con el importe, alias, CBU y titular, y opcionalmente la imagen del QR de su banco o billetera. Cuando ve la plata, registra el pago. La app nunca guarda claves ni se conecta a cuentas |
| 5 | Factura ARCA | Factura C | Nota de crédito C para anular |
| 6 | Comprobante | A nombre del paciente o de otra persona; además, un comprobante interno con diseño propio | El interno lleva logo, colores y un texto al pie que elige la profesional, y la leyenda «No válido como factura» |
| 7 | Datos mínimos al dar turno | Nombre, apellido, celular y correo | El correo se pide para recordatorios y comprobantes; si el paciente no tiene, se puede dejar vacío y se usa WhatsApp. DNI antes de la primera consulta |
| 8 | Turnos que se repiten | Sí, cada N semanas hasta una fecha | Cada turno queda suelto; al mover o cancelar se elige «solo este» o «este y los siguientes» |
| 9 | Lista de espera | No | — |
| 10 | Contadora | Sin gastos ni caja, pero con un botón para mandarle los movimientos | Correo de la contadora en el perfil; «Enviar a la contadora» manda por correo el período elegido con cobros, pagos y comprobantes en una planilla. Sin datos clínicos |
| 11 | Mejoras en cada repositorio de cliente | PR automático desde el repositorio madre | Cada actualización pasa las pruebas en el repositorio del cliente antes de unirse; nada llega sin probar |
| 12 | Baja de una profesional | Se le entregan todos sus datos | Exportación completa: historias en PDF, estudios, cobros y comprobantes |

**13. Tecnología (decidido el 23/10):** el código se rehace desde cero en Cloudflare (Workers, D1 y R2), con TypeScript y Hono, en un repositorio madre nuevo. Motivos: costo casi nulo por instalación, una sola usuaria (no hacen falta los permisos por fila de Supabase) y la base técnica ya probada. Del código actual se reutilizan solo las ideas: segundo factor, respaldos cifrados, inmutabilidad con triggers y las pruebas como lista de casos.

## Ciclo de vida del turno

El turno nace «Confirmado» cuando lo da la profesional y termina en uno de tres estados cerrados, que ya no se modifican. Solo el pedido online pasa antes por «Solicitado».

Los cinco estados:

- **Solicitado:** solo el pedido online. Retiene el hueco durante el plazo de respuesta (12 h por defecto). Pasa a Confirmado si la profesional lo acepta; si lo rechaza o vence, se libera.
- **Confirmado:** estado inicial de todo turno que da la profesional. Se puede mover de día u hora.
- **Atendido** (cerrado): la profesional tocó «Atender».
- **Ausente** (cerrado): «No vino».
- **Cancelado** (cerrado): con quién canceló (la profesional o el paciente, por ejemplo «Avisó que no viene»).

La respuesta del paciente por el enlace no cambia el estado: avisa a la profesional, que decide si reprograma o cancela. Si se activa el cobro por ausencia (pregunta 2), «Ausente» y la cancelación tardía generan un cobro que se puede perdonar con motivo.

## Flujos paso a paso

Son 15 flujos. Cada uno dice los pasos y, abajo, los casos que el sistema tiene que resolver. Las marcas **(hoy)** señalan lo que ya funciona en el código; lo demás es nuevo o cambia.

### 1. Puesta en marcha (BC con la profesional)

1. BC crea el repositorio y el entorno del cliente: marca, gama de colores, módulos, base, archivos, respaldos y secretos **(hoy)**.
2. La profesional entra con Google y activa el segundo factor con el código de alta que le da BC en persona **(hoy)**.
3. Lee y acepta los términos de uso y la política de privacidad. Sin aceptar no entra.
4. Completa su perfil: nombre, especialidad, matrícula, foto, WhatsApp **(hoy)**; y los datos fiscales: CUIT, condición frente al IVA, domicilio, punto de venta.
5. Carga sus consultorios con horarios por día **(hoy)**, sus prestaciones con duración e importe **(hoy)** y las obras sociales con las que trabaja **(hoy)**.
6. Si va a facturar: BC sube el certificado de ARCA y se emite una factura de prueba en homologación.

Casos: si falta un dato fiscal, todo funciona pero solo se ofrece comprobante interno, con un aviso de qué falta. Si cambian los términos, se vuelven a aceptar en el próximo ingreso.

### 2. Dar un turno

1. Desde la agenda (un hueco libre) o el «+»: buscar al paciente por nombre, apellido, DNI o celular **(hoy)**.
2. Se busca por DNI. Si no existe, se da de alta ahí mismo con DNI, nombre, apellido y celular (correo opcional), y aparece enseguida en Pacientes como ficha incompleta.
3. Elegir consultorio, día y hora; prestación (la duración sale de ella), cobertura, modalidad (presencial o videollamada) y tipo de atención **(hoy)**.
4. Con «Repetir», se crean los turnos siguientes cada N semanas hasta una fecha.
5. El turno nace «Confirmado» y, si la profesional quiere, sale el aviso al paciente por WhatsApp o correo.

Casos:

- Superposición con otro turno o fuera del horario del consultorio: avisa y deja seguir **(hoy)**.
- Día bloqueado o feriado sin atención: avisa y deja seguir solo si la profesional lo confirma (es su agenda).
- Paciente archivado: no se le dan turnos hasta reactivarlo **(hoy)**.
- Paciente con faltas: se ven al dar el turno **(hoy)**.
- Paciente que pidió no recibir recordatorios: no se le ofrecen **(hoy)**.
- El DNI es el identificador único del paciente: si ya existe, se usa esa ficha y no se crea otra, así que no hay fichas duplicadas (decidido 23/10).

### 3. Pedido de turno online

1. El paciente abre el enlace público de la profesional; elige consultorio, prestación y un horario libre.
2. Deja nombre, apellido, DNI, celular y correo, y acepta el aviso de privacidad.
3. El turno queda «Solicitado» y retiene el hueco durante un plazo (12 h por defecto).
4. La profesional recibe el aviso en la campanita y lo acepta, propone otro horario o lo rechaza.
5. Al aceptar, el turno pasa a «Confirmado» y el paciente recibe el aviso. Si coincide con una ficha (mismo DNI), se vincula; si no, se crea.

Casos: plazo vencido sin respuesta, el hueco se libera y el paciente recibe aviso; bloqueos y feriados nunca se ofrecen; límite de pedidos por celular y por día para evitar abuso; un paciente archivado no puede pedir.

### 4. Recordatorio y confirmación

1. 48 h antes sale un correo automático con el enlace de confirmación **(hoy)**; por WhatsApp, la profesional lo manda con un toque desde la agenda **(hoy)**.
2. El paciente responde «Voy» o «No puedo ir» desde el enlace, sin cuenta **(hoy)**.
3. La respuesta llega a la campanita **(hoy)**. «No puedo ir» aparece en «Para resolver» del Inicio para reprogramar o cancelar **(hoy)**.

Casos: hasta 4 cambios de respuesta por turno **(hoy)**; sin respuesta, se marca «Sin respuesta» **(hoy)**; reprogramar renueva el enlace **(hoy)**; correo rechazado, aviso en la campanita **(hoy)**.

### 5. Reprogramar o cancelar

1. La profesional abre el turno y lo mueve de día u hora, o lo cancela indicando quién canceló (ella o el paciente) **(hoy)**.
2. Se ofrece avisar al paciente por WhatsApp o correo.

Casos: un turno cerrado (atendido, ausente, cancelado) no se modifica **(hoy)**; en turnos repetidos se elige «solo este» o «este y los siguientes»; si está activo el cobro por cancelación tardía, al cancelar con menos de X horas se avisa que se genera el cobro.

### 6. El día del turno

1. El Inicio muestra el próximo paciente y los turnos del día con su estado **(hoy)**.
2. Cuando el paciente entra, «Atender» deja el turno atendido y abre la consulta en un toque **(hoy)**. Si la ficha está incompleta, pide completarla antes.
3. Si no vino: «No vino» (ausente) o «Avisó que no viene» (cancelado por el paciente) **(hoy)**.

Casos: turnos que pasaron sin registrar quedan en «Para resolver» **(hoy)**; marcar atendido no se deshace y pide confirmación **(hoy)**; atención sin turno: desde la ficha se empieza una consulta directamente **(hoy)**; videollamada: el turno lleva el enlace **(hoy)**.

### 7. Consulta e historia clínica

1. Primera consulta (anamnesis, antecedentes, examen, plan) o evolución, con signos vitales opcionales **(hoy)**.
2. Autoguardado como borrador; se retoma después **(hoy)**.
3. Finalizar: queda firmada con fecha y no se edita; se corrige con una aclaración **(hoy)**.
4. Durante la consulta, sin salir de ella: adjuntar estudios, registrar mediciones, hacer certificado, pedido o receta e indicar el próximo control. Al terminar, en la misma ventana, cobrar la consulta y darle el turno del control en la semana sugerida; lo que no se haga queda pendiente en Hoy. «Volver» siempre lleva a donde estaba: de la consulta a Hoy y de la ficha a Pacientes **(hoy)**.
5. Al finalizar se ofrece «Registrar cobro» y «Agendar próximo control» **(hoy)**.

Casos: la misma consulta abierta en dos pestañas no se pisa **(hoy)**; descartar un borrador queda registrado **(hoy)**; el borrador se crea al primer guardado, no al abrir; paciente archivado, solo lectura **(hoy)**.

### 8. Cobro

1. Desde el final de la consulta, el Inicio, la ficha o el menú (sin turno) **(hoy)**.
2. Particular: el importe sale de la prestación y se puede cambiar. Obra social: el importe es el copago, que puede ser 0 **(hoy)**.
3. Se registra cuánto pagó (todo, una parte o nada) y el medio: efectivo, transferencia, tarjeta u otro **(hoy)**.
4. Al registrar un pago se ofrece el comprobante (flujo 9). Si el paciente va a transferir, «Enviar datos de pago» le manda el importe, alias, CBU, titular y el QR de su banco si lo cargó; el pago se registra cuando llega.

Casos: un pago nunca supera el saldo **(hoy)**; doble clic no duplica **(hoy)**; pago mal cargado, se anula con motivo y se carga de nuevo **(hoy)**; cobro con pagos vigentes no se anula **(hoy)**; «Sin cargo» (familiar o amigo) no lleva pago ni comprobante **(hoy)**; saldo pendiente queda en «Te deben» y en la ficha **(hoy)**; ausencia cobrada, si está activo.

### 9. Comprobante (nuevo)

1. Al registrar un pago, o después desde el detalle del cobro, la profesional elige **Comprobante interno** o **Factura ARCA**.
2. Por defecto sale a nombre del paciente; se puede cambiar a otra persona con nombre y DNI o CUIT.
3. Interno: número correlativo propio, PDF con sus datos y la leyenda «Documento no válido como factura».
4. ARCA: se pide el CAE; el PDF lleva CAE, vencimiento y el código QR que exige ARCA.
5. Se envía por WhatsApp o correo, o se descarga; queda guardado en la ficha y en el cobro.

Casos:

- ARCA no responde: el pago queda registrado y la factura «Pendiente de emitir»; se reintenta y la campanita avisa si falla.
- Anular un pago con comprobante interno: el comprobante queda «Anulado» con el mismo motivo.
- Anular un pago con factura: se emite nota de crédito C por el mismo importe; la factura nunca se borra.
- Pedir un comprobante dos veces del mismo pago: devuelve el ya emitido, idéntico.
- Sin datos fiscales o sin certificado: solo comprobante interno.
- Copago de obra social: el comprobante es por el copago, no por la prestación.

### 10. Bloqueos y feriados (nuevo)

1. Desde la agenda: «Bloquear», con desde, hasta, día completo o franja, consultorio (uno o todos) y motivo opcional (vacaciones, congreso, personal, otro).
2. Si ya hay turnos en ese período, el sistema los lista y la profesional reprograma o cancela cada uno, con aviso al paciente.
3. Los feriados nacionales vienen cargados **(hoy, para avisos)** y se ven en la agenda; para cada uno la profesional elige si atiende.

Casos: un bloqueo no cancela turnos solo; un bloqueo se puede quitar y el hueco vuelve a ofrecerse; nunca se ofrece un día bloqueado en el pedido online.

### 11. Seguimiento

1. Al finalizar la consulta se indica el próximo control (opcional) **(hoy)**.
2. El paciente aparece en «Controles por agendar» del Inicio hasta que tenga turno **(hoy)**.

Casos: fecha en fin de semana o feriado, avisa **(hoy)**; si el control se pasa sin turno, sigue en la lista marcado como vencido.

### 12. Documentos clínicos

Certificado y pedido médico en PDF con nombre y matrícula, re-descarga idéntica y envío por WhatsApp o correo **(hoy)**. La receta se hace en MisRx y se anota la medicación recetada **(hoy)**. Caso: una anotación equivocada se anula con motivo **(hoy)**.

### 13. Estadísticas

Por período (mes o rango libre) y consultorio: consultas, pacientes nuevos y que vuelven, ausencias y cancelaciones, tipo de atención, coberturas **(hoy, por mes)**; con cobros: cobrado, copagos, particulares, ticket promedio, te deben, por prestación, cobertura, medio y consultorio **(hoy, salvo consultorio)**; con comprobantes: facturado y no facturado.

### 14. Respaldos, exportación y baja

Respaldo diario cifrado **(hoy)** y simulacro de restauración antes de producción. Exportación por paciente en ZIP **(hoy)** y cobros en CSV **(hoy)**. Si la profesional deja el servicio, se le entrega todo exportado (pregunta 12).

### 15. El paciente: lista, ficha y todo lo que se hace con él

Sumado en el hilo de diseño (23/10). Reúne en un solo lugar lo que ya estaba repartido en los otros flujos.

**Lista de pacientes**

1. Buscador por nombre, DNI o celular, y «Paciente nuevo» con el alta rápida (DNI, nombre, apellido, celular y correo opcional); si el DNI ya existe, muestra esa ficha.
2. Filtros: todos, te deben, control vencido, sin próximo turno, primera consulta, ficha incompleta y dados de baja.
3. Cada fila muestra el paciente con sus marcas, celular, fecha del último turno, próximo turno y saldo. Se ordena por nombre, por último turno o por próximo turno.
4. Al tocar un paciente se abre su resumen (cuántas veces vino, próximo turno, saldo) con «Darle turno», «Cobrar lo que debe» y «Abrir la ficha completa».

**Ficha del paciente: qué muestra**

- Encabezado: nombre, marcas (primera consulta o cuántas veces vino, faltas, control vencido, ficha incompleta), DNI, edad, cobertura y celular.
- Resumen: datos personales, próximo turno, saldo, próximo control y últimas consultas.
- Historia clínica: consultas en orden con su evolución, mediciones fuera de consulta (peso, talla) y archivos (estudios, imágenes) con su tipo **(hoy)**.
- Turnos: próximos y pasados con su estado.
- Pagos: saldo, cobros, pagos y comprobantes guardados **(hoy)**.
- Documentos: todo lo que se le hizo o se le adjuntó (certificados, pedidos, medicación recetada y estudios), con filtro por tipo, de qué consulta salió, fecha, ver y volver a mandar. Lo anotado mal aparece tachado como anulado, con el motivo. Cada consulta de la historia muestra qué documentos salieron de ella.

**Ficha del paciente: qué se puede hacer**

1. Darle turno sin salir de donde está: se abre una ventana con el paciente ya elegido y, si tiene un control indicado, en la semana sugerida. Es la misma ventana desde la ficha, al terminar la consulta, desde «Controles por agendar» en Hoy y desde un turno ausente en la agenda. Mover o cancelar sus turnos, con aviso, se hace desde la agenda.
2. Empezar una consulta sin turno **(hoy)**, agregar una medición y exportar la historia clínica completa en un ZIP (PDF de la historia, estudios originales, documentación histórica y un LEEME con la huella de cada archivo; la descarga queda registrada).
3. Cobrar lo que debe en el lugar (todo, una parte o nada por ahora; cómo pagó; comprobante interno o factura C por WhatsApp) y reenviar un comprobante.
4. Hacer un certificado (diagnóstico y días de reposo), un pedido de estudios (uno por renglón y diagnóstico presuntivo opcional) o anotar una receta (se hace en MisRx; acá se anotan medicamento, indicaciones y fecha). Están a un toque desde la cabecera de la ficha y desde la consulta. El certificado y el pedido salen en PDF con nombre y matrícula y se mandan por WhatsApp, correo o descarga; nada sale solo.
5. Escribirle por WhatsApp.
6. Dejar de mandarle recordatorios o volver a mandarlos **(hoy)**.
7. **Editar sus datos**: todos los campos. El cambio de DNI pide confirmación, sigue siendo único y queda en el historial de cambios **(hoy)**; los demás cambios también quedan registrados con fecha.
8. **Dar de baja**: pide un motivo (ya no viene, se mudó, falleció, ficha duplicada, otro). No se borra nada: historia clínica, cobros y comprobantes se conservan. El paciente queda archivado: no se le dan turnos, no puede pedir turno online y su historia queda en solo lectura **(hoy)**. Aparece en el filtro «Dados de baja» y se puede **reactivar** desde su ficha.

Casos: al dar de baja, si tiene turnos próximos, la ventana los muestra y se cancelan solos con aviso al confirmar (decidido 23/10); si debe plata, no se puede dar de baja hasta que quede al día (decidido 23/10); un paciente dado de baja no se puede editar hasta reactivarlo; un DNI repetido al editar muestra la otra ficha y no deja guardar.

**Alta rápida y ficha incompleta (decidido 23/10)**

El DNI es el identificador único: cada paciente, con su DNI, tiene sus datos. Si al dar un turno el paciente no existe, se da de alta rápido (DNI, nombre, apellido, celular y correo opcional) y aparece enseguida en Pacientes con la marca «Ficha incompleta». Al abrirlo, la profesional completa el resto (nacimiento, domicilio, ocupación, cobertura y afiliado, consultorio) para poder hacer la primera consulta.

## Entidades y datos

De las 16 entidades, 12 ya existen en la base; las nuevas son el comprobante, el bloqueo, el feriado y la aceptación legal, y los datos fiscales se suman al perfil. La columna «Cambia» dice qué se agrega a una existente.

| Entidad | Datos principales | Se relaciona con | Cambia |
| --- | --- | --- | --- |
| Profesional (perfil) | Nombre, especialidad, matrícula, foto, WhatsApp, preferencias | Todo | Datos fiscales (CUIT, condición frente al IVA, domicilio, punto de venta, certificado de ARCA), datos para transferir (alias, CBU, titular, imagen del QR), diseño del comprobante interno (logo, colores, pie) y correo de la contadora |
| Consultorio | Nombre, dirección, ubicación, horario por día, activo | Turnos, consultas, cobros | — |
| Paciente | Nombre, apellido, DNI único, nacimiento, celular, correo, domicilio, ocupación, cobertura y afiliado, consultorios, baja de recordatorios, archivado | Turnos, consultas, cobros, comprobantes | DNI puede faltar hasta la primera consulta |
| Antecedentes | Alergias, medicación, grupo sanguíneo, personales y familiares, con historial de cambios | Paciente | — |
| Consulta | Tipo (primera o evolución), apartados, signos vitales, estado (borrador o finalizada), próximo control, aclaraciones | Paciente, consultorio, turno | — |
| Medición y estudio | Peso, talla y otras fuera de consulta; archivos con tipo y huella | Paciente | — |
| Documento | Certificado, pedido, medicación recetada; PDF idéntico al emitido | Paciente | — |
| Turno | Paciente, consultorio, fecha, hora, duración, prestación, cobertura, modalidad, tipo de atención, estado, quién canceló, confirmación del paciente, recordatorios enviados | Paciente, cobro | Paciente siempre obligatorio; estado «Solicitado» y origen (profesional o paciente); serie de repetición |
| Prestación | Nombre, duración, importe particular, activa | Turnos, cobros | — |
| Obra social | Nombre (catálogo argentino), en uso | Pacientes, turnos, cobros | — |
| Cobro y pago | Cobro: paciente, turno, prestación, cobertura, importe, estado. Pago: importe, medio, fecha, anulado con motivo | Paciente, turno, comprobante | Cobro por ausencia o cancelación tardía (si se activa) |
| Comprobante | Tipo (interno, factura C, nota de crédito C), número, receptor (nombre, DNI o CUIT), importe, CAE y vencimiento, estado (emitido, pendiente, anulado), enviado por | Pago, paciente | Nueva |
| Bloqueo | Desde, hasta, día completo o franja, consultorio o todos, motivo | Agenda | Nueva |
| Feriado | Fecha, nombre (nacionales cargados), si la profesional atiende | Agenda | Nueva (hoy los feriados solo se usan para avisos) |
| Aceptación legal | Versión de términos y privacidad, fecha, cuenta | Profesional | Nueva |
| Auditoría y notificación | Qué pasó, cuándo, desde dónde (huella); avisos de la campanita | Todo | Suma comprobantes y bloqueos |

## Reglas de negocio

Las que ya están garantizadas por la base y el código siguen igual; las nuevas salen de las decisiones del 23/10 y de las propuestas de la segunda ronda.

**Vigentes**

- Lo clínico y lo financiero no se borra ni se reescribe: se anula con motivo y queda quién y cuándo. Triggers en la base lo garantizan.
- Una consulta finalizada no se edita; se corrige con una aclaración.
- Un turno cerrado (atendido, ausente, cancelado) no se modifica. Marcar atendido no crea la consulta por sí solo y no se deshace.
- DNI único por paciente, con historial de cambios. Un paciente archivado queda en solo lectura.
- Importes en centavos. Un pago nunca supera el saldo. Un cobro se anula solo sin pagos vigentes.
- Sin conciliación con obras sociales: con obra social el importe es el copago (0 u otro); particular siempre lleva monto, que puede ser 0 («Sin cargo»). **Cobrado** = pagos de pacientes; **Te deben** = saldo de pacientes.
- Fechas y horas en horario de Argentina.
- Recordatorios y avisos llevan solo nombre, día y hora; nunca motivo ni datos clínicos.
- Un módulo apagado responde 404 en todas sus rutas; sus datos se conservan.

**Nuevas**

- Todo turno, consulta y cobro pertenece a una ficha. No existe el turno sin ficha.
- El DNI puede faltar al dar el turno, pero es obligatorio para empezar la primera consulta y para facturar.
- Un comprobante por pago. La numeración interna es correlativa, única por instalación y no se reutiliza.
- Un comprobante emitido no se modifica: el interno se anula con motivo; la factura se compensa con nota de crédito.
- Anular un pago con comprobante obliga a anular el comprobante (o emitir la nota de crédito) en el mismo paso.
- Un cobro «Sin cargo» no emite comprobante.
- Si ARCA no responde, el pago se registra igual y la factura queda pendiente de emitir.
- Un bloqueo no cancela ni mueve turnos: los lista para que la profesional decida.
- Un día bloqueado o feriado sin atención nunca se ofrece en el pedido online.
- Un turno «Solicitado» retiene el hueco solo durante el plazo de respuesta; vencido, se libera.
- Sin aceptar la versión vigente de términos y privacidad no se entra a la app.
- Si se activa el cobro por ausencia: el cargo es el importe de la prestación del turno y solo la profesional lo perdona, con motivo.

## Alcance por etapas

La meta (turnos, pagos, historia clínica, comprobantes y estadísticas con datos reales) se cumple al terminar la etapa 3 con el comprobante interno; la factura de ARCA llega en la etapa 4. Cada etapa se puede usar sola y se diseña en el hilo de diseño antes de construirse.

| Etapa | Qué incluye | Qué cambia en el código actual |
| --- | --- | --- |
| 1. Base ordenada | Ficha obligatoria en todo turno (con DNI antes de atender), DNI en el alta rápida, bloqueos de agenda, feriados con «¿atendés?», turnos que se repiten, cerrar lo que está en revisión (Inicio, asistencia, pacientes, PR #22) | Quitar el turno «sin ficha · primera vez» y migrar los que existan a fichas mínimas; tabla de bloqueos y feriados; borrador al primer guardado |
| 2. Comprobante interno | Datos fiscales en el perfil, comprobante interno por pago, numeración, anulación con el pago, envío por WhatsApp o correo | Tabla de comprobantes con triggers de inmutabilidad; PDF con el mismo motor que certificados y pedidos |
| 3. Puerta de producción | Términos, privacidad y consentimiento redactados y revisados por un abogado; aceptación al ingresar; staging; simulacro de restauración; dominio propio; repositorio madre y repositorios de cliente | `MODO_PRUEBA=0`, sin clave de prueba, sin `workers.dev`; tabla de aceptaciones; flujo de actualización del núcleo |
| 4. Factura ARCA | Factura C y nota de crédito C con CAE y QR, pendientes y reintentos, facturado y no facturado en estadísticas | Conexión con los servicios de ARCA desde el Worker; certificado por instalación guardado como secreto |
| 5. Autogestión del paciente | Pedido de turno online con aprobación, cobro por ausencia (si se activa), estadísticas por rango y por consultorio | Estado «Solicitado», página pública con límites anti abuso |
| 6. Más adelante | WhatsApp automático (API de Meta), seña o pago online, adaptación por especialidad cuando haya una profesional real | Según lo que se decida |

Como el código se rehace desde cero, la columna «Qué cambia en el código actual» queda como lista de lecciones del sistema anterior, no como tareas. Antes de la etapa 1 se suma una **etapa 0**: repositorio madre nuevo, esquema de datos completo de este análisis, ingreso con segundo factor, componentes del SiroMundo, pruebas y despliegue automático. El sistema actual queda como demo hasta que el nuevo lo reemplace.

**Siguiente paso:** que respondas la segunda ronda (sobre todo las preguntas 1 a 4). Con eso cierro este documento y arrancamos el hilo de diseño, empezando por las pantallas nuevas: comprobante, bloqueos, ficha mínima al dar turno y aceptación de términos.
