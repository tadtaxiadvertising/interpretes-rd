# Recuperación del esquema de producción — 12 de octubre de 2026

## Propósito

Registrar la reconciliación aditiva entre Supabase y los 34 modelos de `prisma/schema.prisma`, y dejar las operaciones reproducibles desde el repositorio.

La intervención conserva las columnas heredadas para compatibilidad. No elimina tablas o filas, no crea cuentas de usuario y no cambia credenciales de Auth. Los campos heredados de notificaciones (`userid`, `createdat`) se conservan; `notifications.id` se amplió a `text` porque un UUID de 36 caracteres no cabía en el límite antiguo de 30.

## Cambios aplicados y verificados en Supabase

Proyecto: `kzbkygppplknynrwmtmf`.

- Alineación de las 34 tablas de la aplicación con el catálogo del esquema Prisma; incluye reclutamiento, roleplay, QA, producción/nómina, RBAC y bóveda.
- Columnas de perfil para datos bancarios, aceptación de términos y estado canónico de onboarding.
- Nuevos campos de notificaciones y compatibilidad con columnas heredadas.
- Enum y ciclo de vida completos de roleplay; estado predeterminado `DRAFT`.
- Corrección de campos físicos camelCase no mapeados a snake_case: `recruitment_applications."currentStep"`, `roleplay_responses."selfScore"` y `password_reset_tokens."createdAt"`.
- RLS habilitado en las 34 tablas de negocio. No se crearon políticas permisivas.
- Confirmado: cero tablas de negocio sin RLS, cero permisos directos de tabla para los roles SQL `anon` y `authenticated`, cero columnas requeridas ausentes en la verificación realizada.

No se sembraron usuarios ficticios ni se alteraron las identidades existentes de Supabase Auth.

## Validaciones ejecutadas

- La consulta de esquema confirmó 34 tablas de aplicación y ninguna columna requerida ausente en la lista de runtime inspeccionada.
- `roleplay_sessions.status` tiene default `DRAFT`.
- Prueba transaccional de escritura sobre reclutamiento, perfiles, notificaciones, roleplay, RBAC y bóveda finalizó correctamente con `ROLLBACK`; una consulta posterior confirmó que no dejó registros de prueba.
- La alineación versionada se aplicó dos veces satisfactoriamente, verificando idempotencia.
- El workflow de `main` en GitHub pasó Prisma Validate/Generate, TypeScript, ESLint, tests y build; los webhooks de ambos despliegues de Easypanel terminaron con éxito. Esto valida CI y la llamada a los webhooks, no sustituye una prueba E2E externa de las pantallas y el login.

## Ejecución segura

Para reaplicar el esquema de forma controlada, con `DIRECT_URL` y `DATABASE_URL` configuradas solo en el entorno de ejecución y después de respaldar la base:

```bash
npm run migrate -- scripts/migrations/20261012_runtime_schema_alignment.sql --apply
```

Después, activar RLS en todas las tablas públicas de la aplicación:

```bash
npm run migrate -- scripts/migrations/20261012_enable_public_rls.sql --apply
```

La segunda migración asume el acceso de datos a través de Prisma en el servidor y verifica que `anon` y `authenticated` no tengan permisos directos de tabla. Si el proyecto decide exponer tablas por la Data API, diseñar primero políticas específicas para cada recurso y propietario; no añadir una política genérica para todas las tablas. Referencia: https://supabase.com/docs/guides/database/postgres/row-level-security

## Pendientes que no deben resolverse adivinando datos

1. Se encontraron usuarios en Supabase Auth sin perfil público ni vínculo demostrado con un intérprete. No asociarlos automáticamente ni recrearlos: la relación debe reconciliarse con registros oficiales de identidad/reclutamiento.
2. El asesor de Supabase marca desactivada la protección de contraseñas filtradas. Activarla desde la configuración de Auth.
3. Rotar desde los paneles correspondientes todas las credenciales que se compartieron en logs anteriores. Una clave eliminada de un archivo o de logs todavía pudo haberse expuesto históricamente; rotarla es necesario. No incluir claves reales en el repositorio ni en los logs.
4. Confirmar la configuración SMTP y la lista de URL de redirección de Supabase Auth. El código de recuperación usa `resetPasswordForEmail`, no imprime enlaces secretos en logs y el callback ahora valida el origen configurado y acepta solo rutas internas. No se envió ni verificó un correo real como parte de esta intervención.
5. El workflow de `main` confirmó la llamada a Easypanel; no fue posible comprobar desde el entorno de herramientas una prueba HTTP E2E de inicio de sesión y rutas protegidas. Un estado de Vercel también aparecía fallido en las comprobaciones anteriores; el despliegue primario documentado aquí es Easypanel.

## Criterio honesto de cierre

El esquema de producción y las pruebas técnicas descritas quedaron corregidos. No declarar “sin errores en todos los flujos” hasta validar el login real con cuentas autorizadas, correo de recuperación, perfil/onboarding, notificaciones, Roleplay y reclutamiento sobre la URL de producción, además de confirmar la rotación de secretos.
