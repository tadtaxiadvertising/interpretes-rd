# Procedimiento de emergencia para acuerdos legales

## Regla predeterminada

`scripts/ensure-legal-agreement.ts` es seguro por defecto: si encuentra un acuerdo publicado, verifica el SHA-256 y termina sin modificar datos. Si no existe un acuerdo publicado, termina con error y **no crea ni publica el contrato histórico de ejemplo**.

El flujo normal para preparar y publicar acuerdos es el panel administrativo versionado, con revisión de contenido, revisión jurídica y comprobación del hash.

## Publicación excepcional

Usar solo si el panel administrativo no está disponible, existe una aprobación jurídica documentada y un responsable autorizado ha revisado el contenido exacto. Preferir ejecutar contra staging primero.

Variables requeridas para publicar excepcionalmente:

- `LEGAL_AGREEMENT_ALLOW_PUBLISH=true`
- `LEGAL_AGREEMENT_APPROVED=true`
- `LEGAL_AGREEMENT_APPROVED_BY`: identidad verificable del responsable que autoriza la publicación.
- `LEGAL_AGREEMENT_APPROVAL_REFERENCE`: referencia de ticket, acta o aprobación registrada.
- `LEGAL_AGREEMENT_VERSION`: versión nueva, única y con formato alfanumérico, punto, guion o guion bajo.
- `LEGAL_AGREEMENT_TITLE`: título aprobado.
- `LEGAL_AGREEMENT_CONTENT`: contenido completo aprobado, entre 100 y 100000 caracteres.

No usar el contenido genérico histórico como sustituto de revisión legal. Nunca pegar secretos de conexión en tickets, comandos guardados, logs o este documento. Inyectar las variables mediante el gestor de secretos del entorno autorizado.

## Controles de la operación

1. Confirmar entorno, host y base de datos antes de ejecutar.
2. Conservar la referencia de aprobación y el hash SHA-256 resultante en el registro de cambio.
3. Verificar que la versión publicada y el contenido son los aprobados.
4. Ejecutar una prueba de lectura/aceptación en staging.
5. Si existe una versión publicada, el script no la reemplaza ni publica otra automáticamente.
6. No fabricar aceptación retroactiva ni editar una versión publicada.

## Reversión

Las versiones publicadas y la evidencia de aceptación deben tratarse como historial inmutable. Ante un error, no reescribir ni borrar aceptaciones: preparar una nueva versión correctiva, aprobarla y publicarla por el flujo autorizado.
