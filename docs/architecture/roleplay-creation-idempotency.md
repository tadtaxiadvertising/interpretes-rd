# Intérpretes RD · Idempotencia duradera de creación de Roleplays

## Estado de la fase

**Preparación de persistencia y pruebas, no activada.** Esta fase añade el modelo Prisma `RoleplayCreationRequest`, su migración SQL y funciones `fingerprintRoleplayCreation`, `claimRoleplayCreation` y `completeRoleplayCreationInTransaction`. El endpoint y el formulario disponen de un piloto explícito, apagado por defecto, descrito a continuación.

La migración es aditiva, sin modificación ni eliminación de sesiones/escenarios/audio existentes, con RLS habilitado y sin acceso directo a `anon`, `authenticated` ni `PUBLIC`. No se ha ejecutado en producción.

## Piloto de publicación individual (apagado por defecto)

- Solo con `ROLEPLAY_CREATION_IDEMPOTENCY_ENABLED=true`, `ROLEPLAY_IDEMPOTENCY_RECEIPTS_ENABLED=true` y encabezado `Idempotency-Key` UUID v4/v7. Una solicitud con clave cuando el piloto está deshabilitado devuelve 503; nunca pasa silenciosamente a la ruta antigua.
- Admite únicamente el destino `interpreter` individual, con audio multipart validado o snapshot de biblioteca verificado. El formulario emite una clave solo si ambas banderas de creación y recibos están activas y el flujo no es de subida directa. Candidatos, asignaciones masivas y subida directa quedan fuera de esta fase.
- Reserva después de validar el destino y el paquete, antes de reservar la sesión o subir archivos; completa el recibo en la misma transacción que publica los escenarios y la sesión. Un fallo de escritura del recibo impide confirmar la publicación.
- Una clave repetida con resultado completo puede devolver el mismo identificador, únicamente si la sesión corresponde al intérprete y no está en DRAFT/CANCELLED. No vuelve a subir audio, publicar ni notificar. Un resultado incierto o conflicto devuelve 409 y requiere revisión.
- Tras una reserva exitosa, un error posterior (incluida una precondición de publicación) puede dejar IN_PROGRESS. No libera automáticamente la clave. La consulta de recibos es independiente y permanece deshabilitada. Un reenvío multipart puede volver a consumir tráfico y cálculo de huellas antes del reconocimiento; no es una solución de transporte.
- **No habilitar todavía**: exige comprobar esquema real, endurecimiento de constraints, autenticación y transacciones en entorno controlado, y recuperación desde interfaz. No se ha modificado la base de producción.

## Recuperación desde el formulario (apagada por defecto)

La página habilita las nuevas creaciones con recuperación únicamente cuando ambas banderas (`ROLEPLAY_CREATION_IDEMPOTENCY_ENABLED` y `ROLEPLAY_IDEMPOTENCY_RECEIPTS_ENABLED`) son exactamente true. En asignaciones individuales de intérpretes por multipart o biblioteca, el navegador genera una UUID v4 antes del primer envío. Conserva solo en memoria la clave, el número esperado de escenarios y la referencia local de seguimiento. No se usa esta ruta para candidatos, asignaciones masivas ni subida directa.

Si el envío con clave no confirma una creación válida, se bloquean el borrador y nuevas creaciones desde ese formulario. El botón de recuperación consulta únicamente el recibo con la clave original; nunca reenvía archivos, vuelve a crear o libera automáticamente la reserva. NOT_FOUND no prueba rollback; IN_PROGRESS, REVIEW_REQUIRED y errores de consulta tampoco. Un recibo completo y coherente confirma la creación y permite consultar la lista de sesiones, sin inventar enlaces de invitación. La recarga o navegación pierde la clave en memoria. Antes de cerrar, el administrador puede copiar la referencia `rp1:<UUID>:<cantidad de escenarios>` y posteriormente introducirla en «Recuperar una creación anterior», con la misma cuenta. La referencia no contiene grabaciones, destinatario, enlaces de invitación ni credenciales. No se persiste en localStorage/sessionStorage. Un recibo recuperado por referencia no se vincula al borrador ni al seguimiento Studio de la nueva pestaña. Si no se guardó la referencia, revisar las sesiones existentes antes de repetir. La consulta no autoriza reintentos, y la referencia no sustituye la autenticación.

## Contrato seguro

