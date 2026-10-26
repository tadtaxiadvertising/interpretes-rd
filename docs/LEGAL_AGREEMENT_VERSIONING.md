# Arquitectura propuesta: acuerdos legales versionados

## Objetivo

Permitir que el equipo administrativo prepare, revise y publique acuerdos de onboarding sin modificar el contenido que una persona ya aceptó. Cada aceptación debe poder vincularse a una versión exacta e inmutable del texto publicado.

Este documento es un diseño de implementación; no sustituye la revisión legal del contrato ni afirma que la plataforma ya tenga esta funcionalidad.

## Hallazgos verificados

- El texto del contrato está embebido en `src/components/OnboardingWizard.tsx` como `LEGAL_CONTENT`.
- La versión se mantiene como constante `TERMS_VERSION` en `src/app/actions/onboarding.ts`.
- La aceptación se refleja en `UserProfile.termsAcceptedAt`, `UserProfile.signatureDate` y una marca de texto en `Interpreter.notas`.
- El código que añade la marca evita duplicarla si ya existe `[TERMS_ACCEPTED]`; por tanto, no constituye un historial de aceptaciones por versión.
- `completeOnboarding` comprueba la existencia de una fecha/marca y datos bancarios, pero no comprueba una aceptación asociada a la versión publicada actualmente.
- No se encontró un flujo administrativo de borrador/publicación para el contrato.

## Modelo de datos propuesto

### `LegalAgreement`

Representa el tipo de documento, por ejemplo `freelance-services`.

- `id`: identificador.
- `key`: clave única estable.
- `title`: título administrativo.
- `currentPublishedVersionId`: referencia opcional a la versión publicada actual.
- `createdAt`, `updatedAt`.

### `LegalAgreementVersion`

Cada edición es una fila nueva. Una versión publicada no se edita en sitio.

- `id`, `agreementId`, `versionNumber`.
- `contentMarkdown`: contenido íntegro presentado al usuario.
- `contentSha256`: hash calculado en el servidor sobre el contenido normalizado.
- `status`: `DRAFT`, `PUBLISHED` o `ARCHIVED`.
- `createdBy`, `publishedBy`, `createdAt`, `publishedAt`.
- Restricción única `(agreementId, versionNumber)`.

La publicación debe ejecutarse en una transacción: verificar que el contenido no esté vacío, calcular el hash en servidor, fijar publicador/fecha y actualizar la versión publicada actual. Añadir una restricción SQL parcial que impida dos versiones publicadas simultáneas por acuerdo, si el flujo y el esquema final conservan ese estado en las versiones. La referencia `currentPublishedVersionId` es la fuente de verdad para resolver la versión vigente.

### `LegalAgreementAcceptance`

Registro histórico append-only de una aceptación.

- `id`, `userProfileId`, `agreementVersionId`, `acceptedAt`.
- `contentSha256`: copia del hash de la versión aceptada.
- `signerNameSnapshot`: solo si el flujo obtiene un nombre confirmado del usuario; no inferirlo del nombre actual del perfil.
- `source`: por ejemplo `ONBOARDING`.
- Índice por usuario y fecha; evitar una restricción única que impida aceptar una versión nueva.

No actualizar ni borrar una aceptación anterior cuando se publica un nuevo acuerdo. Corregir datos históricos debe requerir un procedimiento administrativo explícito y auditado.

## Flujo administrativo

1. Un administrador autorizado crea un borrador o clona una versión publicada.
2. Puede editar únicamente el borrador.
3. La vista previa debe mostrar el contenido con el mismo renderizado que verá el candidato.
4. Publicar crea una versión inmutable, registra el administrador y la fecha y actualiza la referencia vigente dentro de una transacción.
5. Si hay una versión publicada, la interfaz permite clonarla a un nuevo borrador; nunca la modifica directamente.
6. Las operaciones administrativas se validan en el servidor y se registran en el historial de auditoría existente, sin exponer datos personales en logs.

## Flujo de onboarding

1. El servidor devuelve la versión publicada actual, su ID, número y contenido.
2. La interfaz presenta exactamente ese contenido y requiere que el usuario llegue al final y acepte.
3. La acción de aceptación vuelve a consultar la versión publicada en el servidor. Si el ID presentado ya no es el vigente, devuelve `CONFLICT` y pide recargar; no registra aceptación de una versión obsoleta.
4. La aceptación guarda una fila nueva que apunta a la versión y su hash, además de actualizar los campos legacy que sean necesarios para compatibilidad.
5. `completeOnboarding` comprueba una aceptación válida para la versión actualmente publicada. Si se publica una versión nueva antes de completar el onboarding, el usuario debe aceptar la nueva versión.
6. Las cuentas Auth.js y Supabase deben utilizar la misma regla de aceptación. Los campos `Interpreter.notas` y `UserProfile.termsAcceptedAt` quedan como compatibilidad/lectura histórica, no como la fuente de verdad.

## Migración y compatibilidad

- Crear primero las tablas y relaciones, sin eliminar `termsAcceptedAt`, `signatureDate` ni la marca legacy.
- Importar el contenido contractual actual como la primera versión publicada, después de revisión legal y verificación del contenido exacto.
- Las aceptaciones existentes se deben migrar como evidencia histórica marcada como legacy. No afirmar que tienen un hash histórico verificable si ese hash no se conservó en el momento de la firma.
- Si el texto exacto presentado históricamente no se puede demostrar, la fila migrada debe señalar explícitamente esa limitación y conservar el valor original de la versión registrada (por ejemplo `2026-10-01`).
- Hacer backfill idempotente y contar filas antes/después. No ejecutar cambios destructivos ni modificar la base de producción durante la fase de diseño.
- Mantener la compatibilidad de los guards existentes hasta que todas las rutas de onboarding lean la nueva tabla.

## Pruebas de aceptación obligatorias

- Un administrador puede crear y editar borradores, pero no editar una versión publicada.
- Publicar genera un número/hash estables y la operación concurrente no crea dos versiones vigentes.
- Un usuario puede aceptar la versión actual y el registro conserva el ID, hash y fecha.
- Si la versión cambia entre cargar el acuerdo y aceptar, la acción devuelve conflicto y no crea una aceptación de la versión anterior.
- Completar onboarding exige aceptar la versión vigente y tener los datos bancarios requeridos.
- Publicar una versión nueva no modifica ni elimina aceptaciones previas.
- Los usuarios legacy y Supabase siguen usando el mismo control de acceso y no pueden completar onboarding omitiendo la aceptación.
- Las pruebas no usan datos bancarios reales y los logs no contienen contenido sensible ni PII innecesaria.

## Orden de implementación

1. Acordar el contrato de esquema y reglas de retención.
2. Añadir modelos Prisma y migración SQL revisable.
3. Añadir servicios de lectura/publicación/aceptación con validación de permisos y transacciones.
4. Añadir UI administrativa de borrador, vista previa, publicación e historial.
5. Cambiar el onboarding para cargar y aceptar la versión del servidor.
6. Añadir backfill controlado, pruebas unitarias y E2E.
7. Ejecutar Prisma validate/generate, chequeos TypeScript, ESLint, tests y build; verificar el resultado del CI antes de integrar.

## Riesgos que no deben introducirse

- Sobrescribir el contenido de una versión ya aceptada.
- Confiar en un `version` o hash enviado por el navegador sin volver a resolverlo en el servidor.
- Tratar la existencia de `[TERMS_ACCEPTED]` como prueba de aceptación de la versión actual.
- Declarar aceptado un contrato solo porque se guardaron los datos bancarios.
- Presentar una fila histórica migrada como prueba criptográfica si el contenido firmado no se conservó.
