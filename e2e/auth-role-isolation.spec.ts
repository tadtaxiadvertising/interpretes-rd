import { test, expect, type Page } from '@playwright/test';
import { Client } from 'pg';
import bcrypt from 'bcryptjs';

const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ADMIN_EMAIL = 'interpretersfree@gmail.com';
const INTERPRETER_EMAIL = `e2e-interpreter-${RUN_ID}@example.com`;
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
