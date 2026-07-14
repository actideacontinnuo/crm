/**
 * E2E Tests — Validación de UI
 * Cubre: avatar menu, campanita, navegación, responsive, accesibilidad básica
 */
const { test, expect } = require('@playwright/test');
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// Helper: inyectar sesión válida via localStorage
async function injectAdminSession(page) {
  await page.goto(BASE_URL);
  await page.evaluate(() => {
    // Token JWT fijo con payload admin — válido para pruebas visuales
    // (el servidor no lo valida en este contexto estático)
    const fakeToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
      btoa(JSON.stringify({ id:'natalia', nombre:'Natalia Gama', role:'admin', ejec:'Natalia Gama', exp: 9999999999 }))
        .replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_') +
      '.fake-signature';
    localStorage.setItem('crm_token', fakeToken);
    localStorage.setItem('crm_user', JSON.stringify({
      id: 'natalia', nombre: 'Natalia Gama', role: 'admin', ejec: 'Natalia Gama', mustChangePassword: false,
    }));
  });
}

test.describe('Login UI', () => {
  test('pantalla de login tiene todos los elementos necesarios', async ({ page }) => {
    await page.goto(BASE_URL);
    await expect(page.locator('#login-user')).toBeVisible();
    await expect(page.locator('#login-pass')).toBeVisible();
    await expect(page.locator('button:has-text("Entrar")')).toBeVisible();
    await expect(page.locator('text=¿Olvidaste tu contraseña?')).toBeVisible();
  });

  test('el campo contraseña es de tipo password (no muestra el texto)', async ({ page }) => {
    await page.goto(BASE_URL);
    await expect(page.locator('#login-pass')).toHaveAttribute('type', 'password');
  });
});

test.describe('Topbar', () => {
  test.beforeEach(async ({ page }) => {
    await injectAdminSession(page);
    // Interceptar APIs para que no fallen
    await page.route('**/api/**', route => route.fulfill({
      status: 200, contentType: 'application/json', body: '[]',
    }));
    await page.reload();
  });

  test('campanita de notificaciones es visible', async ({ page }) => {
    await expect(page.locator('#notif-bell')).toBeVisible({ timeout: 8000 });
  });

  test('clic en campanita abre el panel de notificaciones', async ({ page }) => {
    await page.locator('#notif-bell').click();
    await expect(page.locator('#notif-panel')).toBeVisible();
  });

  test('segundo clic en campanita cierra el panel', async ({ page }) => {
    await page.locator('#notif-bell').click();
    await expect(page.locator('#notif-panel')).toBeVisible();
    await page.locator('#notif-bell').click();
    await expect(page.locator('#notif-panel')).not.toBeVisible();
  });

  test('avatar es visible y clickeable', async ({ page }) => {
    await expect(page.locator('#topbar-avatar')).toBeVisible({ timeout: 8000 });
  });

  test('clic en avatar abre el menú desplegable', async ({ page }) => {
    await page.locator('#topbar-avatar').click();
    await expect(page.locator('#avatar-menu')).toBeVisible();
  });

  test('menú avatar muestra opciones admin para rol admin', async ({ page }) => {
    await page.locator('#topbar-avatar').click();
    await expect(page.locator('#avatar-menu-admin')).toBeVisible();
    const menu = page.locator('#avatar-menu');
    await expect(menu.locator('text=Objetivos del Mes')).toBeVisible();
    await expect(menu.locator('text=Usuarios y Accesos')).toBeVisible();
    await expect(menu.locator('text=Auditoría')).toBeVisible();
    await expect(menu.locator('text=Respaldo de Datos')).toBeVisible();
  });

  test('menú avatar se cierra al hacer clic fuera', async ({ page }) => {
    await page.locator('#topbar-avatar').click();
    await expect(page.locator('#avatar-menu')).toBeVisible();
    await page.mouse.click(640, 500); // fuera del menú, sobre el área principal
    await expect(page.locator('#avatar-menu')).not.toBeVisible({ timeout: 2000 });
  });
});

test.describe('Menú lateral', () => {
  test.beforeEach(async ({ page }) => {
    await injectAdminSession(page);
    await page.route('**/api/**', route => route.fulfill({
      status: 200, contentType: 'application/json', body: '[]',
    }));
    await page.reload();
  });

  const navItems = [
    'Dashboard', 'Prospectos', 'Clientes', 'OPs', 'Cotizaciones',
    'Pagos', 'Proveedores', 'Casos', 'Comercial / Reportes',
  ];

  for (const item of navItems) {
    test(`enlace "${item}" existe en el sidebar`, async ({ page }) => {
      await expect(page.locator(`.nav-item:has-text("${item}")`).first()).toBeVisible({ timeout: 8000 });
    });
  }
});

