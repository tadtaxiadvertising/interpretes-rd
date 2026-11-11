import { test, expect, type Page } from '@playwright/test';
import { Client } from 'pg';
import bcrypt from 'bcryptjs';

const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ADMIN_EMAIL = 'interpretersfree@gmail.com';
const INTERPRETER_EMAIL = `e2e-interpreter-${RUN_ID}@example.com`;
const CLIENT_NAME = `E2E Client ${RUN_ID}`;
const LEGACY_ACCOUNT_EMAIL = `e2e-legacy-${RUN_ID}@example.com`;
const OPERATIONAL_ACCOUNT_EMAIL = `e2e-operational-${RUN_ID}@example.com`;
const PASSWORD = 'E2E-Only-Password-2026!';

async function withDatabase<T>(callback: (client: Client) => Promise<T>): Promise<T> {
  const connectionString = process.env.E2E_DATABASE_URL;
  if (!connectionString) throw new Error('E2E_DATABASE_URL is required for role-based browser tests');
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}

async function loginAs(page: Page, email: string, role: 'admin' | 'interpreter') {
  await page.goto('/login');
  if (role === 'admin') {
    await page.getByRole('button', { name: 'Administrador' }).click();
  }
  await page.getByLabel('Email Address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign In' }).click();
}

test.describe('Browser authentication and role isolation', () => {
  test.beforeAll(async () => {
    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    await withDatabase(async (client) => {
      // The E2E database is isolated. Remove only our deterministic protected
      // admin fixture and unique interpreter fixture before seeding.
      await client.query('DELETE FROM public.user_profiles WHERE email = $1', [ADMIN_EMAIL]);
      await client.query('DELETE FROM public.rbac_users WHERE email = $1', [ADMIN_EMAIL]);
      await client.query('DELETE FROM public.user_profiles WHERE email = $1', [INTERPRETER_EMAIL]);
      await client.query('DELETE FROM public.rbac_users WHERE email = $1', [INTERPRETER_EMAIL]);
      await client.query('DELETE FROM public.interpreters WHERE email_corporativo = $1', [INTERPRETER_EMAIL]);

      await client.query(
        `INSERT INTO public.rbac_users (id, email, password, name, role, "updatedAt")
         VALUES ($1, $2, $3, $4, 'ADMIN', NOW())`,
        [`e2e-admin-${RUN_ID}`, ADMIN_EMAIL, passwordHash, 'E2E Administrator'],
      );
      await client.query(
        `INSERT INTO public.user_profiles (id, email, display_name, role)
         VALUES (gen_random_uuid(), $1, $2, 'admin')`,
        [ADMIN_EMAIL, 'E2E Administrator'],
      );

      const interpreter = await client.query(
        `INSERT INTO public.interpreters (external_id, name, email_corporativo, tariff_per_minute)
         VALUES ($1, $2, $3, 0.50)
         RETURNING id`,
        [`E2E-${RUN_ID}`, 'E2E Interpreter', INTERPRETER_EMAIL],
      );
      const interpreterId = interpreter.rows[0]?.id;
      if (!interpreterId) throw new Error('Could not seed E2E interpreter');

      await client.query(
        `INSERT INTO public.rbac_users (id, email, password, name, role, "updatedAt")
         VALUES ($1, $2, $3, $4, 'INTERPRETER', NOW())`,
        [`e2e-interpreter-${RUN_ID}`, INTERPRETER_EMAIL, passwordHash, 'E2E Interpreter'],
      );
      await client.query(
        `INSERT INTO public.user_profiles (id, email, display_name, role, interpreter_id)
         VALUES (gen_random_uuid(), $1, $2, 'interpreter', $3)`,
        [INTERPRETER_EMAIL, 'E2E Interpreter', interpreterId],
      );
    });
  });

  test.afterAll(async () => {
    await withDatabase(async (client) => {
      await client.query('DELETE FROM public.user_profiles WHERE email IN ($1, $2)', [ADMIN_EMAIL, INTERPRETER_EMAIL]);
      await client.query('DELETE FROM public.rbac_users WHERE email IN ($1, $2)', [ADMIN_EMAIL, INTERPRETER_EMAIL]);
      await client.query(
        'DELETE FROM public.account_platforms WHERE account_id IN (SELECT id FROM public.accounts WHERE email IN ($1, $2))',
        [LEGACY_ACCOUNT_EMAIL, OPERATIONAL_ACCOUNT_EMAIL],
      );
      await client.query('DELETE FROM public.accounts WHERE email IN ($1, $2)', [LEGACY_ACCOUNT_EMAIL, OPERATIONAL_ACCOUNT_EMAIL]);
      await client.query('DELETE FROM public.clients WHERE name = $1', [CLIENT_NAME]);
      await client.query('DELETE FROM public.interpreters WHERE email_corporativo = $1', [INTERPRETER_EMAIL]);
    });
  });

  test('anonymous visitors cannot enter admin or interpreter dashboards', async ({ page }) => {
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/login(?:\?|$)/);

    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login(?:\?|$)/);
  });

  test('administrator can sign in and is kept out of the interpreter dashboard', async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, 'admin');

    await expect(page).toHaveURL(/\/admin(?:\/)?(?:\?.*)?$/);
    await expect(page.getByRole('heading', { name: 'Telemetría Central' })).toBeVisible();

    // Exercise the real administrator workflow: create a client, assign a
    // legacy unowned account, then create a new operational account.
    await page.goto('/admin/clients');
    await page.getByLabel('Nombre del cliente').fill(CLIENT_NAME);
    await page.getByLabel('Razón social').fill(`E2E Legal ${RUN_ID}`);
    await page.getByLabel('Persona de contacto').fill('E2E Operations');
    await page.getByLabel('Correo de contacto').fill(`e2e-contact-${RUN_ID}@example.com`);
    await page.getByLabel('Teléfono').fill('+1 555 0100');
    await page.getByLabel('Notas').fill('Isolated browser workflow test');
    await page.getByRole('button', { name: 'Registrar cliente' }).click();
    await expect(page.getByText('Cliente registrado correctamente.')).toBeVisible();

    await withDatabase(async (client) => {
      await client.query(
        `INSERT INTO public.accounts (name, holder_name, email, description)
         VALUES ('E2E Legacy Account', 'E2E Legacy Holder', $1, 'Legacy unowned account')`,
        [LEGACY_ACCOUNT_EMAIL],
      );
    });
    await page.reload();
    await page.getByLabel('Cuenta sin cliente').selectOption({ label: 'E2E Legacy Account' });
    await page.getByLabel('Cliente').selectOption({ label: CLIENT_NAME });
    await page.getByRole('button', { name: 'Asignar cuenta al cliente' }).click();
    await expect(page.getByText('Cuenta asignada correctamente.')).toBeVisible();

    await page.goto('/admin/accounts');
    await page.getByLabel('Cliente propietario').selectOption({ label: CLIENT_NAME });
    await page.getByLabel('Identificador de cuenta').fill('E2E Operational Account');
    await page.getByLabel('Nombre del titular').fill('E2E Account Holder');
    await page.getByLabel('Correo de acceso').fill(OPERATIONAL_ACCOUNT_EMAIL);
    await page.getByLabel('Página donde se trabaja (HTTPS)').fill('https://portal.example.com/login');
    await page.getByLabel('Referencia de contraseña en gestor seguro').fill(`vault://e2e/${RUN_ID}/account`);
    await page.getByLabel('Descripción (opcional)').fill('Created by isolated Playwright test');
    await page.getByRole('button', { name: 'Crear cuenta' }).click();
    await expect(page.getByText('Cuenta registrada correctamente.')).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'E2E Operational Account' })).toContainText('E2E Account Holder');
    await expect(page.getByRole('row').filter({ hasText: 'E2E Operational Account' })).toContainText(CLIENT_NAME);

    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/admin(?:\/)?(?:\?.*)?$/);
  });

  test('interpreter can sign in and cannot enter the admin dashboard', async ({ page }) => {
    await loginAs(page, INTERPRETER_EMAIL, 'interpreter');

    await expect(page).toHaveURL(/\/dashboard(?:\/)?(?:\?.*)?$/);
    await expect(page.getByRole('heading', { name: 'Hola, E2E Interpreter' })).toBeVisible();

    await page.goto('/admin');
    await expect(page).toHaveURL(/\/dashboard(?:\/)?(?:\?.*)?$/);
    await expect(page.getByRole('heading', { name: 'Hola, E2E Interpreter' })).toBeVisible();
  });
});
