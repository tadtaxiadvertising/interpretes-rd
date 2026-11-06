'use strict';

// This legacy one-off runner previously embedded database credentials and
// bypassed the shared DIRECT_URL validation, transaction guard and dry-run
// contract. Keep the entry point fail-closed so old invocations cannot mutate
// a database outside scripts/run-migration.ts.
console.error('Este ejecutor heredado está deshabilitado por seguridad.');
console.error('Dry-run: npm run migrate -- <ruta/migration.sql>');
console.error('Aplicación: npm run migrate -- <ruta/migration.sql> --apply --transaction');
console.error('La aplicación requiere DIRECT_URL válido; DATABASE_URL no es una alternativa.');
process.exitCode = 1;
