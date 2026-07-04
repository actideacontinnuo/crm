/**
 * Integration tests — Objetivos mensuales de Actidea
 * Lectura: cualquier usuario autenticado (las metas alimentan su dashboard).
 * Escritura: solo Admin.
 * Campos: metaVentas, metaProduccion, metaPipeline, metaClientes, objetivoEjecutivo
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

const OBJETIVOS = {
  metaVentas: 3000000,
  metaProduccion: 8000000,
  metaPipeline: 18000000,
  metaClientes: 12,
  objetivoEjecutivo: 2500000,
};

describe('Control de acceso', () => {
  test('ejecutivo SÍ puede VER los objetivos (alimentan su dashboard)', async () => {
    await request(app).put('/api/objetivos/2026-07')
      .set('Authorization', `Bearer ${adminToken()}`).send(OBJETIVOS);
    const res = await request(app).get('/api/objetivos/2026-07')
      .set('Authorization', `Bearer ${ejecToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.metaVentas).toBe(3000000);
  });

  test('ejecutivo NO puede modificar objetivos (403)', async () => {
    const res = await request(app).put('/api/objetivos/2026-07')
      .set('Authorization', `Bearer ${ejecToken()}`)
      .send({ metaVentas: 1000000 });
    expect(res.status).toBe(403);
  });

  test('sin token no hay acceso (401)', async () => {
    const res = await request(app).get('/api/objetivos/2026-07');
    expect(res.status).toBe(401);
  });
});

describe('Validaciones', () => {
  test('mes con formato inválido → 400 (GET y PUT)', async () => {
    const g = await request(app).get('/api/objetivos/julio-2026')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(g.status).toBe(400);
    const p = await request(app).put('/api/objetivos/2026-13')
      .set('Authorization', `Bearer ${adminToken()}`).send({ metaVentas: 1 });
    expect(p.status).toBe(400);
  });

  test('valores negativos o no numéricos → 400', async () => {
    const neg = await request(app).put('/api/objetivos/2026-07')
      .set('Authorization', `Bearer ${adminToken()}`).send({ metaVentas: -5 });
    expect(neg.status).toBe(400);
    const nan = await request(app).put('/api/objetivos/2026-07')
      .set('Authorization', `Bearer ${adminToken()}`).send({ metaPipeline: 'mucho' });
    expect(nan.status).toBe(400);
  });
});

describe('GET/PUT objetivos', () => {
  test('mes sin objetivos devuelve objeto vacío', async () => {
    const res = await request(app).get('/api/objetivos/2026-07')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });

  test('PUT crea objetivos con los 5 campos de Actidea', async () => {
    const res = await request(app).put('/api/objetivos/2026-07')
      .set('Authorization', `Bearer ${adminToken()}`).send(OBJETIVOS);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.objetivos.metaVentas).toBe(3000000);
    expect(res.body.objetivos.metaProduccion).toBe(8000000);
    expect(res.body.objetivos.metaPipeline).toBe(18000000);
    expect(res.body.objetivos.metaClientes).toBe(12);
    expect(res.body.objetivos.objetivoEjecutivo).toBe(2500000);
  });

  test('PUT sobre mes existente actualiza sin duplicar', async () => {
    await request(app).put('/api/objetivos/2026-07')
      .set('Authorization', `Bearer ${adminToken()}`).send({ metaVentas: 2000000 });
    const res = await request(app).put('/api/objetivos/2026-07')
      .set('Authorization', `Bearer ${adminToken()}`).send({ metaVentas: 2500000 });
    expect(res.status).toBe(200);
    expect(res.body.objetivos.metaVentas).toBe(2500000);

    const leido = await request(app).get('/api/objetivos/2026-07')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(leido.body.metaVentas).toBe(2500000);
  });

  test('actualización parcial no borra los demás campos', async () => {
    await request(app).put('/api/objetivos/2026-08')
      .set('Authorization', `Bearer ${adminToken()}`).send(OBJETIVOS);
    await request(app).put('/api/objetivos/2026-08')
      .set('Authorization', `Bearer ${adminToken()}`).send({ objetivoEjecutivo: 3000000 });
    const res = await request(app).get('/api/objetivos/2026-08')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.body.objetivoEjecutivo).toBe(3000000);
    expect(res.body.metaVentas).toBe(3000000);
    expect(res.body.metaClientes).toBe(12);
  });

  test('cada mes guarda objetivos independientes', async () => {
    await request(app).put('/api/objetivos/2026-07')
      .set('Authorization', `Bearer ${adminToken()}`).send({ metaVentas: 1000000 });
    await request(app).put('/api/objetivos/2026-08')
      .set('Authorization', `Bearer ${adminToken()}`).send({ metaVentas: 9000000 });
    const jul = await request(app).get('/api/objetivos/2026-07').set('Authorization', `Bearer ${adminToken()}`);
    const ago = await request(app).get('/api/objetivos/2026-08').set('Authorization', `Bearer ${adminToken()}`);
    expect(jul.body.metaVentas).toBe(1000000);
    expect(ago.body.metaVentas).toBe(9000000);
  });
});
