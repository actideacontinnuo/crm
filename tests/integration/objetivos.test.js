/**
 * Integration tests — Objetivos mensuales (solo admin)
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

describe('Control de acceso', () => {
  test('ejecutivo NO puede ver objetivos (403)', async () => {
    const res = await request(app).get('/api/objetivos/2026-07')
      .set('Authorization', `Bearer ${ejecToken()}`);
    expect(res.status).toBe(403);
  });

  test('ejecutivo NO puede modificar objetivos (403)', async () => {
    const res = await request(app).put('/api/objetivos/2026-07')
      .set('Authorization', `Bearer ${ejecToken()}`)
      .send({ cotizado: 1000000 });
    expect(res.status).toBe(403);
  });
});

describe('GET/PUT objetivos (admin)', () => {
  test('mes sin objetivos devuelve objeto vacío', async () => {
    const res = await request(app).get('/api/objetivos/2026-07')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });

  test('PUT crea objetivos para un mes nuevo', async () => {
    const res = await request(app).put('/api/objetivos/2026-07')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ opsActivas: 5, cotizado: 2000000, cobros: 1500000, pipeline: 800000, cliActivos: 10, comisiones: 120000 });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.objetivos.cotizado).toBe(2000000);
  });

  test('PUT sobre mes existente actualiza sin duplicar', async () => {
    await request(app).put('/api/objetivos/2026-07')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ cotizado: 2000000 });
    const res = await request(app).put('/api/objetivos/2026-07')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ cotizado: 2500000 });
    expect(res.status).toBe(200);
    expect(res.body.objetivos.cotizado).toBe(2500000);

    const leido = await request(app).get('/api/objetivos/2026-07')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(leido.body.cotizado).toBe(2500000);
  });

  test('GET devuelve los objetivos guardados con todas las llaves', async () => {
    await request(app).put('/api/objetivos/2026-08')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ opsActivas: 3, pipeline: 500000 });
    const res = await request(app).get('/api/objetivos/2026-08')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.body.opsActivas).toBe(3);
    expect(res.body.pipeline).toBe(500000);
    expect(res.body.cobros).toBe(0); // no seteado → read_number default
  });
});
