import { test, expect, type Page } from '@playwright/test';
import { Client } from 'pg';

const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const CONCURRENT_EMAIL = `e2e-dupesubmit-${RUN_ID}-concurrent@example.com`;
const RESUME_EMAIL = `e2e-dupesubmit-${RUN_ID}-resume@example.com`;

const SUCCESS_HEADING = 'Conoce más sobre Intérpretes RD';
const ERROR_TEXT = 'No pudimos procesar tu postulación';

async function fillApplication(page: Page, email: string): Promise<void> {
  await page.goto('/postular');

  await page.getByPlaceholder('Nombre completo').fill('E2E Duplicate Submit');
  await page.getByPlaceholder('Correo electrónico').fill(email);
  await page.getByPlaceholder('Teléfono (Ej: +123456789)').fill('+18095550000');
  await page.getByPlaceholder('País de residencia').fill('DO');
  await page.getByLabel('Nivel de inglés').selectOption('B2');
  await page.getByLabel('Velocidad de descarga (Mbps)').fill('25');
  await page
    .getByPlaceholder('Link de tu certificado EFSET')
    .fill(`https://www.efset.org/cert/${RUN_ID}`);

  await page.getByRole('button', { name: 'Enviar Postulación' }).click();
}

async function assertApplicationStep(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: SUCCESS_HEADING })).toBeVisible();
  await expect(page.getByText(ERROR_TEXT)).toHaveCount(0);
}

test.describe('Public recruitment · candidate submission', () => {
  test('two browsers submitting the same email concurrently do not create duplicate candidates', async ({ browser }) => {
    const first = await browser.newPage();
    const second = await browser.newPage();
    const pageErrors: string[] = [];
    first.on('pageerror', (err) => pageErrors.push(String(err)));
    second.on('pageerror', (err) => pageErrors.push(String(err)));

    try {
      await Promise.all([first.goto('/postular'), second.goto('/postular')]);
      const fill = async (page: Page) => {
        await page.getByPlaceholder('Nombre completo').fill('E2E Concurrent Submit');
        await page.getByPlaceholder('Correo electrónico').fill(CONCURRENT_EMAIL);
        await page.getByPlaceholder('Teléfono (Ej: +123456789)').fill('+18095550000');
        await page.getByPlaceholder('País de residencia').fill('DO');
        await page.getByLabel('Nivel de inglés').selectOption('B2');
        await page.getByLabel('Velocidad de descarga (Mbps)').fill('25');
        await page.getByPlaceholder('Link de tu certificado EFSET').fill(`https://www.efset.org/cert/${RUN_ID}`);
      };
      await Promise.all([fill(first), fill(second)]);
      await Promise.all([
        first.getByRole('button', { name: 'Enviar Postulación' }).click(),
        second.getByRole('button', { name: 'Enviar Postulación' }).click(),
      ]);
      await Promise.all([assertApplicationStep(first), assertApplicationStep(second)]);
      expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toEqual([]);

      const databaseUrl = process.env.E2E_DATABASE_URL;
      if (!databaseUrl) throw new Error('E2E_DATABASE_URL is required for the duplicate-candidate assertion');
      const client = new Client({ connectionString: databaseUrl });
      await client.connect();
      try {
        const result = await client.query(
          'SELECT COUNT(*)::int AS count FROM recruitment_candidates WHERE email = $1',
          [CONCURRENT_EMAIL],
        );
        expect(result.rows[0]?.count).toBe(1);
      } finally {
        await client.end();
      }
    } finally {
      await Promise.all([first.close(), second.close()]);
    }
  });

  test('resubmitting the same email resumes the existing application without an error', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(String(err)));

    await fillApplication(page, RESUME_EMAIL);
    await assertApplicationStep(page);

    // Same browser keeps the signed ownership cookie, so a second submission
    // exercises the owned resume path rather than creating a second candidate.
    await fillApplication(page, RESUME_EMAIL);
    await assertApplicationStep(page);

    const databaseUrl = process.env.E2E_DATABASE_URL;
    if (!databaseUrl) throw new Error('E2E_DATABASE_URL is required for the resume assertion');
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const result = await client.query(
        'SELECT COUNT(*)::int AS count FROM recruitment_candidates WHERE email = $1',
        [RESUME_EMAIL],
      );
      expect(result.rows[0]?.count).toBe(1);
    } finally {
      await client.end();
    }

    expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toEqual([]);
  });
});
