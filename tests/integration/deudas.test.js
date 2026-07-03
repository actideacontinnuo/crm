/**
 * Integration tests — Deudas (solo admin)
 */
const request    = require('supertest');
const mockNotion = require('../helpers/mock-notion');

jest.mock('../../api/notion', () => require('../helpers/mock-notion'));
jest.mock('../../api/_audit', () => ({ logAudit: jest.fn(), clientIp: () => '127.0.0.1' }));

const { buildApp } = require('../helpers/test-app');
const jwt = require('jsonwebtoken');
const { SECRET } = require('../../middleware/auth');

function adminToken() {
  return jwt.sign({ id: 'natalia', nombre: 'Natalia', role: 'admin', ejec: 'Natalia Gama' }, SECRET, { expiresIn: '1h' });
}
function ejecToken() {
  return jwt.sign({ id: 'alexia', nombre: 'Alexia', role: 'ejecutivo', ejec: 'Alexia' }, SECRET, { expiresIn: '1h' });
}

let app;
beforeEach(() => {
  mockNotion.resetStore();
  app = buildApp();
});

const DEUDA_VALIDA = {
  concepto: 'Renta de mobiliario',
  provId:   'prov-123',
  opId:     'op-456',
  monto:    45000,
  fecha:    '2026-07-20',
  status:   'Pendiente',
};

describe('Control de acceso', () => {
  test('ejecutivo NO puede ver deudas (403)', async () => {
    const res = await request(app).get('/api/deudas')
      .set('Authorization', `Bearer ${ejecToken()}`);
    expect(res.status).toBe(403);
  });

  test('admin puede listar deudas', async () => {
    const res = await request(app).get('/api/deudas')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('CRUD de deudas (admin)', () => {
  test('crear deuda y leerla de vuelta', async () => {
    const res = await request(app).post('/api/deudas')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(DEUDA_VALIDA);
    expect([200, 201]).toContain(res.status);
    expect(res.body.concepto).toBe('Renta de mobiliario');
    expect(res.body.monto).toBe(45000);

    const lista = await request(app).get('/api/deudas')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(lista.body.length).toBe(1);
  });

  test('marcar deuda como pagada (PATCH)', async () => {
    const creada = await request(app).post('/api/deudas')
      .set('Authorization', `Bearer ${adminToken()}`).send(DEUDA_VALIDA);
    const res = await request(app).patch(`/api/deudas/${creada.body.id}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ status: 'Pagada' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Pagada');
  });

  test('PATCH con id inexistente → 500 controlado', async () => {
    const res = await request(app).patch('/api/deudas/no-existe')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ status: 'Pagada' });
    expect(res.status).toBe(500);
  });
});
