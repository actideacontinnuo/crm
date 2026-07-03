/**
 * E2E Tests — Autenticación
 * Cubre: login, errores, olvidé contraseña, menú de avatar, cerrar sesión
 */
const { test, expect } = require('@playwright/test');
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// En E2E usamos el servidor real — mockeamos las llamadas Notion via page.route
test.beforeEach(async ({ page }) => {
  // Interceptar cualquier llamada a la API de Notion (no debería llegar al browser, pero por seguridad)
  await page.route('**/api.notion.com/**', route => route.abort());
});

test.describe('Login', () => {
  test('muestra pantalla de login al abrir la app sin sesión', async ({ page }) => {
    await page.goto(BASE_URL);
    await expect(page.locator('#login-screen')).toBeVisible();
  });

  test('input de login acepta usuario o correo (no es password)', async ({ page }) => {
    await page.goto(BASE_URL);
    await expect(page.locator('#login-user')).toBeVisible();
    await expect(page.locator('#login-user')).not.toHaveAttribute('type', 'password');
  });

  test('muestra error con credenciales incorrectas', async ({ page }) => {
    await page.goto(BASE_URL);

    // Interceptar la llamada de login para devolver error sin backend real
    await page.route('**/api/auth/login', route => route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Credenciales inválidas' }),
    }));

    await page.fill('#login-user', 'usuario@actideacontinnuo.com');
    await page.fill('#login-pass', 'contraseñaEquivocada');
    await page.click('button:has-text("Entrar")');

    await expect(page.locator('#login-error')).toBeVisible();
    await expect(page.locator('#login-error')).toContainText('Credenciales');
  });

  test('login exitoso navega al dashboard', async ({ page }) => {
    await page.goto(BASE_URL);

    // Mock general primero (el específico de login se registra después y tiene prioridad)
    await page.route('**/api/**', route => route.fulfill({
      status: 200, contentType: 'application/json', body: '[]',
    }));

    // Simular login exitoso
    await page.route('**/api/auth/login', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6Im5hdGFsaWEiLCJub21icmUiOiJOYXRhbGlhIEdhbWEiLCJyb2xlIjoiYWRtaW4iLCJpYXQiOjE3NTEzNjQwMDAsImV4cCI6OTk5OTk5OTk5OX0.fake',
        id: 'natalia', nombre: 'Natalia Gama', role: 'admin', ejec: 'Natalia Gama',
        mustChangePassword: false,
      }),
    }));

    await page.fill('#login-user', 'natalia@actideacontinnuo.com');
    await page.fill('#login-pass', 'cualquier');
    await page.click('button:has-text("Entrar")');

    // El token es fake (no validable) — solo verificamos que el código JS procesó la respuesta
    await expect(page.locator('#login-screen')).not.toBeVisible({ timeout: 5000 });
  });

  test('campo vacío muestra validación', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('button:has-text("Entrar")');
    await expect(page.locator('#login-error')).toBeVisible();
  });
});

test.describe('Pantalla Olvidé Contraseña', () => {
  test('enlace abre la pantalla de reset', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('text=¿Olvidaste tu contraseña?');
    await expect(page.locator('#olvide-screen')).toBeVisible();
    await expect(page.locator('#login-screen')).not.toBeVisible();
  });

  test('botón volver regresa al login', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('text=¿Olvidaste tu contraseña?');
    await page.click('#olvide-screen button:has-text("Volver")');
    await expect(page.locator('#login-screen')).toBeVisible();
  });

  test('enviar email muestra confirmación', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('text=¿Olvidaste tu contraseña?');

    await page.route('**/api/auth/olvide-password', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    }));

    await page.fill('#olvide-email', 'natalia@actideacontinnuo.com');
    await page.click('#olvide-screen button:has-text("Enviar")');

    await expect(page.locator('#olvide-ok')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Pantalla Reset Password (enlace por email)', () => {
  test('?token= en la URL muestra pantalla de nueva contraseña', async ({ page }) => {
    await page.goto(`${BASE_URL}/?token=token-de-prueba`);
    await expect(page.locator('#reset-pass-screen')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#login-screen')).not.toBeVisible();
  });

  test('la URL se limpia después de detectar el token', async ({ page }) => {
    await page.goto(`${BASE_URL}/?token=mi-token`);
    await page.waitForTimeout(500);
    expect(page.url()).not.toContain('token=');
  });

  test('contraseñas que no coinciden muestran error', async ({ page }) => {
    await page.goto(`${BASE_URL}/?token=test-token`);
    await page.fill('#rp-nueva', 'SolLuna1234!');
    await page.fill('#rp-confirma', 'Diferente9999!');
    await page.click('#reset-pass-screen button:has-text("Guardar")');
    await expect(page.locator('#rp-error')).toBeVisible();
    await expect(page.locator('#rp-error')).toContainText('no coinciden');
  });
});
