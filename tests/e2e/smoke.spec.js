/**
 * Smoke Tests — Verificación rápida antes de cualquier deploy
 * Si alguno de estos falla, el deploy debe bloquearse.
 */
const { test, expect } = require('@playwright/test');
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

test.describe('Smoke Tests', () => {
  test('la app carga y muestra la pantalla de login', async ({ page }) => {
    await page.goto(BASE_URL);
    await expect(page.locator('#login-screen')).toBeVisible();
    await expect(page.locator('#login-user')).toBeVisible();
    await expect(page.locator('#login-pass')).toBeVisible();
  });

  test('health endpoint responde ok', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/health`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test('rutas API protegidas devuelven 401 sin token', async ({ request }) => {
    const routes = ['/api/prospectos', '/api/clientes', '/api/ops', '/api/pagos'];
    for (const route of routes) {
      const res = await request.get(`${BASE_URL}${route}`);
      expect(res.status()).toBe(401);
    }
  });

  test('el login field acepta usuario o correo', async ({ page }) => {
    await page.goto(BASE_URL);
    const input = page.locator('#login-user');
    await expect(input).toBeVisible();
    await expect(input).not.toHaveAttribute('type', 'password');
  });

  test('existe el enlace de olvide contraseña', async ({ page }) => {
    await page.goto(BASE_URL);
    const link = page.locator('text=¿Olvidaste tu contraseña?');
    await expect(link).toBeVisible();
  });

  test('SPA redirige rutas desconocidas a index.html', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/ruta-que-no-existe`);
    expect(res.ok()).toBeTruthy();
    const text = await res.text();
    expect(text).toContain('<!DOCTYPE html>');
  });

  test('no hay errores JS en consola al cargar la app', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.goto(BASE_URL);
    await page.waitForTimeout(2000);
    expect(errors.filter(e => !e.includes('favicon'))).toHaveLength(0);
  });

  test('el token de Notion NO está expuesto en el HTML', async ({ request }) => {
    const res  = await request.get(BASE_URL);
    const html = await res.text();
    expect(html).not.toContain('ntn_');
    expect(html).not.toContain('NOTION_TOKEN');
    expect(html).not.toContain('secret_');
  });

  test('JWT_SECRET NO está expuesto en el HTML', async ({ request }) => {
    const res  = await request.get(BASE_URL);
    const html = await res.text();
    expect(html).not.toContain('JWT_SECRET');
    expect(html).not.toContain('test-secret-qa');
  });
});
