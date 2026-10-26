# SiroConsultas · Diseño aprobado

Tablero: https://claude.ai/artifact/J6jZgJy4gaAuEqsae9dZFq · fuentes en `docs/pantallas/`.
Compu, Hoy en el celular y app del paciente aprobados el 23/10; Agenda, Pacientes y Pedidos en el celular, el 25/10.

## 1. Base visual · aprobada el 23/10
- Estilo «Nube» (el del panel de Estudio Aura): menú en pastilla arriba, saludo y buscador centrados, tarjetas blancas grandes (radio 26–28 px) con sombra suave, botones en pastilla, bolitas de pasos, fondo con brillos suaves.
- Paleta: Alabaster #F2F7F9 (fondo), Half Baked #89C9C9 (brillos, selección, avisos suaves; enlaces en #24605F por contraste), Mindaro #DAFC92 (acción principal, una por pantalla), Holly #02261E (texto y botones oscuros).
- Colores de estado sin cambios: atendido verde, te deben ámbar, ausente rojo, sin respuesta gris.
- Letra Plus Jakarta Sans. Controles de 44 px como mínimo.

## 2. Hoy · aprobada el 23/10
- Menú: Hoy, Agenda, Pacientes, Cobros, Estadísticas; campanita y avatar.
- Acciones: Dar turno (destacada), Cobrar, Bloquear agenda.
- Pastillas «Para resolver»: pedido online, paciente que no puede ir, factura pendiente, feriado.
- Tarjeta «Ahora» con el próximo paciente: botón **«Atender»** (deja el turno atendido y abre la consulta) y «No vino». Aviso si la ficha está incompleta.
- Lista del día con estado por turno, Plata de hoy (cobrado y te deben) y Controles por agendar.

## 3. Dar turno · aprobada el 23/10
- Tres pasos con bolitas: Paciente → Día y hora → Guardar. Los datos elegidos quedan arriba como pastillas para volver a cambiarlos.
- Paciente: buscador, últimos que vinieron (con faltas a la vista) y «Paciente nuevo» con el alta rápida: DNI, nombre, apellido, celular y correo (opcional). El DNI es el identificador único: si ya existe, se muestra esa ficha y no se crea otra (cambio del 23/10). El resto de la ficha se completa antes de la primera consulta.
- Día y hora: la prestación viene por defecto (se puede cambiar), días en pastillas, día bloqueado rayado con opción de abrirlo, huecos por mañana y tarde.
- Revisá y guardá: cuatro tarjetas en un solo renglón (paciente, cuándo, prestación, importe), interruptores «Repetir» (cada N semanas hasta una fecha) y «Avisarle» por WhatsApp; botón destacado «Guardar turno».

## 4. Cobrar y comprobante · aprobada el 23/10
- Cobrar, paso 1: a quién se cobra, con dos grupos: «Terminaron y falta cobrar» (fondo ámbar suave) y «Te deben de antes».
- Paso 2: importe sugerido y editable; «¿Cuánto pagó?» Todo / Una parte (muestra cuánto queda debiendo) / Nada por ahora; «¿Cómo pagó?» Efectivo, Transferencia, Tarjeta, Otro; botón destacado «Guardar pago de $ X».
- «¿Te va a transferir?» abre la ventana Enviar datos de pago: vista del mensaje con importe, alias, CBU, titular e imagen del QR (opcional), por WhatsApp o correo. Aclara que la app no mueve plata; el cobro queda en «Te deben».
- Paso 3: comprobante interno o factura C (selector de dos), a nombre del paciente u otra persona, envío por WhatsApp o correo, o «Ahora no».
- Pantalla del comprobante: vista previa del PDF interno (logo, color, pie, «Documento no válido como factura») o de la factura C (letra C, CAE, vencimiento, QR); estado «Factura pendiente» si ARCA no responde; anular el pago con motivo (el interno queda anulado, la factura lleva nota de crédito C).

## 5. Bloquear la agenda · aprobada el 23/10
- Armado: desde y hasta, todo el día o una franja, consultorio, motivo en chips (Congreso, Vacaciones, Personal, Otro). Aviso de cuántos turnos caen adentro; botón destacado «Bloquear del … al …».
- Resolver los turnos que caen en el bloqueo, uno por uno: «Mover» o «Cancelar y avisar». Contador «Faltan resolver N turnos».
- «Mover» abre un panel en el mismo renglón: 3 horarios sugeridos (primeros huecos libres después del bloqueo, cerca de la hora de siempre), «Otro día en la agenda» y «Que elija el paciente» (le mandan los 3 horarios por WhatsApp y quedan reservados hasta que elija). Confirmar: «Mover al … y avisar».
- «Otro día en la agenda» abre la agenda en una ventana sobre la misma pantalla, con el paciente ya elegido: semana con huecos libres, flechas de semana, feriados rayados; «Mover al … y avisar» o «Volver sin mover». Vuelve a la lista para seguir con los que faltan. Cuando se diseñe la agenda semanal, esta ventana usa esa misma vista.
- Feriados: tarjeta con los próximos y «¿Atendés?» Sí / No.

