# Imágenes Docker fuera del VPS — procedimiento preparado, NO habilitar despliegue

## Objetivo y estado

Mientras Easypanel y SSH no estén verificados, **no construir imágenes dentro del VPS** y no reactivar sus webhooks, migraciones ni Auto Deploy. La congelación de producción de #751 permanece activa. Este repositorio prepara un workflow separado, estrictamente **manual**, que compila **un componente cada vez en un runner hospedado por GitHub**, sin conexión de administración con Easypanel ni modificaciones a la base de datos de producción.

**Este workflow no publica ni despliega nada automáticamente.** Su modo inicial `build-only` crea una imagen dentro del runner desechable. `publish-ghcr` es una decisión explícita e independiente que almacena una imagen etiquetada por SHA en GitHub Container Registry; **publicar en GHCR no equivale a desplegarla en Easypanel**.

## Preparación para cuando se restablezca el control del servidor

1. Recuperar el acceso al proveedor/VPS mediante consola fuera de banda o soporte; inspeccionar causas de pérdida de SSH, OOM, memoria, disco, proxy y el histórico de Easypanel. Deshabilitar temporalmente **Auto Deploy nativo** antes de cualquier merge posterior.
2. Aprobar el PR del workflow con sus checks verdes; revisar costes de runners y almacenamiento GHCR. No utilizar un runner `self-hosted` de la misma máquina de producción.
3. Configurar como **variables de Actions** (no secretos de backend) los valores públicos de compilación del frontend: `RELEASE_NEXT_PUBLIC_SUPABASE_URL`, `RELEASE_NEXT_PUBLIC_SUPABASE_ANON_KEY`, `RELEASE_NEXT_PUBLIC_API_URL` y, si aplica, `RELEASE_NEXT_PUBLIC_APP_ROLE`. Validar que correspondan al entorno autorizado. **No introducir `DIRECT_URL`, service-role, tokens de HappyScribe, URLs secretas del webhook o credenciales de base de datos en build args.**
4. En Actions, abrir **Prepare Docker image off-VPS (manual; no deploy)**, seleccionar exactamente uno de `frontend`, `api` o `worker`; mantener `build-only` durante la primera comprobación. Seleccionar `CONFIRMO_COMPILACION_FUERA_DEL_VPS` después de revisar el origen y la identidad del commit.
5. Para almacenar la imagen sin desplegar, elegir explícitamente `publish-ghcr`. La acción usará el `GITHUB_TOKEN` limitado al job de publicación y creará una etiqueta `sha-<commit completo>` para **ese** componente. Las etiquetas GHCR no son necesariamente inmutables: una vez publicada, inspeccionar su **digest `sha256:`** y fijar ese digest en una futura configuración de release.
6. Antes de cambiar a imágenes precompiladas en Easypanel, confirmar políticas de acceso a GHCR (si son privadas, permisos del pull token), mapeos de puerto, variables runtime, certificados, health checks, recursos CPU/RAM, rollback y SHA real. Preparar backup y ventana de mantenimiento.
7. Rehabilitar los despliegues únicamente a través de una revisión separada y controlada. **No** convertir un `docker push` a GHCR en un webhook POST automático de Easypanel. Esperar salud y confirmación de cada componente antes de seguir.

## Restricciones técnicas verificables

- Workflow solamente con `workflow_dispatch`; sin `push`, `pull_request` ni `schedule`.
- Solo acepta ejecución de `main` tras confirmación explícita; el script rechaza cualquier runner que no sea `github-hosted`.
- Antes de cualquier `docker build`, verifica por API autenticada de GitHub que `main` todavía apunta al SHA del evento y que el CI/CD principal, calidad estática y E2E aislado del **mismo SHA**, con evento `push`, estén `completed/success`. Si faltan evidencias, una prueba está pendiente o la API falla, se bloquea la operación sin construir nada.
- Para el modo `publish-ghcr`, comprueba nuevamente el SHA y los tres workflows **después de compilar e inmediatamente antes de autenticar/publicar**. El token solo requiere `actions: read` / `contents: read` para la consulta; el permiso `packages: write` se mantiene exclusivamente en el job de publicación.
- `build-only` conserva exclusivamente `contents: read`, sin acceso de escritura al registro.
- `publish-ghcr` se autentica a `ghcr.io` exclusivamente y no llama SSH, panel ni servicios de producción.
- Solo imágenes etiquetadas con `sha-<SHA>`, jamás `:latest`. La identificación final de despliegue requiere digest.
- Se verifican estas propiedades con `scripts/ci/build-image-offhost.test.mjs`, integrado en `Validate & Test`.

## Limitación crítica

El workflow **no resuelve un VPS caído**. Con la protección activa y el SSH perdido, la única vía de recuperación del panel y la máquina es el proveedor/console fuera de banda o soporte. Tampoco existe confirmación desde aquí de que Easypanel haya desactivado su Auto Deploy nativo. No activar el workflow ni configurar una publicación nueva mientras esa incertidumbre persista. Los PR de endurecimiento posteriores deben quedar en borrador hasta verificar el Auto Deploy externo.
