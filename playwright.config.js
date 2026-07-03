const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  timeout: 30000,

  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'],
  ],

  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    locale: 'es-MX',
    timezoneId: 'America/Mexico_City',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  webServer: process.env.CI ? {
    command: 'node server.js',
    port: 3000,
    reuseExistingServer: false,
    timeout: 15000,
    env: {
      NODE_ENV: 'test',
      PORT: '3000',
      JWT_SECRET: 'test-secret-qa-2026',
      NOTION_TOKEN: 'test-token',
      NOTION_DB_PROSPECTOS: 'test-db-prospectos',
      NOTION_DB_CLIENTES: 'test-db-clientes',
      NOTION_DB_OPS: 'test-db-ops',
      NOTION_DB_COTIZACIONES: 'test-db-cotizaciones',
      NOTION_DB_PAGOS: 'test-db-pagos',
      NOTION_DB_PROVEEDORES: 'test-db-proveedores',
      NOTION_DB_DEUDAS: 'test-db-deudas',
      NOTION_DB_CASOS: 'test-db-casos',
      NOTION_DB_TICKETS: 'test-db-tickets',
      NOTION_DB_USUARIOS: 'test-db-usuarios',
      NOTION_DB_OBJETIVOS: 'test-db-objetivos',
      NOTION_DB_AUDITORIA: 'test-db-auditoria',
    },
  } : undefined,
});
