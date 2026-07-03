/**
 * Helpers compartidos para tests E2E
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

/**
 * Inyecta un usuario y token de prueba directamente en localStorage
 * (evita depender del flujo de login para tests que no prueban auth)
 */
async function injectSession(page, { role = 'admin', nombre = 'Natalia Gama', id = 'natalia', ejec = 'Natalia Gama' } = {}) {
  const jwt = require('jsonwebtoken');
  const token = jwt.sign({ id, nombre, role, ejec }, 'test-secret-qa-2026', { expiresIn: '12h' });
  await page.goto(BASE_URL);
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('crm_token', token);
    localStorage.setItem('crm_user', JSON.stringify(user));
  }, { token, user: { id, nombre, role, ejec, mustChangePassword: false } });
}

/**
 * Espera a que el spinner desaparezca
 */
async function waitForNoSpinner(page, timeout = 10000) {
  await page.waitForFunction(() => {
    const spinner = document.getElementById('spinner');
    return !spinner || spinner.style.display === 'none' || spinner.style.opacity === '0';
  }, { timeout });
}

module.exports = { injectSession, waitForNoSpinner, BASE_URL };
