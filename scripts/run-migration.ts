import 'dotenv/config';

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { Client } from 'pg';

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const transactional = args.includes('--transaction');
  const migrationPath = args.find((arg) => arg !== '--apply' && arg !== '--transaction');

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

  // Applying schema changes through a pooled DATABASE_URL is unsafe: migrations
  // require a direct PostgreSQL connection. Never silently fall back to it.
  // Match deployment preflight: tolerate only surrounding copy/paste whitespace.
  const connectionString = process.env.DIRECT_URL?.trim();
  if (!connectionString?.trim()) {
    throw new Error('DIRECT_URL es obligatorio para aplicar migraciones. DATABASE_URL no se acepta como alternativa.');
  }
  if (/\s|[\u0000-\u001f\u007f]/u.test(connectionString)) {
    throw new Error('DIRECT_URL no puede contener espacios internos ni caracteres de control.');
  }
  if (!transactional) {
    throw new Error('Las migraciones aplicadas deben usar --transaction para garantizar rollback ante errores.');
  }

  const client = new Client({ connectionString });
  let connected = false;
  let transactionStarted = false;

  try {
    await client.connect();
    connected = true;
    await client.query('BEGIN');
    transactionStarted = true;
    // Serialize migration runners targeting the same database, even when
    // invoked outside the GitHub Actions concurrency group.
    await client.query('SELECT pg_advisory_xact_lock(194, 20261105)');
    await client.query(sql);
    await client.query('COMMIT');
    transactionStarted = false;
    console.log('Migración ejecutada correctamente.');
  } catch (error) {
    if (transactionStarted) {
      await client.query('ROLLBACK').catch(() => undefined);
      transactionStarted = false;
    }
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
