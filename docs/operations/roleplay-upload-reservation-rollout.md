# Intérpretes RD — preparación del registro de reservas de subida (NO activar)

**Estado al 22-11-2026:** el SQL sigue solo en `docs/operations/staged-sql/roleplay-upload-reservations.sql` y no se ha instalado en producción. El contrato Prisma y el helper de idempotencia están desconectados del HTTP y del almacenamiento. **No generar firmas ni enviar audio al nuevo bucket por esta guía.**

## Etapa 0 — Diagnóstico de solo lectura

Antes de cualquier cambio, un operador con autorización y una conexión `DIRECT_URL` de **servidor** (nunca desde el navegador) puede ejecutar:

```bash
npx tsx scripts/inspect-roleplay-upload-reservation-schema.ts --check-only
```

El inspector utiliza la configuración TLS autenticada existente, `BEGIN READ ONLY`, consultas a `pg_catalog` / `information_schema` y `ROLLBACK`. No lee filas de sesiones, audio, credenciales ni URLs; no aplica SQL ni modifica la base. Imprime solamente uno de estos estados:

- `absent`: no existe la tabla esperada; estado normal mientras la migración siga staged.
- `incomplete`: existe una estructura que no coincide con el contrato (columnas/tipos/defaults, clave única, restricciones, RLS, políticas o grants). **Detener el rollout** y revisar manualmente.
- `catalog-ready`: metadatos mínimos conformes. **No constituye autorización para activar**: no demuestra semántica completa de expresiones CHECK, permisos heredados, control de propietarios, compatibilidad real de Easypanel ni integridad de audios.

Para una comprobación que deba fallar si todavía no está instalado el esquema:

```bash
npx tsx scripts/inspect-roleplay-upload-reservation-schema.ts --require-ready
```

No utilizar `--require-ready` como reparación automática. No volcar la salida de `DIRECT_URL`, secretos de Supabase ni errores de PostgreSQL a los registros.

## Etapa 1 — Validación segura antes de instalar (pendiente)

1. Verificar respaldo **restaurable**, ventana de mantenimiento, destino y TLS de `DIRECT_URL`, tablas existentes, posibles entradas de `_prisma_migrations` y compatibilidad con las versiones realmente desplegadas de Next.js y Prisma.
2. Exigir un `main` verde y atestación de la versión instalada en Easypanel. Un merge en GitHub **no demuestra despliegue**.
3. Mantener el SQL staged fuera de `prisma/migrations`. No hay un comando de instalación autorizado en esta guía. `scripts/run-migration.ts` **rechaza** los archivos de `docs/operations/staged-sql`.
4. El paso `Verify staged Roleplay upload reservations (isolated PostgreSQL only)` en CI aplica el borrador en otra base PostgreSQL desechable, prueba dos conexiones concurrentes, idempotencia, restricciones de datos, estado y rollback, y destruye esa base. Esto **no instala la tabla en Supabase**.
5. Reconciliar cualquier estado `incomplete` o deriva de historial con el DBA. No ejecutar `CREATE TABLE IF NOT EXISTS` ni `prisma migrate resolve` automáticamente para ocultar conflictos.

## Etapa 2 — Integración y activación (pendiente, cambios separados)

Una vez que el esquema instalado esté aprobado y verificado, el servicio nuevo deberá autenticar la sesión **administrativa** y cualquier Bearer explícito como **la misma identidad**, con protección de tasa. Solo entonces podrá reclamar una reserva `(actor_user_id, request_key)` dentro de PostgreSQL.

Una repetición de solicitud debe reconciliar el lote guardado sin crear otra reserva ni emitir nuevas capacidades de subida silenciosamente. Las capacidades de Storage serán temporales, limitadas al bucket `roleplay-audio-private` y a rutas canónicas del lote. El servicio deberá verificar **desde bytes confiables** SHA-256 y tamaño de los 1–25 objetos; la publicación necesita una transición atómica `VERIFIED → PUBLISHED` dentro de la misma transacción que crea o reanuda el roleplay.

Los audios históricos del bucket público `roleplay-audio` requieren un plan separado de migración de lecturas hacia URLs autorizadas. No cambiar el bucket ni borrar audios previos en esta etapa.

## Etapa 1.5 — Reconciliación de reserva (helper preparado; sin HTTP)

