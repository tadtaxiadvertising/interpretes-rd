# Runbook: acuerdos legales y eliminación de intérpretes en EasyPanel

Este procedimiento aplica las migraciones de PR #132. No forma parte del despliegue automático porque el workflow actual de CI solo ejecuta `prisma db push` contra PostgreSQL efímero; los webhooks de EasyPanel no ejecutan las migraciones SQL del repositorio.

## Antes de tocar producción

1. Crear y verificar un backup restaurable de PostgreSQL.
2. Confirmar que se está conectado a la base de datos de intérpretes de producción, no a otra base.
3. Ejecutar las consultas de preflight de abajo y guardar los resultados.
4. No continuar si la tabla, columnas o restricción esperada no coinciden.

## Preflight de solo lectura

```sql
SELECT to_regclass('public.roleplay_sessions') AS roleplay_sessions,
       to_regclass('public.legal_agreement_versions') AS legal_agreement_versions,
       to_regclass('public.legal_agreement_acceptances') AS legal_agreement_acceptances;

SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.roleplay_sessions'::regclass
  AND contype = 'c';

SELECT id, agreement_key, version, status, created_by, published_by
FROM public.legal_agreement_versions
ORDER BY created_at DESC;
```

Confirmar que `roleplay_session_xor_subject` existe y exige exactamente un propietario. Si no existe, detenerse y revisar el esquema antes de aplicar la migración.

## Aplicar migraciones

Desde el repositorio de esta versión, ejecutar cada archivo SQL en la consola PostgreSQL de EasyPanel, en este orden:

1. `prisma/migrations/20261101_archive_unreviewed_legal_seed/migration.sql`
2. `prisma/migrations/20261101_legal_agreement_review_gate/migration.sql`
3. `prisma/migrations/20261101_legal_review_fingerprint/migration.sql`
4. `prisma/migrations/20261101_roleplay_orphaned_history_check/migration.sql`

No editar el SQL durante la ejecución. Si una migración falla, detenerse; no ejecutar las siguientes ni eliminar restricciones manualmente.

La primera migración archiva únicamente el contrato genérico insertado por la migración original con `created_by/published_by = system:migration`. No borra ni modifica aceptaciones históricas. Hasta que un acuerdo revisado por asesoría jurídica sea aprobado y publicado, el sistema no ofrecerá ese contrato genérico para nuevas aceptaciones.

## Verificación posterior

```sql
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.roleplay_sessions'::regclass
  AND contype = 'c';

SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'legal_agreement_versions'
  AND column_name IN ('legal_reviewed_by', 'legal_reviewed_at', 'legal_review_hash')
ORDER BY column_name;

SELECT status, COUNT(*)
FROM public.legal_agreement_versions
WHERE agreement_key = 'freelance-services'
GROUP BY status;

SELECT COUNT(*) AS acceptance_evidence_count
FROM public.legal_agreement_acceptances;
```

Resultado esperado:
- `roleplay_session_xor_subject` ya no existe.
- `roleplay_session_at_most_one_subject` existe y permite cero o un propietario, nunca dos.
- Las tres columnas de revisión jurídica existen.
- Las aceptaciones históricas siguen presentes.
- El seed genérico está `ARCHIVED` si existía con los metadatos esperados.

## Prueba funcional

Primero ejecutar la prueba E2E/ integración en staging con un intérprete sintético que tenga sesiones Roleplay activas y terminales. Al eliminarlo, verificar que:
- La cuenta se elimina.
- Las sesiones activas pasan a `CANCELLED` y quedan sin intérprete.
- Las sesiones terminales conservan su estado y quedan sin intérprete.
- Escenarios, respuestas, referencias de audio y QA histórico permanecen.

En el panel `/admin/legal-agreements`, crear el nuevo borrador aprobado por abogado dominicano, registrar revisión con un administrador y publicar con otro. Verificar que editar el borrador invalida la aprobación y que la nueva aceptación almacena versión, hash, UUID, ID de intérprete (cuando exista) y User-Agent.

No utilizar intérpretes reales para pruebas destructivas. No solicitar ni almacenar firmas reales hasta completar revisión jurídica y prueba en staging.
