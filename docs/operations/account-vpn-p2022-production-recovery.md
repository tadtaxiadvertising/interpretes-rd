# Recuperación de producción: Prisma P2022 en account_platforms

Incidente: [#626](https://github.com/tadtaxiadvertising/interpretes-rd/issues/626). Síntoma: `prisma.account.findMany()` falla porque falta `public.account_platforms.vpn_country`. No interpretar la presencia del SQL en Git como prueba de que se ejecutó en producción.

## 1. Comprobaciones previas (solo lectura)

Ejecutar sobre **la base de datos de la instancia afectada** con un operador autorizado, sin registrar cadena de conexión, datos de cuentas ni credenciales. Antes de hacer cambios confirmar entorno y copia de seguridad recuperable.

```sql
SELECT current_database() AS database_name, current_schema() AS schema_name;
SELECT migration_name, finished_at, rolled_back_at
FROM public._prisma_migrations
WHERE migration_name = '20261117130000_account_platform_vpn_config'
ORDER BY started_at DESC;

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'account_platforms'
  AND column_name IN (
    'vpn_provider', 'vpn_app', 'vpn_username_hint', 'vpn_secret_ref',
    'vpn_country', 'vpn_region', 'vpn_server', 'vpn_exit_ip',
    'vpn_profile', 'vpn_protocol', 'vpn_port'
  )
ORDER BY column_name;

SELECT conname, convalidated, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = to_regclass('public.account_platforms')
  AND conname = 'account_platforms_vpn_port_range';
```

Se esperan **11 columnas nullable**, diez `text` y una `integer` (`vpn_port`), además de una restricción CHECK validada que permita NULL o puertos entre 1 y 65535.

## 2. Matriz de decisión: no aplicar a ciegas

| Historial Prisma | Columnas / CHECK | Acción |
| --- | --- | --- |
| Aplicada con `finished_at` | Completas | No repetir migración. Investigar SHA desplegado y conexión de la aplicación. |
| Sin registro | Faltan todas | Planificar aplicación controlada de la migración existente mediante **el mecanismo de Prisma Migrate** aprobado para el despliegue, tras revisar migraciones previas, bloqueo de CI y respaldo. |
| Aplicada con `finished_at` | Incompletas | **Detenerse**: desajuste historial/esquema; investigación y reconciliación aprobada, sin DDL automático. |
| Sin registro / fallida | Parciales o CHECK ausente | **Detenerse**: investigar ejecución parcial o cambio manual; no volver a ejecutar el SQL sin reconciliar. |
| `rolled_back_at` o migraciones fallidas | Cualquiera | Investigar el historial y resolver explícitamente antes de desplegar. |

**Advertencia importante:** `npm run migrate -- ... --apply --transaction` ejecuta un archivo SQL directamente a través de `scripts/run-migration.ts`, **pero no escribe en `_prisma_migrations`**. No utilizarlo como sustituto de `prisma migrate deploy` para esta migración gestionada por Prisma; de lo contrario, puede quedar una discrepancia de historial. No ejecutar `prisma db push` ni `prisma migrate resolve --applied` para ocultar un estado desconocido.

## 3. Ventana controlada de corrección

1. Asegurar que se usa `DIRECT_URL` del proyecto y base correctos, con TLS validado y privilegios mínimos; no imprimir su valor.
2. Revisar el estado de **todas** las migraciones anteriores con `prisma migrate status`, y revisar `prisma/migrations/20261117130000_account_platform_vpn_config/migration.sql` antes de permitir cambios.
3. Si el historial está limpio y faltan íntegramente las columnas, ejecutar `prisma migrate deploy` en el proceso autorizado del despliegue, con respaldo y ventana aprobada. No ejecutar DDL desde la interfaz web.
4. Repetir las consultas de solo lectura del punto 1 y verificar todas las columnas y la restricción, no solamente `vpn_country`.
5. Confirmar el commit exacto en ejecución, probar `/admin/accounts` con cuenta administrativa y verificar que ya no aparece P2022; comprobar carga de cuentas y asignaciones sin alterar registros.
6. Solo tras pasar los controles de seguridad y CI (issues [#624](https://github.com/tadtaxiadvertising/interpretes-rd/issues/624) y [#465](https://github.com/tadtaxiadvertising/interpretes-rd/issues/465)), considerar el despliegue definitivo. Registrar evidencia redactada en #626.

## 4. Contención existente en la aplicación

En `src/app/admin/accounts/page.tsx` la consulta inicial selecciona solamente campos de plataforma anteriores al esquema VPN y llama a `inspectAccountVpnSchema`. Los detalles VPN se consultan separadamente únicamente si el esquema está completo. El aviso administrativo bloquea la apertura de portales hasta verificar la migración. Esta medida **mitiga la caída de la lista**, pero no demuestra que el runtime de Easypanel tenga el commit actualizado ni reemplaza la corrección de esquema.

**Reglas:** no publicar datos de usuarios, contraseñas, IP de salida de VPN, tokens, URLs de conexión ni capturas de cuentas reales en GitHub. No modificar datos de negocio para resolver una migración de columnas nullable.