## 6. Pedidos de turno · aprobada el 23/10
- Una tarjeta por pedido online: hace cuánto llegó y cuánto falta para que venza (12 h reservado; si no respondés se libera y al paciente le llega un aviso), nombre, día y hora, prestación y consultorio, DNI, celular, correo y cobertura.
- Marca de historial: «Nunca vino: sería su primera consulta» (azul) o «Ya vino N veces · la última el …» (verde). Si nunca vino, al aceptar se crea la ficha.
- Botones: «Aceptar» (destacado), «Otro horario» (elegís hasta 3 horarios y «Enviar los N horarios»; el original queda libre) y «No puedo». Cada respuesta le llega al paciente; se puede deshacer.
- Arriba: «Ver mi página para pedir turno».

## 7. Enviar a la contadora · aprobada el 23/10
- Período en pastillas: el mes, el anterior, el trimestre o «Elegir fechas» (solo selectores Desde y Hasta).
- Totales: cobrado, facturado (facturas C) y sin factura (comprobantes internos).
- La planilla trae tres hojas: Cobros, Pagos y Comprobantes.
- Para: el estudio contable, con «Cambiar». Botón destacado «Enviar <período>» o «Solo descargar la planilla». Copia al correo de la profesional. Envíos anteriores abajo.

## 8. Agenda · aprobada el 23/10
- Vistas Día / Semana / Mes, con flechas para avanzar y «Volver a hoy / a esta semana». Consultorio en un desplegable (Todos, Centro, Norte, Videollamada). Debajo de la fecha, un resumen en una línea: turnos, sin confirmar, pedidos online, para resolver.
- Sin botones de Dar turno ni Bloquear en la barra: todo se hace tocando la grilla.
- Semana de lunes a sábado, de 8 a 20 en filas de 30 min; hoy marcado y línea roja en la hora actual. Horas en que no atendés, días bloqueados y feriados rayados (feriado en celeste). Turnos con el color de su estado y nombre abreviado («Tomás F.»). Colores explicados abajo de la grilla.
- Vista Día: una sola columna con nombre, prestación y estado completos.
- Vista Mes: cada día con cantidad de turnos, barra de ocupación, huecos libres y punto violeta si hay pedido online. Tocar un día abre la vista Día de esa fecha.
- Todo se abre en ventanas sobre la agenda (no la corre); al cerrar o cancelar se vuelve como estaba:
  - Hueco libre: ¿para quién? (buscador, últimos que vinieron o paciente nuevo con ficha mínima), prestación y «Guardar turno»; le llega el aviso por WhatsApp para confirmar. «Bloquear este horario».
  - Turno: estado, datos, primera consulta o cuántas veces vino, y acciones según el estado (Mover, Cancelar y avisar, Mandar recordatorio, Cobrar, Responder el pedido, Atender, Darle otro turno). Ver ficha.
  - Mover: los huecos libres se ponen verdes (también en otras semanas); «Tenía… / Pasa a…» y «Mover y avisar».
  - Bloquear: fechas, todo el día o algunas horas, motivo; avisa qué turnos caen adentro. Al bloquear, esos turnos quedan en rojo («Para mover») para moverlos o cancelarlos desde la agenda.

## 9. Pacientes · aprobada el 23/10
- Buscador y botón destacado «Paciente nuevo» (alta rápida: DNI, nombre, apellido, celular, correo opcional).
- Filtros con cantidad: Todos, Te deben, Control vencido, Sin próximo turno, Primera consulta, Ficha incompleta, Dados de baja.
- Tabla sin etiquetas: Paciente, Celular, Último turno (solo fecha), Próximo turno, Saldo. Ordena por nombre, último o próximo turno.
- Tocar un paciente abre directo su ficha completa (sin ventana intermedia).

## 10. Ficha del paciente · aprobada el 23/10
- Cabecera: nombre, DNI, edad, cobertura y celular a la izquierda; a la derecha «Debe / Cobrar $ X» (cobra en una ventana ahí mismo), botón de documento (menú: Certificado, Receta (MisRx), Pedido de estudios), WhatsApp y «+» destacado para darle turno. Lápiz arriba a la derecha para editar todos los datos (el cambio de DNI avisa y queda en el historial; «Dar de baja» en rojo al pie).
- Pestañas: Resumen, Historia clínica, Turnos, Pagos, Documentos. Nunca «Plata».
- Historia clínica: «Exportar historia clínica» (ZIP como en el sistema actual) y «Empezar consulta sin turno»; cada consulta dice qué documentos salieron de ella.
- Documentos: certificados, pedidos, medicación y estudios, con filtros por tipo, de dónde salió, fecha, ver y volver a mandar; lo anulado tachado con motivo.
- Modales como el código actual: certificado (diagnóstico, días de reposo), pedido (un estudio por renglón, diagnóstico presuntivo opcional), receta (pasos de MisRx y anotar medicamento, indicaciones y fecha). Certificado y pedido terminan en «¿Se lo mandás?»: WhatsApp, correo o descargar PDF.
- Baja: motivo, los turnos se cancelan solos con aviso, y si debe hay que cobrar antes.