`src/lib/roleplay/direct-upload-reservation-reconciliation.ts` es un componente **de lectura servidor, aún desconectado**. Reutiliza exactamente el digest canónico de `direct-upload-reservation-ledger.ts` y solo consulta por la clave compuesta `(actor_user_id, request_key)`; selecciona propietario, huella, estado y fechas, **nunca** los bytes, JSON de evidencias, rutas ni tokens. La identidad administrativa y el Bearer explícito deben verificarse en la futura capa HTTP antes de llamar el helper.

El resultado identifica una **siguiente revisión necesaria**, no una acción automática: `INSPECT_STORAGE` para `RESERVED/VERIFYING`; `VERIFY_SERVER_EVIDENCE` para `VERIFIED`; `PUBLISHED_REQUIRES_CONFIRMATION` para `PUBLISHED` (el estado por sí solo no prueba que la sesión se haya confirmado); `CLOSED` para canceladas; `EXPIRED` para abiertas caducadas; `NOT_FOUND` cuando no hay fila; `CONFLICT` ante propietario/huella incompatibles; y `REVIEW_REQUIRED` para datos incoherentes. Los errores de conexión se reducen a `STORE_UNAVAILABLE`, sin mensajes del proveedor. **Ningún resultado** permite inferir que hay que emitir otra URL, reintentar con otra clave, eliminar archivos, continuar automáticamente una publicación o afirmar al usuario que la sesión está lista.

En particular, `NOT_FOUND` tras un timeout no demuestra que el intento original no haya llegado a otro servicio. La futura recuperación debe respetar una sola clave por operación, consultar el estado de los objetos en Storage desde un actor confiable y verificar referencias de sesión antes de cambios. Para `PUBLISHED`, una reconciliación definitiva necesita un vínculo transaccional explícito con la sesión que se creó, actualmente ausente en el borrador de tabla.

Este componente **no** crea migraciones, tablas, APIs, registros, objetos de Storage ni capacidades. Las pruebas utilizan filas sintéticas y comprueban aislamiento por administrador, digest estable, expiración, estados terminales, errores y ausencia de escrituras. No supone que el esquema exista en producción.

## Etapa 1.75 — Comprobante transaccional de publicación (STAGED, no activado)

El esquema propuesto añade `published_session_ids TEXT[] NOT NULL DEFAULT '{}'` a `roleplay_upload_reservations`. Solo permite una lista **no vacía** de identificadores de sesión cuando `status='PUBLISHED'`; exige una lista vacía en los demás estados. No guarda URLs de audio, tokens ni credenciales. El catálogo de solo lectura y el ensayo PostgreSQL descartable exigen ahora la columna y la restricción y comprueban que dos publicadores simultáneos no registran dos comprobantes. **Este SQL continúa fuera de `prisma/migrations` y no está instalado en Supabase.**

`src/lib/roleplay/direct-upload-publication-receipt.ts` implementa un paso **todavía desconectado del HTTP**, para ejecutarse únicamente dentro de la **misma transacción Prisma** que haya creado o reutilizado las sesiones de Roleplay. Revalida la reserva completa y su evidencia confiable cargada desde servidor, exige IDs únicos de sesión y efectúa un único `updateMany` condicional que comprueba lote, administrador, clave idempotente, digest, `VERIFIED`, reloj y vencimiento. Solo un publicador puede conseguir `count=1`. Si el resultado no es uno o ocurre cualquier error, el caller **debe dejar escapar la excepción de la transacción**, revirtiendo también las sesiones nuevas. Está prohibido llamar a esta función después de confirmar las sesiones.

Una respuesta `PUBLISHED` no demuestra por sí sola que las sesiones realmente existan. No hay **FK de `published_session_ids` a `roleplay_sessions`**, por lo que el futuro servicio de reconciliación tendrá que cargar y comprobar todas las sesiones por ID y propiedad de la publicación antes de responder éxito. La integridad SHA-256 requiere verificar los bytes reales en Storage; ni el digest del navegador ni el comprobante sustituyen esa operación. Para sesiones antiguas no hay backfill ni copia de audios. El ledger de creación separado `roleplay_creation_requests` tampoco debe declararse activo hasta desplegar y validar su propia migración.

## Bloqueos explícitos

- Falta autorización y plan de aplicación del esquema en producción.
- Falta ruta autenticada de reserva y reconciliación real después de timeout.
- Falta la generación de tokens firmados y un verificador de objetos confiable.
- Falta publicación transaccional y recuperación de sesiones sin duplicación.
- Falta validación de la versión efectivamente desplegada en Easypanel.

**El estado `catalog-ready` es un requisito diagnóstico, no un interruptor de producción.**
