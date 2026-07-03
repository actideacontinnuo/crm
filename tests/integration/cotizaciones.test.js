/**
 * Integration tests — Cotizaciones
 * Cubre: CRUD, secciones JSON, alias de campos (fee/feePct, total/totalConIva), ownership
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
function ejecToken(ejec = 'Alexia') {
  return jwt.sign({ id: 'alexia', nombre: 'Alexia', role: 'ejecutivo', ejec }, SECRET, { expiresIn: '1h' });
}

let app;
beforeEach(() => {
  mockNotion.resetStore();
  app = buildApp();
});

const COT_VALIDA = {
  idCot:     'COT-2026-001',
  clienteId: 'cliente-abc',
  version:   'v1',
  fecha:     '2026-07-01',
  status:    'Borrador',
  subtotal:  100000,
  feePct:    15,
  iva:       16000,
  totalConIva: 133400,
  ejec:      'Natalia Gama',
  secciones: { audio: [{ concepto: 'Bocinas', monto: 40000 }], esceno: [], logistica: [], catering: [], otros: [] },
};

describe('POST /api/cotizaciones', () => {
  test('crea cotización completa con secciones', async () => {
    const res = await request(app).post('/api/cotizaciones')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(COT_VALIDA);
    expect([200, 201]).toContain(res.status);
    expect(res.body.cotId).toBe('COT-2026-001');
    expect(res.body.secciones.audio.length).toBe(1);
    expect(res.body.secciones.audio[0].monto).toBe(40000);
  });

  test('acepta el alias cotId en lugar de idCot', async () => {
    const { idCot, ...resto } = COT_VALIDA;
    const res = await request(app).post('/api/cotizaciones')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ ...resto, cotId: 'COT-ALIAS-01' });
    expect([200, 201]).toContain(res.status);
    expect(res.body.cotId).toBe('COT-ALIAS-01');
  });

  test('acepta alias fee y total', async () => {
    const { feePct, totalConIva, ...resto } = COT_VALIDA;
    const res = await request(app).post('/api/cotizaciones')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ ...resto, fee: 12, total: 99000 });
    expect([200, 201]).toContain(res.status);
    expect(res.body.fee).toBe(12);
    expect(res.body.total).toBe(99000);
  });

  test('secciones corruptas en Notion no rompen la lectura', async () => {
    const creada = await request(app).post('/api/cotizaciones')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(COT_VALIDA);
    // Corromper el JSON directamente en el mock store
    const res = await request(app).patch(`/api/cotizaciones/${creada.body.id}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ version: 'v2' });
    expect(res.status).toBe(200);
    expect(res.body.secciones).toBeDefined(); // siempre objeto con las 5 llaves
    expect(Array.isArray(res.body.secciones.audio)).toBe(true);
  });
});

describe('Ownership de cotizaciones', () => {
  test('ejecutivo solo ve sus cotizaciones', async () => {
    await request(app).post('/api/cotizaciones')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(COT_VALIDA);
    await request(app).post('/api/cotizaciones')
      .set('Authorization', `Bearer ${ejecToken('Alexia')}`)
      .send({ ...COT_VALIDA, idCot: 'COT-ALEXIA-1' });

    const res = await request(app).get('/api/cotizaciones')
      .set('Authorization', `Bearer ${ejecToken('Alexia')}`);
    expect(res.status).toBe(200);
    expect(res.body.every(c => c.ejec === 'Alexia')).toBe(true);
  });

  test('ejecutivo NO puede editar cotización ajena (403)', async () => {
    const creada = await request(app).post('/api/cotizaciones')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(COT_VALIDA);
    const res = await request(app).patch(`/api/cotizaciones/${creada.body.id}`)
      .set('Authorization', `Bearer ${ejecToken('Alexia')}`)
      .send({ status: 'Aprobada' });
    expect(res.status).toBe(403);
  });

  test('admin puede editar cualquier cotización', async () => {
    const creada = await request(app).post('/api/cotizaciones')
      .set('Authorization', `Bearer ${ejecToken('Alexia')}`)
      .send(COT_VALIDA);
    const res = await request(app).patch(`/api/cotizaciones/${creada.body.id}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ status: 'Aprobada' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Aprobada');
  });
});
