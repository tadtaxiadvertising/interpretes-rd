# Intérpretes RD · Idempotencia duradera de creación de Roleplays

## Estado de la fase

**Preparación de persistencia y pruebas, no activada.** Esta fase añade el modelo Prisma `RoleplayCreationRequest`, su migración SQL y funciones `fingerprintRoleplayCreation`, `claimRoleplayCreation` y `completeRoleplayCreationInTransaction`. El endpoint `POST /api/admin/roleplays` y el formulario siguen funcionando exactamente como antes: **todavía no envían ni aceptan claves de idempotencia**.

La migración es aditiva, sin modificación ni eliminación de sesiones/escenarios/audio existentes, con RLS habilitado y sin acceso directo a `anon`, `authenticated` ni `PUBLIC`. No se ha ejecutado en producción.

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

**No activar la bandera como sustituto del backend:** el endpoint de creación todavía no genera ni completa recibos, de modo que `NOT_FOUND` hoy no demuestra que una publicación haya fallado. Hasta que se complete la integración transaccional, el procedimiento seguro ante respuesta incierta sigue siendo revisar las sesiones existentes.

## Reconciliación y rollback

- **Consulta read-only tras migrar** (con usuario de administración, en el proyecto autorizado): `SELECT status, count(*) FROM public.roleplay_creation_requests GROUP BY status;`. No consultar nombres, secretos, URLs ni contenido de audio.
- **Si la tabla no existe**, nunca convertir P2021 ni cualquier error de DB en una respuesta `CLAIMED`; el código futuro deberá fallar cerrado o mantener la ruta antigua cuando la funcionalidad esté deshabilitada.
- **Para detener la funcionalidad**, deshabilitar primero la bandera de activación; las solicitudes existentes siguen siendo datos de auditoría y no se borran.
- **No eliminar la tabla** mientras existan filas o solicitudes en curso; la migración no ofrece rollback automático destructivo.

## Precaución de recursos

La idempotencia no elimina los bytes que ya cruzaron el proxy en una primera solicitud multipart: una petición duplicada puede consumir tráfico antes de llegar al parser. Tampoco arregla el pico de memoria de hasta 25×15 MiB. La subida navegador → Storage, con bucket privado y permisos verificados (#287/#368), sigue siendo el objetivo de #290. Nunca ejecutar pruebas de estrés con audio clínico o contra el VPS pequeño.
