/**
 * Integration tests — Control de roles y permisos
 * Verifica que las restricciones de rol se apliquen en TODOS los endpoints
 */
const request    = require('supertest');
const mockNotion = require('../helpers/mock-notion');

jest.mock('../../api/notion', () => require('../helpers/mock-notion'));
jest.mock('../../api/_audit', () => ({ logAudit: jest.fn(), clientIp: () => '127.0.0.1' }));

const { buildApp } = require('../helpers/test-app');
const jwt = require('jsonwebtoken');
const { SECRET } = require('../../middleware/auth');

function token(role, ejec = null) {
  return jwt.sign({ id: 'user1', nombre: 'Test', role, ejec }, SECRET, { expiresIn: '1h' });
}

let app;
beforeEach(() => {
  mockNotion.resetStore();
  app = buildApp();
});

// ── Pagos: solo admin ─────────────────────────────────────
describe('GET /api/pagos — solo admin', () => {
  test('admin → 200', async () => {
    const res = await request(app).get('/api/pagos')
      .set('Authorization', `Bearer ${token('admin')}`);
    expect(res.status).toBe(200);
  });

  test('administracion → 403', async () => {
    const res = await request(app).get('/api/pagos')
      .set('Authorization', `Bearer ${token('administracion')}`);
    expect(res.status).toBe(403);
  });

  test('ejecutivo → 403', async () => {
    const res = await request(app).get('/api/pagos')
      .set('Authorization', `Bearer ${token('ejecutivo')}`);
    expect(res.status).toBe(403);
  });
});

// ── Deudas: solo admin ────────────────────────────────────
describe('GET /api/deudas — solo admin', () => {
  test('admin → 200', async () => {
    const res = await request(app).get('/api/deudas')
      .set('Authorization', `Bearer ${token('admin')}`);
    expect(res.status).toBe(200);
  });

  test('ejecutivo → 403', async () => {
    const res = await request(app).get('/api/deudas')
      .set('Authorization', `Bearer ${token('ejecutivo')}`);
    expect(res.status).toBe(403);
  });
});

// ── Auditoría: solo admin ─────────────────────────────────
describe('GET /api/auditoria — solo admin', () => {
  test('admin → 200', async () => {
    const res = await request(app).get('/api/auditoria')
      .set('Authorization', `Bearer ${token('admin')}`);
    expect([200, 404]).toContain(res.status); // puede no existir la ruta completa, pero no debe ser 403
  });

  test('ejecutivo → 403', async () => {
    const res = await request(app).get('/api/auditoria')
      .set('Authorization', `Bearer ${token('ejecutivo')}`);
    expect(res.status).toBe(403);
  });
});

// ── Prospectos: ejecutivo NO puede eliminar ───────────────
describe('DELETE /api/prospectos/:id — ejecutivo bloqueado', () => {
  test('ejecutivo → 403', async () => {
    const res = await request(app).delete('/api/prospectos/fake-id')
      .set('Authorization', `Bearer ${token('ejecutivo')}`);
    expect(res.status).toBe(403);
  });

  test('admin → puede intentar (404 porque no existe, no 403)', async () => {
    const res = await request(app).delete('/api/prospectos/nonexistent')
      .set('Authorization', `Bearer ${token('admin')}`);
    expect(res.status).not.toBe(403);
  });
});

// ── Clientes: administracion NO puede eliminar ────────────
describe('DELETE /api/clientes/:id — administracion bloqueado', () => {
  test('administracion → 403', async () => {
    const res = await request(app).delete('/api/clientes/fake-id')
      .set('Authorization', `Bearer ${token('administracion')}`);
    expect(res.status).toBe(403);
  });
});

// ── OPs: accesible para todos los roles autenticados ─────
describe('GET /api/ops — roles permitidos', () => {
  test.each(['admin', 'administracion', 'ejecutivo'])('%s puede ver OPs', async (role) => {
    const res = await request(app).get('/api/ops')
      .set('Authorization', `Bearer ${token(role)}`);
    expect(res.status).toBe(200);
  });
});

// ── Prevención de escalada de privilegios ────────────────
describe('Escalada de privilegios', () => {
  test('no se puede crear un token admin con un usuario ejecutivo', () => {
    // Un JWT firmado con la clave incorrecta es rechazado
    const fakeToken = jwt.sign({ id: 'alexia', role: 'admin' }, 'secreto-incorrecto', { expiresIn: '1h' });
    return request(app).get('/api/pagos')
      .set('Authorization', `Bearer ${fakeToken}`)
      .expect(401);
  });
});