1. El navegador generará una UUID v4/v7 aleatoria para un intento editorial. Un reenvío del **mismo borrador sin modificaciones** reutilizará esa clave; cualquier edición de destinatario, escenario o archivo solicitará otra. La UUID **no concede acceso** y nunca sustituye el chequeo de administrador cookie/Bearer.
2. El servidor validará por completo el usuario, destino, biblioteca y 1–25 clips. Para nuevos archivos tendrá que **calcular SHA-256 sobre los bytes reales**, no confiar en una cadena enviada por el navegador. El fingerprint incluye el destino, escenarios normalizados, SHA y tamaño/MIME de cada archivo en su orden. Para biblioteca puede usar el fingerprint previamente comprobado del snapshot inmutable.
3. El servidor reservará `(actor_user_id, request_key)` en PostgreSQL con índice **UNIQUE**. El primer proceso recibe `CLAIMED`; un duplicado idéntico `IN_PROGRESS`, un mismo key con contenido distinto `CONFLICT`. No se realizan nuevas subidas en esos casos.
4. Durante **la misma transacción** que publica sesiones y referencias de audio, llamará a `completeRoleplayCreationInTransaction(tx, ...)`. Este método requiere cambiar la fila desde `IN_PROGRESS` mediante UPDATE condicional exactamente una vez. Si no modifica **una sola fila**, lanza error y obliga a revertir toda la transacción.
5. Cuando la publicación está `COMPLETED`, un reintento puede consultar `session_ids`/contadores y responder reutilizando el resultado. Antes de responder, el handler debe confirmar que las sesiones aún existen y reconstruir la invitación de candidato con los mismos permisos. Ninguna URL firmada, token de invitación o grabación se almacena en el ledger.
6. Si una transacción pierde su acuse o un proceso cae y queda `IN_PROGRESS`, el sistema **no liberará automáticamente** la clave: se requiere conciliación de las sesiones y audios antes de permitir una nueva publicación. La caducidad temporal por sí sola no demuestra rollback. Limpiar las filas solo tras inventario y periodo de gracia (incidencias #408/#416). La operación de limpieza debe quedar auditada.
7. La primera activación debe ser **deshabilitada por defecto**, únicamente después de comprobar la migración en la base correcta, hacer tests de dos administradores, doble clic, procesos concurrentes, repetición tras respuesta HTTP 500, audio parcial, biblioteca, candidato, 21/25 segmentos y reinicio del worker. No desplegar activación sin comprobación de SHA en Easypanel.

## Consulta de recibos (API de solo lectura, deshabilitada por defecto)

La ruta `POST /api/admin/roleplays/creation-receipt` acepta exclusivamente JSON de hasta **512 bytes** con `{"requestKey":"<UUID v4/v7>"}`, usando la identidad del administrador autenticado por cookie y comprobando que cualquier Bearer explícito sea **el mismo** administrador. No acepta `actorUserId` del navegador y no pone el UUID en una URL de consulta. No crea claves, reintenta subidas, modifica sesiones, concede acceso ni entrega códigos de invitación.

**Bandera independiente:** `ROLEPLAY_IDEMPOTENCY_RECEIPTS_ENABLED=true`. Sin ella devuelve 404 sin consultar la nueva tabla. No habilitar hasta confirmar la migración en la base de datos correcta. Si falta la tabla o PostgreSQL falla, devuelve error genérico 503, sin asumir que el registro no existe.

El recibo indica `NOT_FOUND`, `IN_PROGRESS`, `REVIEW_REQUIRED` o `COMPLETED`. Los completados se devuelven solo si los contadores son coherentes y todos los ID de sesión del ledger aún existen; de lo contrario requieren revisión manual. Las respuestas de todos los estados son `private, no-store` y no contienen nombres, correos, URLs de audio, tokens ni enlaces firmados. La consulta no libera `IN_PROGRESS` por antigüedad.

**No activar la bandera como sustituto del backend:** el piloto de creación está deshabilitado por defecto, de modo que `NOT_FOUND` hoy no demuestra que una publicación haya fallado. Hasta que se complete la integración transaccional, el procedimiento seguro ante respuesta incierta sigue siendo revisar las sesiones existentes.

## Diagnóstico de configuración

La página, el endpoint de creación y el de recibos comparten la misma interpretación estricta de las banderas. Solo el valor exacto `true` habilita una opción. Ejecutar `npx tsx scripts/inspect-roleplay-creation-ledger.ts --config-only` para diagnosticar las variables del entorno donde se ejecuta, sin abrir una conexión PostgreSQL ni imprimir sus valores originales.

| Estado | Nuevas creaciones con clave | Consulta de recibos |
| --- | --- | --- |
| disabled | No | No |
| receipts-only | No | Sí |
| blocked-missing-receipts | No (503, diagnóstico exit 1) | No |
| pilot-configured | Sujetas al control de catálogo y permisos | Sí |

El estado pilot-configured solo acredita la configuración local: no confirma el esquema, la versión desplegada ni la autorización de activación. Las solicitudes sin clave conservan su comportamiento. Si se desactiva la creación, mantener recibos habilitados cuando resulte seguro para recuperar solicitudes anteriores.

## Diagnóstico de catálogo previo a activación

Desde un entorno autorizado, con `DIRECT_URL` verificada para el proyecto correcto y TLS configurado, ejecutar `npx tsx scripts/inspect-roleplay-creation-ledger.ts --check-only`. La variante `--require-hardened` devuelve error si el estado no es hardened-catalog. No imprimir la URL ni las credenciales.

El diagnóstico solo consulta metadatos PostgreSQL en una transacción de solo lectura. Distingue absent (tabla ausente), historical (estructura histórica reconocida), incomplete (desviaciones o permisos inseguros) y hardened-catalog (estructura reforzada reconocida). Comprueba columnas, tipos, defaults, restricciones, unicidad, RLS y accesos PUBLIC/anon/authenticated. No lee filas de solicitudes ni aplica SQL staged.

El estado hardened-catalog **no certifica equivalencia semántica de restricciones, historial de migraciones, permisos del usuario runtime ni autorización de despliegue**. Revisar estos puntos y el SHA real antes de activar. La prueba aislada verifica el clasificador contra las dos definiciones SQL y simula pérdida de unicidad, política permisiva y grant de columna, revirtiendo estos cambios en la base temporal.

## Control de disponibilidad en el runtime

Una creación con clave requiere, además de la bandera explícita, un catálogo reconocido como hardened-catalog y permisos efectivos SELECT/INSERT/UPDATE, USAGE del esquema y acceso sin filtrado RLS para la conexión Prisma que realizará la publicación. El control consulta solo metadatos, usa una transacción con snapshot consistente y timeout acotado, y no reutiliza un resultado positivo entre solicitudes. Si falta alguna condición o falla la conexión, devuelve 503 antes de leer multipart, reservar o subir archivos. Las solicitudes sin clave y las consultas read-only de recibos conservan su comportamiento independiente. No concede permisos ni ejecuta migraciones.

Este control es una condición necesaria, no una certificación semántica del SQL ni una garantía contra cambios concurrentes de permisos/esquema después de la inspección. La propuesta de endurecimiento sigue fuera de migraciones automáticas; no activar el piloto hasta validar esquema, identidad del proyecto, permisos y versión real del servicio.

## Verificación integrada de Prisma (CI aislado)

El verificador PostgreSQL existente crea una base temporal, aplica el SQL histórico y el endurecimiento propuesto, y conecta dos clientes Prisma mediante adaptadores explícitos a esa base. Comprueba disponibilidad real antes/después del endurecimiento, huellas de archivos sintéticos, reserva concurrente por actor, conflicto de contenido, publicación/recibo en una transacción, rollback del duplicado, replay, aislamiento por administrador y revisión de un recibo cuya sesión ya no existe. El contrato de recuperación del navegador consume el recibo real mediante un transporte en memoria. Los clientes se desconectan antes de eliminar la base temporal.

La tabla de sesiones es una proyección sintética mínima de id; no equivale al modelo completo ni al endpoint HTTP. No se ejercitan autenticación real, escenarios, Storage, notificaciones ni red del navegador. No sustituye una prueba integral de despliegue en entorno controlado.

## Contrato entre creación y recuperación tras un error posterior al commit

La prueba de rutas ejecuta los handlers reales de creación y consulta de recibos, además del parser de recuperación del navegador, con autenticación, persistencia, Storage y notificaciones simulados. Fuerza un error de notificación después de completar el recibo, verifica que no se eliminen los audios, consulta la clave original desde la misma identidad y comprueba que otra identidad no reciba ese resultado. Un replay de la solicitud original debe devolver la misma sesión sin volver a subir ni notificar. Esta prueba complementa la verificación de transacciones Prisma/PostgreSQL aislada, pero no demuestra un despliegue HTTP completo ni una entrega real de notificaciones.

## Reconciliación y rollback

- **Consulta read-only tras migrar** (con usuario de administración, en el proyecto autorizado): `SELECT status, count(*) FROM public.roleplay_creation_requests GROUP BY status;`. No consultar nombres, secretos, URLs ni contenido de audio.
- **Si la tabla no existe**, nunca convertir P2021 ni cualquier error de DB en una respuesta `CLAIMED`; el código futuro deberá fallar cerrado o mantener la ruta antigua cuando la funcionalidad esté deshabilitada.
- **Para detener nuevas creaciones con clave**, deshabilitar `ROLEPLAY_CREATION_IDEMPOTENCY_ENABLED` y conservar `ROLEPLAY_IDEMPOTENCY_RECEIPTS_ENABLED=true` si la consulta sigue siendo segura. El formulario mantiene la recuperación por referencia, pero las nuevas creaciones sin clave siguen el flujo tradicional. No equivale a bloquear todas las asignaciones. Si también hay que detener la consulta por motivos de seguridad, deshabilitar ambas banderas; no se borran los recibos existentes.
- **No eliminar la tabla** mientras existan filas o solicitudes en curso; la migración no ofrece rollback automático destructivo.

## Precaución de recursos

La idempotencia no elimina los bytes que ya cruzaron el proxy en una primera solicitud multipart: una petición duplicada puede consumir tráfico antes de llegar al parser. Tampoco arregla el pico de memoria de hasta 25×15 MiB. La subida navegador → Storage, con bucket privado y permisos verificados (#287/#368), sigue siendo el objetivo de #290. Nunca ejecutar pruebas de estrés con audio clínico o contra el VPS pequeño.
