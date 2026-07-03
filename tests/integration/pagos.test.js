/**
 * Integration tests — Pagos (solo admin)
 * Cubre: restricción de rol, CRUD, tipos de pago
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
function adminisToken() {
  return jwt.sign({ id: 'oscar', nombre: 'Oscar', role: 'administracion', ejec: null }, SECRET, { expiresIn: '1h' });
}

let app;
beforeEach(() => {
  mockNotion.resetStore();
  app = buildApp();
});

const PAGO_VALIDO = {
  concepto:      'Anticipo evento anual',
  tipo:          'Cobro',
  monto:         100000,
  fechaAcordada: '2026-07-15',
  status:        'Pendiente',
  forma:         'Transferencia SPEI',
  ref:           'REF-9912',
  comprobante:   false,
};

describe('Control de acceso a /api/pagos', () => {
  test('admin puede listar pagos', async () => {
    const res = await request(app).get('/api/pagos')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
  });

  test('ejecutivo NO puede ver pagos (403)', async () => {
    const res = await request(app).get('/api/pagos')
      .set('Authorization', `Bearer ${ejecToken()}`);
    expect(res.status).toBe(403);
  });

  test('administración NO puede ver pagos (403)', async () => {
    const res = await request(app).get('/api/pagos')
      .set('Authorization', `Bearer ${adminisToken()}`);
    expect(res.status).toBe(403);
  });

  test('ejecutivo NO puede crear pagos (403)', async () => {
    const res = await request(app).post('/api/pagos')
      .set('Authorization', `Bearer ${ejecToken()}`)
      .send(PAGO_VALIDO);
    expect(res.status).toBe(403);
  });
});

describe('CRUD de pagos (admin)', () => {
  test('crear pago y leerlo de vuelta', async () => {
    const creado = await request(app).post('/api/pagos')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(PAGO_VALIDO);
    expect([200, 201]).toContain(creado.status);
    expect(creado.body.concepto).toBe('Anticipo evento anual');
    expect(creado.body.monto).toBe(100000);

    const lista = await request(app).get('/api/pagos')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(lista.body.length).toBe(1);
  });

  test('marcar pago como pagado (PATCH)', async () => {
    const creado = await request(app).post('/api/pagos')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(PAGO_VALIDO);

    const res = await request(app).patch(`/api/pagos/${creado.body.id}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ status: 'Pagado', fechaReal: '2026-07-16', comprobante: true });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Pagado');
    expect(res.body.fechaReal).toBe('2026-07-16');
    expect(res.body.comprobante).toBe(true);
  });

  test('monto no numérico se guarda como null, no rompe', async () => {
    const res = await request(app).post('/api/pagos')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ ...PAGO_VALIDO, monto: 'no-es-numero' });
    expect([200, 201]).toContain(res.status);
    expect(res.body.monto).toBe(0); // read_number normaliza null → 0
  });
});
