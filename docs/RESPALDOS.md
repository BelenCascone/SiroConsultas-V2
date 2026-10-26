# Respaldos cifrados y simulacro de restauración (E3)

La copia diaria incluye una exportación consistente de los datos D1, el esquema real (tablas, índices, vistas y triggers) y todos los originales referenciados por esa base: estudios, documentos, comprobantes, foto, QR y logos, incluidos los anulados y los logos históricos de los comprobantes. No copia objetos huérfanos del bucket.

No hay una ruta web para descargar respaldos. La tarea operativa vive en `scripts/respaldos/` y el flujo `Respaldos cifrados` de GitHub. No modifica el Worker, los recordatorios ni las migraciones.

## Cómo se completa una copia

1. Lee el esquema, pide a D1 una exportación de solo datos y vuelve a leer el esquema. Si hubo un cambio de esquema durante la exportación, aborta. D1 puede bloquear escrituras mientras exporta: elegí un horario de poco uso.
2. Reconstruye una base SQLite aislada, con triggers creados después de cargar los datos. Consolida los contadores autoincrementales exportados por su máximo, para no repetir IDs. Comprueba integridad, relaciones y `config.restauracion = '0'`, y obtiene las referencias de archivos de esa misma foto. Nunca activa restauración en la base en servicio.
3. Descarga cada original y contrasta su SHA-256 cuando la base lo tiene. Una ausencia o una huella distinta impide completar la copia. Los cambios posteriores en D1 no alteran la foto; si mientras tanto se quitó un original necesario, falla y hay que reintentar.
4. Comprime cada pieza con gzip y la cifra con AES-256-GCM, una clave independiente de 32 bytes y un IV aleatorio nuevo por pieza. La cabecera/versionado también se autentica. Guarda únicamente datos cifrados en R2, bajo `v1/<fecha-uuid>/`. El manifiesto contiene huellas, tamaños, correspondencia de originales y cantidad de filas por tabla; también está cifrado y se sube **último**.
5. Descarga la copia del bucket de respaldos y realiza el simulacro completo. Verifica el cifrado, todas las huellas, las relaciones, la cantidad de filas y las referencias a originales. Solo después registra el manifiesto en la tabla `respaldos`, con la huella del manifiesto cifrado y el tamaño cifrado total. El registro de la copia actual estará en la próxima exportación.

Una carpeta sin manifiesto no es una copia completa. Una falla deja el flujo en rojo y no registra éxito en la base. Puede haber piezas incompletas: se conservan para revisión. Esta versión no borra copias automáticamente ni define una retención; las copias anteriores quedan intactas. No hay artifacts con datos ni URLs firmadas en los logs.

## Activar una instalación

Requiere Node **22.18 o posterior**. El desarrollo y las pruebas usan exclusivamente datos ficticios. Para la operación real, en **GitHub → Settings → Secrets and variables → Actions**:

| Tipo | Nombre | Contenido |
|---|---|---|
| Secreto | `RESPALDOS_CLOUDFLARE_API_TOKEN` | Token específico de la instalación, limitado a la cuenta: D1 Edit (exportación, lectura de esquema y registro del respaldo) y R2 Storage Edit (leer originales y escribir/verificar respaldos). El script no borra objetos. Separalo del token de despliegue. |
| Secreto | `RESPALDOS_CLAVE` | 32 bytes aleatorios en hexadecimal: generar **fuera del chat** con `openssl rand -hex 32`. No reutilizar sesión, TOTP ni SMTP. |
| Variable | `RESPALDOS_CLOUDFLARE_ACCOUNT_ID` | Cuenta propietaria de D1 y R2. |
| Variable | `RESPALDOS_D1_ID` | ID de la base de esa instalación. |
| Variable | `RESPALDOS_ARCHIVOS_BUCKET` | Bucket privado de originales. |
| Variable | `RESPALDOS_BUCKET` | Bucket privado de respaldos, distinto del anterior. |
| Variable | `RESPALDOS_ACTIVOS` | `1`, **al final**, para habilitar el flujo. |

El flujo corre diariamente a las 04:00 de Argentina y se puede ejecutar a mano. GitHub no garantiza la hora exacta y puede deshabilitar tareas programadas por inactividad: controlar la última ejecución exitosa en Actions. Activar notificaciones de fallas para la persona responsable. Un flujo omitido porque `RESPALDOS_ACTIVOS` no vale `1` no demuestra que exista un respaldo.

