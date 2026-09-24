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
    },
  } : undefined,
});
