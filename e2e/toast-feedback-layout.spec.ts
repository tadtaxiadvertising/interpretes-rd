import { expect, test } from '@playwright/test';

// CSS-only read-only fixture on a public route. No user data or server actions.
for (const theme of ['light', 'dark'] as const) {
  test('toast positioning and dismiss control in ' + theme, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/login');
    await page.getByRole('button', { name: theme === 'light' ? 'Modo claro' : 'Modo oscuro' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.evaluate(() => {
      const fixture = document.createElement('div');
      fixture.id = 'toast-layout-fixture';
      fixture.innerHTML = `
        <div data-testid="toast-layout" class="platform-toaster" style="position:fixed;bottom:var(--platform-toast-bottom);left:12px;right:12px;z-index:10001;pointer-events:none;display:flex;justify-content:flex-end">
          <div style="display:flex;align-items:center;max-width:100%;background:var(--theme-panel);color:var(--foreground);pointer-events:auto;border:1px solid var(--theme-control-border);padding:8px;border-radius:12px">
            <div data-testid="toast-message" class="platform-toast-message min-w-0 flex-1 text-sm">${'Mensaje de prueba '.repeat(70)}</div>
            <button type="button" class="platform-toast-close">Cerrar</button>
          </div>
        </div>`;
      document.body.appendChild(fixture);
    });
    const layout = page.getByTestId('toast-layout');
    try {
      await expect(layout).toHaveCSS('bottom', '12px');
      const close = layout.getByRole('button', { name: 'Cerrar' });
      expect((await close.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect((await close.boundingBox())!.width).toBeGreaterThanOrEqual(44);
      await expect.poll(() => page.getByTestId('toast-message').evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
      await page.evaluate(() => {
        const nav = document.createElement('nav');
        nav.setAttribute('data-mobile-bottom-nav', '');
        nav.id = 'toast-nav-fixture';
        nav.style.cssText = 'position:fixed;inset:auto 0 0;height:64px';
        document.body.appendChild(nav);
      });
      await expect(layout).toHaveCSS('bottom', '80px');
      const toastBounds = await layout.boundingBox();
      const navBounds = await page.locator('#toast-nav-fixture').boundingBox();
      expect(toastBounds!.y + toastBounds!.height).toBeLessThan(navBounds!.y);
      expect(toastBounds!.x + toastBounds!.width).toBeLessThanOrEqual(320);
      await close.focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      await expect(close).toBeFocused();
      await expect(close).toHaveCSS('outline-style', 'solid');
      await page.setViewportSize({ width: 1440, height: 900 });
      await expect(layout).toHaveCSS('bottom', '12px');
    } finally {
      await page.evaluate(() => {
        document.getElementById('toast-layout-fixture')?.remove();
        document.getElementById('toast-nav-fixture')?.remove();
      });
    }
  });
}