test.describe('Modales', () => {
  test.beforeEach(async ({ page }) => {
    await injectAdminSession(page);
    await page.route('**/api/**', route => route.fulfill({
      status: 200, contentType: 'application/json', body: '[]',
    }));
    await page.reload();
  });

  test('modal de calificación tiene todos los checkboxes', async ({ page }) => {
    // Navegar a prospectos
    await page.locator('.nav-item:has-text("Prospectos")').click();
    await page.waitForTimeout(500);

    // Abrir modal directamente por JS
    await page.evaluate(() => abrirCalificacionProspecto());
    await expect(page.locator('#m-calificacion-prospecto')).toBeVisible();

    // Verificar los 5 checkboxes
    const checkboxIds = ['cal-contacto', 'cal-presupuesto', 'cal-evento', 'cal-decision', 'cal-docs'];
    for (const id of checkboxIds) {
      await expect(page.locator(`#${id}`)).toBeVisible();
    }
  });

  test('modal calificación muestra error si no están todos marcados', async ({ page }) => {
    await page.locator('.nav-item:has-text("Prospectos")').click();
    await page.evaluate(() => abrirCalificacionProspecto());
    await page.click('#m-calificacion-prospecto button:has-text("Confirmar")');
    await expect(page.locator('#cal-error')).toBeVisible();
  });

  test('modal calificación pasa cuando todos los checkboxes están marcados', async ({ page }) => {
    await page.locator('.nav-item:has-text("Prospectos")').click();
    await page.route('**/api/prospectos/**', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ id:'p1', empresa:'Test', contacto:'Juan', tel:'123', email:'j@t.com', ejec:'Natalia Gama' }),
    }));

    await page.evaluate(() => {
      window.STATE = window.STATE || {};
      STATE.selProsp = 'p1';
      abrirCalificacionProspecto();
    });

    const ids = ['cal-contacto', 'cal-presupuesto', 'cal-evento', 'cal-decision', 'cal-docs'];
    for (const id of ids) {
      await page.check(`#${id}`);
    }

    // No debe mostrar error
    await page.click('#m-calificacion-prospecto button:has-text("Confirmar")');
    await expect(page.locator('#cal-error')).not.toBeVisible();
  });

  test('modal nueva OP — toggle OP Interna oculta el selector de cliente', async ({ page }) => {
    await page.locator('.nav-item:has-text("OPs")').click();
    await page.waitForTimeout(500);

    await page.evaluate(() => openM('nueva-op'));
    await expect(page.locator('#m-nueva-op')).toBeVisible();

    const clienteWrap = page.locator('#op-cliente-wrap');
    await expect(clienteWrap).toBeVisible();

    await page.check('#op-interna');
    await expect(clienteWrap).not.toBeVisible();

    await page.uncheck('#op-interna');
    await expect(clienteWrap).toBeVisible();
  });
});

test.describe('Pantalla de Olvidé Contraseña', () => {
  test('muestra el formulario correcto', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('text=¿Olvidaste tu contraseña?');
    await expect(page.locator('#olvide-email')).toBeVisible();
    await expect(page.locator('#olvide-screen button:has-text("Enviar")')).toBeVisible();
    await expect(page.locator('#olvide-screen button:has-text("Volver")').first()).toBeVisible();
  });
});

test.describe('Seguridad Visual', () => {
  test('contraseñas no se muestran en texto plano', async ({ page }) => {
    await page.goto(BASE_URL);
    const inputs = await page.locator('input[type="password"]').all();
    expect(inputs.length).toBeGreaterThan(0);
  });

  test('el sidebar NO muestra secciones de admin como ítems visibles', async ({ page }) => {
    await page.goto(BASE_URL);
    // Las secciones admin deben vivir SOLO en el avatar menu, no en el sidebar
    await expect(page.locator('.sidebar:has-text("Auditoría")')).not.toBeVisible();
    await expect(page.locator('.sidebar:has-text("Respaldo")')).not.toBeVisible();
  });
});

test.describe('Regresión: token de sesión corrupto', () => {
  test('un token con caracteres inválidos se descarta y muestra el login (sin errores ByteString)', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.evaluate(() => {
      localStorage.setItem('crm_token', 'X\u2022corrupto\u2022con\u2022vi\u00f1etas');
      localStorage.setItem('crm_user', JSON.stringify({ id: 'natalia', role: 'admin' }));
    });
    const erroresJS = [];
    page.on('pageerror', e => erroresJS.push(e.message));
    await page.reload();
    await expect(page.locator('#login-screen')).toBeVisible({ timeout: 8000 });
    const token = await page.evaluate(() => localStorage.getItem('crm_token'));
    expect(token).toBeNull();
    expect(erroresJS.filter(m => /ByteString/i.test(m))).toHaveLength(0);
  });
});

test.describe('Regresión: dashboard para roles no-admin', () => {
  test('el dashboard carga aunque /api/pagos responda 403 (ejecutivo/administración)', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.evaluate(() => {
      const tok = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
        btoa(JSON.stringify({ id:'ximena', nombre:'Ximena', role:'ejecutivo', ejec:'Ximena', exp: 9999999999 }))
          .replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_') + '.fake';
      localStorage.setItem('crm_token', tok);
      localStorage.setItem('crm_user', JSON.stringify({ id:'ximena', nombre:'Ximena', role:'ejecutivo', ejec:'Ximena', mustChangePassword:false }));
    });
    // pagos y deudas → 403 como en producción para no-admin; el resto → []
    await page.route('**/api/pagos**', route => route.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"Acceso restringido a Dirección"}' }));
    await page.route('**/api/deudas**', route => route.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"Acceso restringido a Dirección"}' }));
    await page.route('**/api/**', route => {
      const u = route.request().url();
      if (u.includes('/api/pagos') || u.includes('/api/deudas')) return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: u.includes('/api/objetivos') ? '{}' : '[]' });
    });
    await page.reload();
    // El dashboard debe renderizar sus KPIs, no quedarse en blanco
    await expect(page.locator('#view-dashboard .kpi-label').first()).toBeVisible({ timeout: 10000 });
    const kpis = await page.locator('#view-dashboard .kpi-label').count();
    expect(kpis).toBeGreaterThanOrEqual(6);
    // Y la cobranza queda marcada como solo Dirección
    await expect(page.locator('#view-dashboard')).toContainText('solo Dirección');
  });
});
