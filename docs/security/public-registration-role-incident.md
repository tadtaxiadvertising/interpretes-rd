# Intérpretes RD — revisión de roles creados mediante registro público

**Severidad: crítica (riesgo de escalada de privilegios).**
Este documento no confirma una intrusión. El repositorio contenía un registro
público que aceptaba un rol privilegiado proporcionado por la solicitud.
El estado del backend efectivamente publicado en Easypanel no ha sido verificado.

## Contención y despliegue

1. Un operador autorizado debe determinar qué SHA y qué imagen Express están
   realmente activos. Si la versión vulnerable está expuesta, bloquear
   temporalmente **solo POST /api/auth/register** en el proxy/API hasta que el
   parche esté desplegado. No bloquear la verificación de salud ni romper
   necesariamente el inicio de sesión de usuarios existentes.
2. Antes de revisar o modificar cuentas, generar un respaldo mediante el
   proceso autorizado y utilizar acceso de base de datos **solo lectura**.
3. No fusionar ni desplegar automáticamente con `Dependency Security Audit`
   fallido. Aplicar el proceso formal de respuesta a incidentes si la exposición
   requiere contención inmediata.
4. No publicar listas de usuarios, hashes de contraseñas, JWT, URLs de
   conexión, datos de VPN ni resultados personales en GitHub o ChatGPT.

## Consultas de diagnóstico (solo SELECT)

Ejecutar únicamente en una sesión restringida por personal autorizado:

```sql
SELECT role, COUNT(*)::bigint AS total
FROM public.rbac_users
GROUP BY role
ORDER BY role;

SELECT id, email, role, "createdAt", "updatedAt"
FROM public.rbac_users
WHERE role IN ('ADMIN', 'HOLDER')
ORDER BY "createdAt" DESC;
```

La segunda consulta contiene datos personales y **no se debe adjuntar a una
incidencia pública**. Comparar cada cuenta privilegiada con las autorizaciones
y registros internos. Una cuenta ADMIN no es sospechosa por sí sola.

## Si se confirma un registro no autorizado

- Registrar y preservar evidencias mediante el procedimiento interno.
- Revocar los accesos indebidos utilizando una cuenta administrativa legítima,
  con autorización, respaldo y trazabilidad. **No** eliminar ni degradar todas
  las cuentas con rol ADMIN automáticamente.
- Coordinar una rotación del `JWT_SECRET` del backend Express para invalidar
  tokens anteriores; esto obliga a volver a iniciar sesión. Verificar que todos
  los servicios que emiten o verifican esos JWT usen el secreto correcto, sin
  imprimirlo.
- Revisar acciones administrativas realizadas por las identidades afectadas,
  especialmente creación/modificación de cuentas y datos sensibles.
- Verificar el comportamiento de POST /api/auth/register: una cuenta nueva sin
  rol solicitado debe tener INTERPRETER, y solicitudes públicas con ADMIN o
  HOLDER deben rechazarse.
- Registrar el SHA desplegado y confirmar el cierre **solo después** de
  revisión, pruebas y verificación en Easypanel.

El parche no revisa, revoca ni modifica por sí mismo usuarios históricos.
