# Recuperación del error Prisma P2022 — VPN en cuentas operativas

**Síntoma:** el administrador `/admin/accounts` falla con `P2022` porque
`public.account_platforms.vpn_country` (u otra de las 11 columnas VPN) no
existe en la base de datos a la que está conectada la versión ejecutada.

## Estado verificado del incidente (18 noviembre de 2026)

La ejecución manual [#44245558076](https://github.com/tadtaxiadvertising/interpretes-rd/actions/runs/44245558076)
del workflow de recuperación terminó satisfactoriamente. Sus registros muestran
que el esquema VPN pasó de **ausente** a **completo**, tras aplicar la migración
y verificar las 11 columnas y el CHECK, sobre la base configurada en el
`DIRECT_URL` de ese workflow.

**No repetir la migración de forma preventiva.** Esa evidencia no demuestra
por sí sola que el `DATABASE_URL` de la aplicación instalada en Easypanel
apunte al mismo destino. Para cerrar #626 se necesita una prueba del runtime
autenticado. Los workflows completos de despliegue siguen bloqueados por
la auditoría de dependencias (#624); no hay constancia de despliegue reciente
de los cambios de código.

### Verificación del runtime con la versión que incluya el diagnóstico VPN

1. Confirmar con el operador, por canal seguro, el destino de la base usada
   por Easypanel y el SHA del código ejecutado, **sin publicar URLs ni secretos**.
2. Una vez desplegada la versión que incluye el PR #676, iniciar sesión
   como administrador y consultar `GET /api/admin/system-readiness`.
   La respuesta autenticada debe indicar `database: "reachable"` y
   `schema.accountPlatformVpnColumns: true` y
   `schema.accountPlatformVpnPortConstraint: true`.
   La respuesta únicamente contiene indicadores de metadatos, no cuentas.
3. Si uno de los indicadores VPN es `false`, registrar el diagnóstico
   y detener cualquier nueva migración hasta aclarar la discrepancia entre
   la base del workflow y la base real de la aplicación.
4. Si ambos son `true`, probar `/admin/accounts` y `/admin/platforms`
   con un administrador autorizado; comprobar que no hay P2022, que las cuentas
   y asignaciones antiguas permanecen y que los enlaces de trabajo usan
   el control VPN previsto. Solo entonces cerrar #626.
5. No interpretar una respuesta `503` de readiness como prueba de que falta
   **solo** VPN: el endpoint también revisa migraciones de Roleplay y otros
   esquemas. Consultar las claves booleanas individualmente.

## Causa y seguridad

El repositorio tiene una migración aditiva existente en
`prisma/migrations/20261117130000_account_platform_vpn_config/migration.sql`.
La secuencia normal de despliegue ya la incluye, **pero solo después** del job
`Validate & Test`. Mientras ese job falle por vulnerabilidades de dependencias,
la migración y el despliegue se omiten. No se debe desactivar el audit para
arreglar el P2022.

La nueva interfaz degrada solo los campos VPN: las cuentas existentes se pueden
consultar y los enlaces de trabajo quedan bloqueados hasta que el esquema
completo esté verificado. Un error de conexión real no se considera esquema
ausente y continúa mostrándose como fallo.

## Procedimiento controlado sin publicar código nuevo

1. El responsable de producción **confirma el destino exacto** de `DIRECT_URL`
   (no confundir con otras bases, ni con `DATABASE_URL` de un entorno de
   prueba). Verifica que la aplicación y la migración apunten a la misma base
   mediante el inventario de Easypanel/gestor de base de datos, sin imprimir
   contraseñas.
2. Obtiene y comprueba que existe un **respaldo restaurable** de esa base y que
   dispone de permisos DDL limitados al objetivo. Revisa cualquier posible
   esquema parcial antes de autorizar cambios.
3. Tras incorporar y revisar el workflow de reparación en `main`, abre
   **GitHub Actions > Repair account VPN schema (manual, no deployment) >
   Run workflow**, selecciona `main` y confirma explícitamente
   `CONFIRMO_BACKUP_Y_DESTINO_PRODUCCION`. Se utiliza el entorno
   `production` y su secreto `DIRECT_URL`. Si falta el secreto o la
   aprobación, la operación debe detenerse.
4. La operación hace una inspección **solo lectura**; ejecuta la migración
   original bajo transacción y bloqueo de migraciones si las 11 columnas
   están ausentes; vuelve a verificar esquema y CHECK. Si hay un esquema
   parcial, un constraint inválido o conflicto con la tabla de historial
   de Prisma, **se detiene sin intentar repararlo automáticamente**.
5. Comprueba en Easypanel la misma base y el endpoint `/admin/accounts`:
   la consulta ya no debe fallar con P2022, los accesos VPN solo deben
   mostrarse si el esquema completo está disponible y las cuentas y
   asignaciones deben conservarse. Documenta internamente SHA desplegado
   y resultado, sin divulgar PII o credenciales.

**IMPORTANTE:** el workflow repara solo el esquema; no dispara webhooks,
no fusiona código y no afirma haber hecho un despliegue. Si la base no es
alcanzable desde GitHub Actions o `DIRECT_URL` está ausente, no hay
reparación automática posible: un operador autorizado debe ejecutar la
migración original de forma transaccional desde un entorno permitido.

## Diagnóstico de solo lectura para el operador

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'account_platforms'
  AND column_name LIKE 'vpn_%'
ORDER BY column_name;

SELECT conname, pg_get_constraintdef(oid) AS constraint_definition, convalidated
FROM pg_constraint
WHERE conrelid = to_regclass('public.account_platforms')
  AND conname = 'account_platforms_vpn_port_range';
```

Son consultas de metadatos; no revelan VPN, cuentas, usuarios ni passwords.
No usar `prisma db push` como sustituto indiscriminado de la migración,
ni volver a ejecutar migraciones históricas sin inspección. En particular,
no ejecutar `DROP TABLE`, `TRUNCATE` ni eliminar columnas/usuarios.

## Verificación y recuperación de errores

- **Esquema totalmente ausente:** ejecutar solo la migración aditiva revisada;
  el guard confirma la postcondición en la misma transacción.
- **Esquema parcial o constraint incorrecto:** parar y abrir incidencia de
  reconciliación con diagnóstico de esquema, sin SQL destructivo.
- **Historial Prisma indica aplicado pero columnas faltan:** parar y
  comparar backup/historial con el administrador; no reescribir historial.
- **Esquema completo pero P2022 persiste:** la aplicación apunta a **otra
  base** o la versión/credencial no corresponde; confirmar DATABASE_URL de
  Easypanel sin divulgar su valor.
- **Conexión o TLS rechazados:** corregir red/credencial/certificado con el
  operador; no desactivar comprobación TLS.

Este procedimiento debe cerrar el incidente P2022 solo cuando se compruebe el
estado de la base y el funcionamiento real del administrador.
