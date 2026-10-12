# Recuperación del esquema de producción — 12 de octubre de 2026

## Propósito

Versionar la reconciliación aditiva que alinea el esquema real de Supabase con los modelos actuales de `prisma/schema.prisma`. El script de esquema está en `scripts/migrations/20261012_runtime_schema_alignment.sql` y puede ejecutarse mediante el ejecutor seguro del repositorio.

La intervención conserva las columnas heredadas para compatibilidad. No elimina tablas o filas, no crea cuentas de usuario y no cambia las credenciales de Auth. Los campos heredados de notificaciones (`userid`, `createdat`) se conservan; `notifications.id` se amplía a `text` porque los UUID de 36 caracteres no cabían en el límite antiguo de 30.

## Cambios aplicados en Supabase

Proyecto: `kzbkygppplknynrwmtmf`.

- Alineación del esquema base para los 34 modelos/tables de Prisma que faltaban parcialmente en producción.
- Columnas del perfil para bancos, aceptación de términos y estado canónico del onboarding.
- Campos de notificación nuevos y compatibilidad con columnas antiguas.
- Tablas de reclutamiento, roleplay, QA, producción/nómina, RBAC y bóveda con restricciones e índices.
- Enum de roleplay completo y valor predeterminado `DRAFT`; transición del valor legado `PENDING` a `DRAFT`.
- Corrección de campos físicos con nombres camelCase que Prisma no mapea a snake_case: `recruitment_applications."currentStep"`, `roleplay_responses."selfScore"` y `password_reset_tokens."createdAt"`.

No se sembraron usuarios ni se alteraron las identidades existentes de Supabase Auth.

## Verificación realizada

- Supabase confirmó 34 tablas de la aplicación, además de `_prisma_migrations`.
- La consulta de control no encontró ausencias en la lista de columnas requeridas por las consultas de runtime verificadas.
- `roleplay_sessions.status` tiene el default `DRAFT` y el enum contiene el ciclo de vida completo.
- Prueba transaccional de inserción ejecutada sobre reclutamiento, perfiles, notificaciones, roleplay, RBAC y bóveda; todas las operaciones completaron y se hizo `ROLLBACK`. Una consulta posterior confirmó cero filas de prueba.
- El workflow de GitHub del commit que ya está en `main` reportó éxito para validación/build y los dos webhooks de despliegue a Easypanel respondieron con éxito. Eso comprueba el lanzamiento del webhook, no una prueba E2E de cada pantalla.

## Operación

Para re-ejecutar la alineación en un ambiente controlado con sus variables `DIRECT_URL` y `DATABASE_URL` configuradas en tiempo de ejecución:

```bash
npm run migrate -- scripts/migrations/20261012_runtime_schema_alignment.sql --apply
```

Antes de usarlo en otro ambiente, respaldar la base y revisar diferencias del esquema; la migración está diseñada para ser idempotente, pero no reemplaza una estrategia de datos específica para ambientes con filas en conflicto.

Las migraciones de conciliación específicas para perfil/notificaciones y el default de roleplay siguen en `prisma/migrations/20261012_reconcile_production_runtime/migration.sql` y `prisma/migrations/20261012_align_roleplay_status_default/migration.sql`.

## Pendientes que requieren intervención prudente

1. Las tablas de negocio expuestas siguen con RLS deshabilitado. En las comprobaciones, los roles SQL `anon` y `authenticated` no tenían permisos directos de tabla, pero el asesor de Supabase sigue marcando RLS. No activar RLS sin definir y probar políticas por tabla y rol; de lo contrario se pueden romper los flujos legítimos. Referencia: https://supabase.com/docs/guides/database/postgres/row-level-security
2. Se encontraron usuarios existentes en Supabase Auth sin perfil público ni vínculo demostrado a una fila de intérprete. No asociarlos ni recrearlos automáticamente: hay que reconciliar la identidad basándose en evidencia autoritativa.
3. Vercel seguía reportando un estado de check fallido en la observación de esta ejecución. El proyecto documenta Easypanel como destino principal y los dos webhooks de Easypanel sí finalizaron; aún falta una prueba E2E externa de inicio de sesión y rutas protegidas.
4. Las credenciales que aparecieron en logs compartidos anteriormente deben rotarse desde los paneles correspondientes. Nunca copiar claves reales a este repositorio ni exponerlas en logs.

## Criterio de cierre

No declarar “sin errores” hasta comprobar inicio y cierre de sesión con cuentas autorizadas, perfil/onboarding, notificaciones, Roleplay y reclutamiento en el despliegue activo, revisar errores de runtime y terminar el diseño de políticas RLS.
