# Congelación preventiva de producción — incidente Easypanel

**Estado:** bloqueo de emergencia, pendiente de verificación y aprobación. El repositorio puede validar código en GitHub Actions, pero no debe iniciar despliegues, migraciones o llamadas HTTP de cron a producción.

## Qué queda bloqueado por el código

- `.github/workflows/deploy.yml`: jobs de despliegue frontend, API y worker **deshabilitados de forma literal** (no se pueden habilitar con una variable ni con `workflow_dispatch`). No se ejecutan las migraciones de ese job ni los webhooks. Las validaciones aisladas siguen funcionando.
- `.github/workflows/manual-account-vpn-schema-repair.yml`: reparación manual del esquema de producción deshabilitada.
- `.github/workflows/cron-shift-reminders.yml`: POST manual al endpoint de recordatorios deshabilitado.
- `.github/workflows/orphan-audio-cleanup.yml`: sin ejecución semanal y sin inventario manual hacia producción.
- `src/lib/security/github-production-incident-freeze.test.ts`: prueba estática para impedir que estas protecciones se retiren accidentalmente.

El diagnóstico **manual y de solo lectura** de conectividad y la consulta de versión pueden servir a operaciones. Sus resultados no prueban que Easypanel esté saludable.

## Limitaciones importantes

**Esta protección solo gobierna GitHub Actions.** No desactiva una posible integración de Auto Deploy independiente dentro de Easypanel, un watcher de Git, ni jobs cron que ejecuten directamente el VPS. Un merge a `main` podría activar mecanismos externos que este repositorio no controla. Por ello, mientras se haya perdido acceso a SSH/Easypanel, **mantener esta propuesta como PR sin fusionar**, a menos que un operador pueda confirmar que no hay Auto Deploy nativo habilitado.

No hay evidencia suficiente para atribuir la indisponibilidad del VPS a un commit concreto. Hubo fallos del webhook `curl_exit=28`/HTTP `000` antes de la incorporación del sondeo automático del PR #749.

## Antes de recuperar el despliegue

1. Recuperar acceso al proveedor/VPS por consola fuera de banda o soporte, sin compartir secretos ni claves en issues.
2. Verificar estado de recursos del host, SSH, proxy, Easypanel y contenedores, así como el historial de despliegues. Identificar si un Auto Deploy externo sigue activo y deshabilitarlo durante la recuperación.
3. Confirmar la salud y SHA real de frontend/API/worker. Un check verde de CI **no significa** despliegue exitoso.
4. Asegurar copias de seguridad y una ventana de cambios; no ejecutar migraciones históricas ni reintentar webhooks por un error ambiguo.
5. Configurar reglas de protección de `main` (#465), someter un PR explícito de descongelación a CI íntegro y revisión independiente.
6. Ejecutar como máximo una publicación controlada tras verificar la ruta de red y confirmar su resultado antes de otra petición.

Si el acceso al panel sigue caído, continuar el desarrollo únicamente en ramas o PRs de GitHub sin fusionar hasta entender el mecanismo de despliegue externo.

Seguimiento: #747, #626, #465.