## 11. Consulta · aprobada el 23/10
- Primera vez: si la ficha está incompleta, primero se completa. Luego ¿Por qué consulta?, Antecedentes (con «Ninguno»), Examen (signos vitales opcionales), Plan e indicaciones y próximo control.
- Control: ¿Cómo sigue?, Examen, Plan («Copiar las de la vez anterior») y la tarjeta de la vez anterior.
- A la derecha: Certificado, Receta, Pedido de estudios y Adjuntar estudio, con las mismas ventanas de la ficha; lo hecho queda listado en verde.
- «Terminar consulta» (destacado) firma la consulta. En la misma ventana: cobrar la consulta y darle el turno del control en la semana sugerida; después «Volver a Hoy». Lo que no se haga queda pendiente en Hoy.

## 12. Estadísticas · aprobada el 23/10
- Filtros en una fila: período (este mes, mes anterior, trimestre, elegir fechas) y consultorio.
- Números: consultas (con la diferencia contra el período anterior), primera vez, pacientes que vuelven, ausencias.
- Gráfico de los últimos 6 meses: primera vez (azul) y vuelven (verde azulado), tocar un mes muestra el detalle; «Ver como tabla».
- Coberturas, ausencias y cancelaciones (no vinieron, cancelaron con aviso, cancelaste vos), por consultorio y tipo de atención.
- Cobros: cobrado, particulares, copagos, te deben y ticket promedio; tabla por prestación; facturas C y comprobante interno; por medio de pago; «Enviar a la contadora».
- El menú «Estadísticas» lleva acá (antes iba a la contadora).

## 13. Configuración · aprobada el 23/10
- Se entra tocando la foto (iniciales) arriba a la derecha. Menú a la izquierda con siete secciones; un solo «Guardar» oscuro por sección.
- Tu perfil: foto, nombre, especialidad, matrícula, WhatsApp, correo (sin nombre y matrícula no hay documentos).
- Consultorios y horarios: cada uno con resumen de días y horas, «Editar horarios» día por día (mañana y tarde), interruptor para apagarlo (no se ofrece para turnos nuevos; se conserva todo). «+ Agregar consultorio»: presencial o videollamada, nombre, dirección y cómo llegar (opcional), días con desde/hasta y «+ Otro horario»; se guarda con al menos un día.
- Prestaciones: nombre, duración, importe particular, activa. Importe 0 = «Sin cargo», sin comprobante.
- Obras sociales: las que usás, buscador del catálogo, «Dejar de usar».
- Cobros y comprobantes: datos fiscales con estado de factura C y certificado de ARCA (lo carga BC), datos para transferir con QR, diseño del comprobante interno con vista previa, correo de la contadora, cobro por ausencia (apagado por defecto).
- Recordatorios: mensaje de WhatsApp con {nombre} {dia} {hora} {lugar} y vista previa; envío automático por correo.
- Cuenta y seguridad: segundo código, respaldos, enlace de Google Calendar, exportar todo, versión de términos aceptada.

## 14. Términos y privacidad al entrar · aprobada el 23/10
- Primera vez: «Antes de empezar». Términos de uso y política de privacidad se leen desplegándose en la misma página (sin scroll anidado). Casilla «Leí y acepto… (versión X)»; el botón lima «Aceptar y entrar» se habilita al marcarla. Después lleva a completar el perfil.
- Si cambian: «Actualizamos los términos» con un recuadro «Qué cambió»; al aceptar va a Hoy.
- Sin aceptar no se entra; se guarda versión y fecha (visible en Configuración). El texto definitivo lo redacta y revisa un abogado.

## 15. Hoy en el celular (390 px) · aprobada el 23/10
- Lo de todos los días: ver el día, marcar si llegó, cobrar, dar o mover un turno, bloquear, escribir por WhatsApp y mandar el enlace de la app. Abajo: Hoy, Agenda, Pacientes y Pedidos. Lo clínico, estadísticas, configuración y exportar quedan en la compu.
- **Dar turno:** empieza por el DNI. Mientras se escribe, aparecen los pacientes que coinciden («Ya es paciente», última visita). Si el DNI no existe, avisa que es nuevo y pide la ficha mínima. Por nombre también busca, pero si no aparece sugiere el DNI para no duplicar fichas.
- **Cobrar:** 1) a quién (DNI o nombre; arriba los que deben); 2) qué (lo que debe o una prestación con precio de lista), cuánto (todo, una parte con monto, nada aún), cómo pagó y comprobante (interno, factura C, ahora no). Un pago parcial deja el resto como deuda.

