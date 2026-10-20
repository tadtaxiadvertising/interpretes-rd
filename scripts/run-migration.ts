import 'dotenv/config';

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { Client } from 'pg';

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const migrationPath = args.find((arg) => arg !== '--apply');

  if (!migrationPath || !migrationPath.endsWith('.sql')) {
    throw new Error(
      'Indica un archivo .sql dentro de prisma/migrations o scripts/migrations. ' +
      'Por seguridad, primero valida sin --apply y ejecuta con --apply solo después de revisar el SQL.'
    );
  }

  const root = process.cwd();
  const absolutePath = resolve(root, migrationPath);
  const relativePath = relative(root, absolutePath);
  const allowedRoots = [
    `prisma${sep}migrations${sep}`,
    `scripts${sep}migrations${sep}`,
  ];

  if (relativePath.startsWith('..') || !allowedRoots.some((prefix) => relativePath.startsWith(prefix))) {
    throw new Error('Ruta de migración no permitida. Solo se admiten archivos dentro de las carpetas de migraciones.');
  }

  const sql = await readFile(absolutePath, 'utf8');
  if (!sql.trim()) throw new Error('El archivo de migración está vacío.');

  const checksum = createHash('sha256').update(sql).digest('hex');
  console.log(`Migración: ${relativePath}`);
  console.log(`SHA-256: ${checksum}`);

  if (!apply) {
    console.log('DRY RUN: no se conectó a la base de datos y no se ejecutó SQL.');
    console.log('Para ejecutar, revisa el archivo y vuelve a correr el comando agregando --apply.');
    return;
  }

  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('Falta DIRECT_URL o DATABASE_URL en el entorno de ejecución.');
  }

  const client = new Client({ connectionString });
  let connected = false;

  try {
    await client.connect();
    connected = true;
    // El archivo SQL es el límite de revisión. Los scripts de migración deben
    // administrar explícitamente su propia transacción cuando corresponda.
    await client.query(sql);
    console.log('Migración ejecutada correctamente.');
  } catch (error) {
    console.error('La migración falló. Revisa el error del motor SQL; no se intentó reparar ni borrar usuarios automáticamente.');
    throw error;
  } finally {
    if (connected) await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Error desconocido al ejecutar la migración.');
  process.exitCode = 1;
});
