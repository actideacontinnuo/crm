/**
 * Integration tests — Manejo de errores 500 en TODOS los routers
 * Usa mockNotion.setFailNext() para simular que Notion está caído
 * y verificar que cada catch responde 500 con JSON de error (sin crashear).
 */
const request    = require('supertest');
const mockNotion = require('../helpers/mock-notion');

jest.mock('../../api/notion', () => require('../helpers/mock-notion'));
jest.mock('../../api/_audit', () => ({ logAudit: jest.fn(), clientIp: () => '127.0.0.1' }));

const { buildApp } = require('../helpers/test-app');
const jwt = require('jsonwebtoken');
const { SECRET } = require('../../middleware/auth');

const adminToken = () =>
  jwt.sign({ id: 'natalia', nombre: 'Natalia', role: 'admin', ejec: 'Natalia Gama' }, SECRET, { expiresIn: '1h' });

let app;
beforeEach(() => {
  mockNotion.resetStore();
  app = buildApp();
});

// Casos [método, ruta, body] — todos deben responder 500 si Notion falla
const CASOS = [
  ['get',    '/api/prospectos'],
  ['post',   '/api/prospectos',        { empresa: 'X' }],
  ['get',    '/api/prospectos/algun-id'],
  ['patch',  '/api/prospectos/algun-id', { status: 'Y' }],
  ['delete', '/api/prospectos/algun-id'],
  ['get',    '/api/clientes'],
  ['post',   '/api/clientes',          { nombre: 'X' }],
  ['get',    '/api/clientes/algun-id'],
  ['patch',  '/api/clientes/algun-id', { status: 'Y' }],
  ['delete', '/api/clientes/algun-id'],
  ['get',    '/api/ops'],
  ['post',   '/api/ops',               { numero: 'OP-1' }],
  ['get',    '/api/ops/algun-id'],
  ['patch',  '/api/ops/algun-id',      { status: 'Y' }],
  ['get',    '/api/cotizaciones'],
  ['post',   '/api/cotizaciones',      { cotId: 'COT-1' }],
  ['get',    '/api/cotizaciones/algun-id'],
  ['patch',  '/api/cotizaciones/algun-id', { status: 'Y' }],
  ['get',    '/api/pagos'],
  ['post',   '/api/pagos',             { concepto: 'X' }],
  ['get',    '/api/pagos/algun-id'],
  ['patch',  '/api/pagos/algun-id',    { status: 'Y' }],
  ['get',    '/api/deudas'],
  ['post',   '/api/deudas',            { concepto: 'X' }],
  ['patch',  '/api/deudas/algun-id',   { status: 'Y' }],
  ['get',    '/api/proveedores'],
  ['post',   '/api/proveedores',       { nombre: 'X' }],
  ['get',    '/api/proveedores/algun-id'],
  ['patch',  '/api/proveedores/algun-id', { notas: 'Y' }],
  ['delete', '/api/proveedores/algun-id'],
  ['get',    '/api/casos'],
  ['post',   '/api/casos',             { titulo: 'X' }],
  ['get',    '/api/casos/algun-id'],
  ['patch',  '/api/casos/algun-id',    { status: 'Y' }],
  ['get',    '/api/tickets'],
  ['post',   '/api/tickets',           { tipo: 'X' }],
  ['patch',  '/api/tickets/algun-id',  { status: 'Y' }],
  ['get',    '/api/auditoria'],
  ['get',    '/api/objetivos/2026-07'],
  ['put',    '/api/objetivos/2026-07', { cotizado: 1 }],
];

describe.each(CASOS)('Notion caído → %s %s', (metodo, ruta, body) => {
  test('responde 500 con JSON de error', async () => {
    mockNotion.setFailNext('Notion caído (simulado)');
    let req = request(app)[metodo](ruta).set('Authorization', `Bearer ${adminToken()}`);
    if (body) req = req.send(body);
    const res = await req;
    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});

describe('Auth — errores 500', () => {
  test('login responde 500 si Notion falla', async () => {
    mockNotion.setFailNext();
    const res = await request(app).post('/api/auth/login')
      .send({ usuario: 'natalia', password: 'AdminTest123!' });
    expect(res.status).toBe(500);
  });

  test('cambiar-password responde 500 si Notion falla', async () => {
    mockNotion.setFailNext();
    const res = await request(app).post('/api/auth/cambiar-password')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ passwordActual: 'AdminTest123!', passwordNuevo: 'NuevaClave2026!!' });
    expect(res.status).toBe(500);
  });

  test('GET /usuarios responde 500 si Notion falla', async () => {
    mockNotion.setFailNext();
    const res = await request(app).get('/api/auth/usuarios')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(500);
  });

  test('POST /usuarios responde 500 si Notion falla', async () => {
    mockNotion.setFailNext();
    const res = await request(app).post('/api/auth/usuarios')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ usuario: 'nuevo', nombre: 'Nuevo', email: 'n@x.com', rol: 'ejecutivo' });
    expect(res.status).toBe(500);
  });

  test('activar usuario responde 500 si Notion falla', async () => {
    mockNotion.setFailNext();
    const res = await request(app).post('/api/auth/usuarios/natalia/activar')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ activo: true });
    expect(res.status).toBe(500);
  });

  test('resetear-password responde 500 si Notion falla', async () => {
    mockNotion.setFailNext();
    const res = await request(app).post('/api/auth/usuarios/natalia/resetear-password')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(500);
  });

  test('desbloquear responde 500 si Notion falla', async () => {
    mockNotion.setFailNext();
    const res = await request(app).post('/api/auth/usuarios/natalia/desbloquear')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(500);
  });

  test('2fa/setup responde 500 si Notion falla', async () => {
    mockNotion.setFailNext();
    const res = await request(app).get('/api/auth/2fa/setup')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(500);
  });

  test('2fa/confirm responde 500 si Notion falla', async () => {
    mockNotion.setFailNext();
    const res = await request(app).post('/api/auth/2fa/confirm')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ code: '123456' });
    expect(res.status).toBe(500);
  });

  test('2fa/disable responde 500 si Notion falla', async () => {
    mockNotion.setFailNext();
    const res = await request(app).post('/api/auth/2fa/disable')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ password: 'AdminTest123!' });
    expect(res.status).toBe(500);
  });

  test('2fa/status responde 500 si Notion falla', async () => {
    mockNotion.setFailNext();
    const res = await request(app).get('/api/auth/2fa/status')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(500);
  });

  test('verify-2fa responde 500 si Notion falla (token temporal válido)', async () => {
    const tempToken = jwt.sign({ id: 'natalia', scope: '2fa-pending' }, SECRET, { expiresIn: '5m' });
    mockNotion.setFailNext();
    const res = await request(app).post('/api/auth/verify-2fa')
      .send({ tempToken, code: '123456' });
    expect(res.status).toBe(500);
  });

  test('olvide-password NUNCA revela el error (responde ok aunque Notion falle)', async () => {
    mockNotion.setFailNext();
    const res = await request(app).post('/api/auth/olvide-password')
      .send({ email: 'natalia@actideacontinnuo.com' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('reset-password responde 500 si Notion falla', async () => {
    mockNotion.setFailNext();
    const res = await request(app).post('/api/auth/reset-password')
      .send({ token: 'algo', nueva: 'ClaveValida2026!!' });
    expect(res.status).toBe(500);
  });
});
