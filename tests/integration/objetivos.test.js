/**
 * Integration tests — Objetivos ANUALES de Actidea (un registro por año)
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
  // Capa 1 · Empresa (ANUAL)
  metaVentas: 36000000,
  metaProduccion: 8000000,
  metaPipeline: 18000000,
  metaClientes: 12,
  // Capa 2 · Dirección (ANUAL)
  metaUtilidad: 10800000,
  metaCobranza: 30000000,
  // Capa 3 · Individuales (ANUAL)
  objetivoEjecutivo: 30000000,
  objetivosIndividuales: { Ximena: 24000000, Alexia: 9600000 },
};

describe('Control de acceso', () => {
  test('ejecutivo SÍ puede VER los objetivos (alimentan su dashboard)', async () => {
    await request(app).put('/api/objetivos/2026')
      .set('Authorization', `Bearer ${adminToken()}`).send(OBJETIVOS);
    const res = await request(app).get('/api/objetivos/2026')
      .set('Authorization', `Bearer ${ejecToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.metaVentas).toBe(36000000);
  });

  test('ejecutivo NO puede modificar objetivos (403)', async () => {
    const res = await request(app).put('/api/objetivos/2026')
      .set('Authorization', `Bearer ${ejecToken()}`)
      .send({ metaVentas: 10000000 });
    expect(res.status).toBe(403);
  });

  test('sin token no hay acceso (401)', async () => {
    const res = await request(app).get('/api/objetivos/2026');
    expect(res.status).toBe(401);
  });
});

describe('Validaciones', () => {
  test('año con formato inválido → 400 (GET y PUT)', async () => {
    const g = await request(app).get('/api/objetivos/2026-07')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(g.status).toBe(400);
    const p = await request(app).put('/api/objetivos/26')
      .set('Authorization', `Bearer ${adminToken()}`).send({ metaVentas: 1 });
    expect(p.status).toBe(400);
  });

  test('valores negativos o no numéricos → 400', async () => {
    const neg = await request(app).put('/api/objetivos/2026')
      .set('Authorization', `Bearer ${adminToken()}`).send({ metaVentas: -5 });
    expect(neg.status).toBe(400);
    const nan = await request(app).put('/api/objetivos/2026')
      .set('Authorization', `Bearer ${adminToken()}`).send({ metaPipeline: 'mucho' });
    expect(nan.status).toBe(400);
  });
});

describe('GET/PUT objetivos', () => {
  test('año sin objetivos devuelve objeto vacío', async () => {
    const res = await request(app).get('/api/objetivos/2026')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });

  test('PUT crea objetivos con los campos de Actidea', async () => {
    const res = await request(app).put('/api/objetivos/2026')
      .set('Authorization', `Bearer ${adminToken()}`).send(OBJETIVOS);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.objetivos.metaVentas).toBe(36000000);
    expect(res.body.objetivos.metaProduccion).toBe(8000000);
    expect(res.body.objetivos.metaPipeline).toBe(18000000);
    expect(res.body.objetivos.metaClientes).toBe(12);
    expect(res.body.objetivos.objetivoEjecutivo).toBe(30000000);
  });

  test('PUT sobre año existente actualiza sin duplicar', async () => {
    await request(app).put('/api/objetivos/2026')
      .set('Authorization', `Bearer ${adminToken()}`).send({ metaVentas: 20000000 });
    const res = await request(app).put('/api/objetivos/2026')
      .set('Authorization', `Bearer ${adminToken()}`).send({ metaVentas: 25000000 });
    expect(res.status).toBe(200);
    expect(res.body.objetivos.metaVentas).toBe(25000000);

    const leido = await request(app).get('/api/objetivos/2026')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(leido.body.metaVentas).toBe(25000000);
  });

  test('actualización parcial no borra los demás campos', async () => {
    await request(app).put('/api/objetivos/2026')
      .set('Authorization', `Bearer ${adminToken()}`).send(OBJETIVOS);
    await request(app).put('/api/objetivos/2026')
      .set('Authorization', `Bearer ${adminToken()}`).send({ objetivoEjecutivo: 33000000 });
    const res = await request(app).get('/api/objetivos/2026')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.body.objetivoEjecutivo).toBe(33000000);
    expect(res.body.metaVentas).toBe(36000000);
    expect(res.body.metaClientes).toBe(12);
  });


  test('las 3 capas se guardan y se leen íntegras', async () => {
    await request(app).put('/api/objetivos/2026')
      .set('Authorization', `Bearer ${adminToken()}`).send(OBJETIVOS);
    const res = await request(app).get('/api/objetivos/2026')
      .set('Authorization', `Bearer ${adminToken()}`);
    // Capa 1
    expect(res.body.metaVentas).toBe(36000000);
    expect(res.body.metaClientes).toBe(12);
    // Capa 2
    expect(res.body.metaUtilidad).toBe(10800000);
    expect(res.body.metaCobranza).toBe(30000000);
    // Capa 3
    expect(res.body.objetivosIndividuales).toEqual({ Ximena: 24000000, Alexia: 9600000 });
  });

  test('objetivos individuales inválidos → 400', async () => {
    const arr = await request(app).put('/api/objetivos/2026')
      .set('Authorization', `Bearer ${adminToken()}`).send({ objetivosIndividuales: [1, 2] });
    expect(arr.status).toBe(400);
    const neg = await request(app).put('/api/objetivos/2026')
      .set('Authorization', `Bearer ${adminToken()}`).send({ objetivosIndividuales: { Ximena: -5 } });
    expect(neg.status).toBe(400);
  });

  test('objetivos individuales en cero se descartan (no se guardan)', async () => {
    await request(app).put('/api/objetivos/2026')
      .set('Authorization', `Bearer ${adminToken()}`).send({ objetivosIndividuales: { Ximena: 10000000, Alexia: 0 } });
    const res = await request(app).get('/api/objetivos/2026')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.body.objetivosIndividuales).toEqual({ Ximena: 10000000 });
  });

  test('cada año guarda objetivos independientes', async () => {
    await request(app).put('/api/objetivos/2026')
      .set('Authorization', `Bearer ${adminToken()}`).send({ metaVentas: 10000000 });
    await request(app).put('/api/objetivos/2027')
      .set('Authorization', `Bearer ${adminToken()}`).send({ metaVentas: 90000000 });
    const a2026 = await request(app).get('/api/objetivos/2026').set('Authorization', `Bearer ${adminToken()}`);
    const a2027 = await request(app).get('/api/objetivos/2027').set('Authorization', `Bearer ${adminToken()}`);
    expect(a2026.body.metaVentas).toBe(10000000);
    expect(a2027.body.metaVentas).toBe(90000000);
  });
});
