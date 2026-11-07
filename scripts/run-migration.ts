import 'dotenv/config';

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { Client } from 'pg';
import { DirectDatabaseUrlError, normalizeDirectDatabaseUrl } from './normalize-direct-database-url';

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

  // The same direct-connection guard runs here as in deployment preflight:
  // standalone migration invocations must never bypass pooler restrictions.
  const connectionString = normalizeDirectDatabaseUrl(process.env.DIRECT_URL);
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
    console.error('La migración falló. No se intentó reparar ni borrar usuarios automáticamente.');
    const databaseError = error as {
      message?: unknown;
      code?: unknown;
      severity?: unknown;
      position?: unknown;
      routine?: unknown;
    } | null;
    if (databaseError && typeof databaseError === 'object') {
      // PostgreSQL messages are useful for diagnosis, but can contain connection
      // strings or values from failed constraints. Redact common secret/PII
      // patterns and never print DETAIL, parameters, or the original error.
      const safeMessage = typeof databaseError.message === 'string'
        ? databaseError.message
          .replace(/postgres(?:ql)?:\\/\\/[^\\s]+/giu, '[redacted database URL]')
          .replace(/\\b(password|passwd|token|secret|authorization)\\s*[:=]\\s*[^\\s,;]+/giu, '$1=[redacted]')
          .replace(/\\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}\\b/giu, '[redacted email]')
          .replace(/[\\r\\n\\t]+/gu, ' ')
          .slice(0, 240)
        : '';
      if (safeMessage) console.error(`Detalle PostgreSQL: ${safeMessage}`);
      if (typeof databaseError.severity === 'string') {
        console.error(`Severidad PostgreSQL: ${databaseError.severity.slice(0, 32)}`);
      }
      if (typeof databaseError.position === 'string' && /^\\d{1,6}$/u.test(databaseError.position)) {
        console.error(`Posición SQL: ${databaseError.position}`);
      }
      if (typeof databaseError.routine === 'string' && /^[a-zA-Z0-9_]{1,80}$/u.test(databaseError.routine)) {
        console.error(`Rutina PostgreSQL: ${databaseError.routine}`);
      }
    }
    throw error;
  } finally {
    if (connected) await client.end();
  }
}

main().catch((error: unknown) => {
  // PostgreSQL and network errors can include destination/credential details.
  // Print only a fixed message and, when available, a safe SQLSTATE code.
  if (error instanceof DirectDatabaseUrlError) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && /^[0-9A-Z]{5}$/u.test(code)) {
    console.error(`La migración falló (SQLSTATE ${code}).`);
  } else {
    console.error('La migración no se completó. Comprueba DIRECT_URL, el esquema y los logs seguros.');
  }
  process.exitCode = 1;
});