El acceso R2 usa el mismo endpoint HTTPS de objetos que Wrangler; admite hasta **300 MB por pieza cifrada**. La herramienta falla si se supera ese límite. El runner necesita espacio privado para la exportación, una base restaurada y los archivos del simulacro. Los archivos se procesan por streaming y se limpian los temporales al terminar normalmente, incluso ante errores; una interrupción forzada requiere descartar el runner/disco temporal. Usar runners efímeros; no correr con datos reales en una máquina compartida.

Guardar la clave de respaldo en una custodia independiente de Cloudflare y del repositorio, con acceso restringido. Conservar también las claves antiguas si se rota: cambiar el secreto no vuelve a cifrar las copias históricas. Sin la clave correcta no hay recuperación.

Los secretos de la instalación **no están en D1** y no se incluyen en el respaldo. Su custodia independiente también es necesaria: especialmente `TOTP_CLAVE` (los autenticadores en D1 están cifrados con ella), además de sesión, Google, SMTP y futuros certificados de ARCA. En un entorno de recuperación, no habilitar correo ni acceso de pacientes/profesional hasta revisar la configuración.

## Simulacro de una copia existente

En una máquina privada, exportar por un medio seguro las mismas variables del flujo (el token se llama `CLOUDFLARE_API_TOKEN` y la cuenta `CLOUDFLARE_ACCOUNT_ID` en el proceso). No pegar los valores en comandos guardados ni en el chat. Con el ID mostrado en el informe de una ejecución exitosa:

```sh
node --experimental-strip-types scripts/respaldos/cli.ts simular <id>
```

Descarga y restaura en un directorio temporal privado que se elimina al terminar. Devuelve solo el identificador, la fecha de verificación, cantidades e indicadores de integridad: nunca notas clínicas, nombres de pacientes ni claves de archivos. No escribe nada en D1 o R2.

Para conservar el resultado en una carpeta **nueva**:

```sh
node --experimental-strip-types scripts/respaldos/cli.ts simular <id> /ruta/privada/simulacro-nuevo
```

El padre debe existir y ser privado. Se niega a pisar carpetas o enlaces existentes. El resultado queda en `simulacro-nuevo/copia/`:

- `base.sqlite`: base reconstruida, con vistas, índices y triggers.
- `datos.sql` y `esquema.json`: datos y esquema de la misma foto.
- `archivos/00000000`, etc.: originales idénticos. Sus claves y tipos están en `manifiesto.json`; nunca se interpretan esas claves como rutas locales.
- `VERIFICACION.json`: evidencia del simulacro (filas, originales, integridad, relaciones y huellas).

Estos archivos **ya están descifrados**: restringir el acceso y eliminar la carpeta al terminar. La base descargada incluye sesiones y preferencias del momento de la copia; no se publica como staging ni se conecta a los secretos de producción.

## Recuperación real

El simulacro no reemplaza una instalación. Ante un incidente, conservar el origen, elegir una copia verificada y preparar una **base D1 y un bucket nuevos**, aislados. Cargar primero las tablas del esquema, luego `datos.sql` y por último índices, vistas y triggers, igual que `restaurarBase`; D1 tiene restricciones propias de importación y se debe verificar en staging antes de cambiar los bindings. No importar encima de una base con datos ni ejecutar `config.restauracion=1` en producción.

Subir los originales a las claves exactas y con los MIME del manifiesto, comprobar nuevamente cada huella, las relaciones y el modo restauración apagado. Restaurar los secretos desde su custodia, invalidar sesiones recuperadas y verificar ingreso, historia clínica, PDFs, numeradores y cobros en el entorno aislado. El cambio de bindings/dominio a la instalación recuperada es una operación aparte, posterior a esa revisión.

## Estado de esta entrega

Incluye la automatización y pruebas de cifrado, errores, restauración y protecciones de la base con datos ficticios. No activa secretos, no ejecuta copias remotas y no acredita todavía el simulacro de una instalación real. Antes de producción debe quedar registrado un flujo exitoso de esa instalación, con la clave bajo custodia y una restauración en staging. El resto de E3 (legales, staging, dominio y repositorios de cliente) conserva su alcance propio.