## 16. App del paciente · aprobada el 23/10
- Solo por invitación: la profesional le manda el enlace por WhatsApp. Con el enlace crea su cuenta (usuario = DNI, elige contraseña) y acepta términos y privacidad. Sin enlace no hay cuenta.
- Después entra con usuario y contraseña; si cambian los términos, los vuelve a aceptar al entrar. Contraseña olvidada: código por WhatsApp al celular de la ficha.
- Ve: próximo turno (confirmar, cambiar o cancelar), sus turnos, lo que debe con «Pagar con Mercado Pago», lo que pagó con comprobante y sus datos. Nada clínico.
- El enlace vence (7 días en el diseño) y sirve una sola vez. Los documentos no aparecen en la app: le llegan solo por WhatsApp.
- En la ficha de la compu: fila «App del paciente» con «Mandar el enlace» o «Reenviar enlace».
- **Mercado Pago:** «Pagar con Mercado Pago» es solo un enlace que lleva al paciente a Mercado Pago (el enlace de cobro de la profesional): la app no cobra, no procesa ni guarda nada del pago. La profesional lo registra a mano cuando ve la plata, como cualquier otro pago (decidido el 25/10).

## 17. Celular de la profesional: Agenda, Pacientes y Pedidos · aprobada el 25/10
- Barra de abajo: Hoy, Agenda, Pacientes y Pedidos (con la cantidad por responder).
- **Agenda:** «Día | Mes». Día: tira de días y la lista con los huecos libres; el turno se cobra, se le escribe, se le manda recordatorio, se mueve, se cancela (quién cancela) o se ve su resumen (alergias, celular, última consulta, saldo); un pedido online se acepta o se le propone otro horario; un hueco libre se da por DNI. Mes: cantidad de turnos por día, bloqueados en gris, hoy remarcado; tocar un día muestra el resumen y «Ver el día».
- **Pacientes:** búsqueda por nombre o DNI con filtros (te deben, control vencido, sin próximo turno). Resumen sin nada clínico: alergias, contacto, última consulta, próximo turno, saldo y app del paciente; dar turno y cobrar en una hoja.
- **Pedidos:** aceptar, proponer hasta 3 horarios o rechazar; marca de primera vez o «ya vino N veces».
- **Todo adentro de la app:** las acciones se resuelven en hojas sobre la misma pantalla (cobro, horarios, bloqueo, recordatorio). Solo salen WhatsApp y el pago con Mercado Pago.
- **Paciente:** «Pedir turno» dentro de la app (qué, consultorio o videollamada, día en «Próximos días» o «Mes», horario libre, enviar); solo ve horarios libres, nunca quién tiene turno; queda como pedido 12 h. El comprobante se ve y se guarda en la app.

## Reglas comunes (23/10)
- «Darle turno» a un paciente conocido es siempre la misma ventana con el paciente ya elegido y la semana sugerida, sobre la pantalla en la que estás (ficha, consulta, Hoy «Agendar», agenda «Darle otro turno»).
- «Volver» lleva a donde estabas: ficha → Pacientes, consulta → Hoy.
- En ventanas de cobro y turnos, lo elegido se marca en verde agua suave; un solo botón oscuro por ventana.

## Notas para pantallas que vienen
- Pacientes (23/10): el DNI es el identificador único. Alta rápida con DNI, nombre, apellido, celular y correo opcional; el paciente aparece enseguida en Pacientes con «Ficha incompleta» y se completa al abrirlo. No hay fichas duplicadas.
- Dar de baja (23/10): los turnos próximos se cancelan solos con aviso; si debe dinero no se puede dar de baja hasta que quede al día.
- Estadísticas: separar primeras consultas de pacientes recurrentes (pedido de la profesional, 23/10). La misma marca se ve en Pedidos de turno: «Nunca vino: sería su primera consulta» o «Ya vino N veces · la última el …».

## Pendientes de aprobar
Todas las pantallas están aprobadas (compu y celular). Resuelto el 25/10: «Pagar con Mercado Pago» solo redirige a Mercado Pago; los precios de las pantallas son datos de prueba: el valor real lo carga la profesional en Configuración › Prestaciones. Resuelto el 23/10: los documentos le llegan al paciente solo por WhatsApp (no aparecen en la app); el enlace de invitación vence y sirve una vez; la ficha de la compu tiene «App del paciente» con «Mandar el enlace» / «Reenviar enlace»; la app del paciente ya está en el análisis funcional. No queda nada pendiente.
