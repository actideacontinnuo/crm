/**
 * Integration tests — OPs (Órdenes de Producción)
 * Cubre: CRUD, campos correctos, OP interna, desajustes frontend↔backend
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

let app;
beforeEach(() => {
  mockNotion.resetStore();
  app = buildApp();
});

const OP_VALIDA = {
  numero:      'OP-2026-001',
  desc:        'Congreso Nacional Tech 2026',
  clienteId:   'cliente-test-id',
  ejec:        'Natalia Gama',
  fechaEvento: '2026-08-15',
  cotizado:    150000,
  cobrado:     0,
  utilidad:    0,
  status:      'Cotización',
};

describe('POST /api/ops', () => {
  test('crea OP con campos correctos', async () => {
    const res = await request(app).post('/api/ops')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(OP_VALIDA);
    expect([200, 201]).toContain(res.status);
    expect(res.body.id).toBeDefined();
  });

  test('el objeto devuelto tiene id definido y status correcto', async () => {
    const res = await request(app).post('/api/ops')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(OP_VALIDA);
    expect(res.body.id).toBeDefined();
    expect(res.body.status).toBe('Cotización');
  });

  test('el objeto devuelto tiene clienteId mapeado desde el backend', async () => {
    const res = await request(app).post('/api/ops')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(OP_VALIDA);
    // clienteId se guarda en Notion como 'Cliente ID' y se lee como clienteId
    expect(res.body.clienteId).toBe('cliente-test-id');
  });

  test('el objeto devuelto tiene fechaEvento', async () => {
    const res = await request(app).post('/api/ops')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(OP_VALIDA);
    expect(res.body.fechaEvento).toBe('2026-08-15');
  });
});

describe('GET /api/ops', () => {
  test('devuelve array', async () => {
    const res = await request(app).get('/api/ops')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('OP creada aparece en la lista', async () => {
    await request(app).post('/api/ops')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(OP_VALIDA);
    const res = await request(app).get('/api/ops')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.body.length).toBe(1);
    expect(res.body[0].clienteId).toBe('cliente-test-id');
  });
});

describe('PATCH /api/ops/:id', () => {
  test('actualiza cotizado', async () => {
    const create = await request(app).post('/api/ops')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(OP_VALIDA);
    const id = create.body.id;

    const res = await request(app).patch(`/api/ops/${id}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ cotizado: 200000, status: 'En Producción' });
    expect(res.status).toBe(200);
  });
});
