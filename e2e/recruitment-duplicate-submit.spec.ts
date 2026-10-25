import { test, expect, type Page } from '@playwright/test';
import { Client } from 'pg';

const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const CONCURRENT_EMAIL = `e2e-dupesubmit-${RUN_ID}-concurrent@example.com`;
const RESUME_EMAIL = `e2e-dupesubmit-${RUN_ID}-resume@example.com`;

const SUCCESS_HEADING = 'Conoce más sobre Intérpretes RD';
const ERROR_TEXT = 'No pudimos procesar tu postulación';
const RESUME_INFO_TEXT = 'Ya existe una postulación con este correo. Para continuar con seguridad, inicia sesión con ese correo.';

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
      // Only the winning browser owns the new application cookie. The other
      // browser must receive resume guidance instead of access to that application.
      await expect.poll(async () => {
        const firstHasOutcome =
          (await first.getByRole('heading', { name: SUCCESS_HEADING }).count()) > 0 ||
          (await first.getByText(RESUME_INFO_TEXT, { exact: true }).count()) > 0;
        const secondHasOutcome =
          (await second.getByRole('heading', { name: SUCCESS_HEADING }).count()) > 0 ||
          (await second.getByText(RESUME_INFO_TEXT, { exact: true }).count()) > 0;
        return [firstHasOutcome, secondHasOutcome];
      }).toEqual([true, true]);
      await expect(first.getByText(ERROR_TEXT)).toHaveCount(0);
      await expect(second.getByText(ERROR_TEXT)).toHaveCount(0);
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
  test('double submit with the same email: first creates, second resumes (no duplicate/error)', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(String(err)));

    await fillApplication(page, RESUME_EMAIL);
    await expect(
      page.getByRole('heading', { name: SUCCESS_HEADING }),
    ).toBeVisible();
    await expect(page.getByText(ERROR_TEXT)).toHaveCount(0);

    await fillApplication(page, RESUME_EMAIL);
    await expect(
      page.getByRole('heading', { name: SUCCESS_HEADING }),
    ).toBeVisible();
    await expect(page.getByText(ERROR_TEXT)).toHaveCount(0);

    expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toEqual([]);
  });
});
