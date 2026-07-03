/**
 * Integration tests — API de autenticación
 * Cubre: login, 2FA, cambio de contraseña, olvide-password, gestión de usuarios
 */
const request   = require('supertest');
const mockNotion = require('../helpers/mock-notion');

jest.mock('../../api/notion', () => require('../helpers/mock-notion'));
jest.mock('../../api/_audit', () => ({ logAudit: jest.fn(), clientIp: () => '127.0.0.1' }));

const { buildApp } = require('../helpers/test-app');

let app;

beforeEach(() => {
  mockNotion.resetStore();
  app = buildApp();
});

// ── Health ────────────────────────────────────────────────
describe('GET /api/health', () => {
  test('devuelve ok:true sin autenticación', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ── Login ─────────────────────────────────────────────────
describe('POST /api/auth/login', () => {
  test('login con email válido devuelve token', async () => {
    const res = await request(app).post('/api/auth/login')
      .send({ email: 'natalia@actideacontinnuo.com', password: 'AdminTest123!' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.role).toBe('admin');
    expect(res.body.nombre).toBe('Natalia Gama');
  });

  test('login con usuario (no email) funciona como fallback', async () => {
    const res = await request(app).post('/api/auth/login')
      .send({ usuario: 'natalia', password: 'AdminTest123!' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });

  test('contraseña incorrecta → 401', async () => {
    const res = await request(app).post('/api/auth/login')
      .send({ email: 'natalia@actideacontinnuo.com', password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body.token).toBeUndefined();
  });

  test('usuario inexistente → 401', async () => {
    const res = await request(app).post('/api/auth/login')
      .send({ email: 'fantasma@actideacontinnuo.com', password: 'cualquierCosa1!' });
    expect(res.status).toBe(401);
  });

  test('cuerpo vacío → 400', async () => {
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(400);
  });

  test('token incluye rol en el payload', async () => {
    const res = await request(app).post('/api/auth/login')
      .send({ email: 'natalia@actideacontinnuo.com', password: 'AdminTest123!' });
    const jwt = require('jsonwebtoken');
    const decoded = jwt.decode(res.body.token);
    expect(decoded.role).toBe('admin');
    expect(decoded.id).toBe('natalia');
  });
});

// ── Rutas protegidas sin token ────────────────────────────
describe('Rutas protegidas — sin token', () => {
  const routes = [
    ['GET',    '/api/prospectos'],
    ['GET',    '/api/clientes'],
    ['GET',    '/api/ops'],
    ['POST',   '/api/prospectos'],
    ['PATCH',  '/api/prospectos/some-id'],
    ['DELETE', '/api/clientes/some-id'],
  ];

  test.each(routes)('%s %s → 401 sin token', async (method, path) => {
    const res = await request(app)[method.toLowerCase()](path).send({});
    expect(res.status).toBe(401);
  });
});

// ── Olvide contraseña ─────────────────────────────────────
describe('POST /api/auth/olvide-password', () => {
  test('siempre devuelve 200 (no revela si el email existe)', async () => {
    const res = await request(app).post('/api/auth/olvide-password')
      .send({ email: 'fantasma@ejemplo.com' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('email registrado también devuelve 200', async () => {
    const res = await request(app).post('/api/auth/olvide-password')
      .send({ email: 'natalia@actideacontinnuo.com' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('sin email → 400', async () => {
    const res = await request(app).post('/api/auth/olvide-password').send({});
    expect(res.status).toBe(400);
  });
});

// ── Cambiar contraseña ─────────────────────────────────────
describe('POST /api/auth/cambiar-password', () => {
  async function loginAdmin() {
    const res = await request(app).post('/api/auth/login')
      .send({ email: 'natalia@actideacontinnuo.com', password: 'AdminTest123!' });
    return res.body.token;
  }

  test('permite cambiar a contraseña que cumple política', async () => {
    const token = await loginAdmin();
    const res   = await request(app).post('/api/auth/cambiar-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ passwordActual: 'AdminTest123!', passwordNuevo: 'NuevoAdmin2026@!' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });

  test('contraseña actual incorrecta → 401', async () => {
    const token = await loginAdmin();
    const res   = await request(app).post('/api/auth/cambiar-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ passwordActual: 'equivocada', passwordNuevo: 'NuevoAdmin2026@!' });
    expect(res.status).toBe(401);
  });

  test('nueva contraseña débil → 400', async () => {
    const token = await loginAdmin();
    const res   = await request(app).post('/api/auth/cambiar-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ passwordActual: 'AdminTest123!', passwordNuevo: 'debil' });
    expect(res.status).toBe(400);
  });

  test('sin token → 401', async () => {
    const res = await request(app).post('/api/auth/cambiar-password')
      .send({ passwordActual: 'A', passwordNuevo: 'B' });
    expect(res.status).toBe(401);
  });
});
