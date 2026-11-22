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

## Bloqueos explícitos

- Falta autorización y plan de aplicación del esquema en producción.
- Falta ruta autenticada de reserva y reconciliación real después de timeout.
- Falta la generación de tokens firmados y un verificador de objetos confiable.
- Falta publicación transaccional y recuperación de sesiones sin duplicación.
- Falta validación de la versión efectivamente desplegada en Easypanel.

**El estado `catalog-ready` es un requisito diagnóstico, no un interruptor de producción.**
