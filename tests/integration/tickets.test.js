/**
 * Integration tests — Tickets (cambios/incidencias sobre cotizaciones)
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

const TICKET_VALIDO = {
  tipo:   'Descuento',
  cotId:  'COT-2026-001',
  monto:  '5000',
  quien:  'Natalia Gama',
  motivo: 'Cliente frecuente, descuento autorizado',
  status: 'Pendiente',
  fecha:  '2026-07-01',
};

describe('CRUD de tickets', () => {
  test('crear ticket', async () => {
    const res = await request(app).post('/api/tickets')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(TICKET_VALIDO);
    expect([200, 201]).toContain(res.status);
    expect(res.body.tipo).toBe('Descuento');
    expect(res.body.cotId).toBe('COT-2026-001');
  });

  test('listar tickets', async () => {
    await request(app).post('/api/tickets')
      .set('Authorization', `Bearer ${adminToken()}`).send(TICKET_VALIDO);
    const res = await request(app).get('/api/tickets')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
  });

  test('aprobar ticket (PATCH)', async () => {
    const creado = await request(app).post('/api/tickets')
      .set('Authorization', `Bearer ${adminToken()}`).send(TICKET_VALIDO);
    const res = await request(app).patch(`/api/tickets/${creado.body.id}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ status: 'Aprobado' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Aprobado');
  });

  test('sin token → 401', async () => {
    const res = await request(app).get('/api/tickets');
    expect(res.status).toBe(401);
  });

  test('PATCH con id inexistente → 500 controlado', async () => {
    const res = await request(app).patch('/api/tickets/no-existe')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ status: 'Aprobado' });
    expect(res.status).toBe(500);
  });
});
