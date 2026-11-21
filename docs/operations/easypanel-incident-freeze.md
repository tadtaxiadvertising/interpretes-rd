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

## Protección adicional para construcciones Docker en VPS pequeños

El frontend conserva un `NODE_OPTIONS=--max-old-space-size=2048` durante `npm run build`, mientras el Dockerfile indica que el despliegue histórico apunta a un VPS de aproximadamente 457 MB. El valor de heap es un **límite máximo**, no una medida de consumo real ni prueba de causa raíz. No obstante, compilar Next.js y preparar dependencias Prisma/ONNX/FFmpeg en el mismo VPS puede consumir memoria y disco suficientes para afectar Easypanel, Docker y SSH.

La propuesta `safety/fail-fast-low-memory-easypanel-builds-20261120` añade una protección al principio de los tres Dockerfiles: antes de `npm ci`, leer los límites Linux del host y de cgroup (si existen), rechazar compilaciones cuando hay menos de **3072 MiB totales** o **2048 MiB disponibles** y mostrar un error seguro sin credenciales ni endpoints. Son umbrales conservadores de seguridad, no requisitos oficiales de Next.js ni garantía de capacidad.

**La solución preferida a largo plazo no es elevar el heap o forzar la compilación local:** construir en un runner externo con recursos suficientes, publicar imágenes inmutables y después hacer que Easypanel **solo descargue** la imagen aprobada, con límites de CPU/RAM, rollback y comprobación SHA de ejecución. Configurar esto requiere revisar los registros, el acceso al registry y los servicios de Easypanel cuando vuelva a estar disponible. No activar un pipeline de entrega ni un cambio de Dockerfile en `main` mientras pueda existir un Auto Deploy externo.

Estos controles no son un mecanismo de recuperación del SSH ni sustituyen la revisión de memoria, disco, swap, logs y procesos en el VPS.
