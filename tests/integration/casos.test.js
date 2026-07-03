/**
 * Integration tests — Casos
 * Cubre: CRUD, historial JSON, normalización de historial corrupto, errores
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

const CASO_VALIDO = {
  titulo:    'Cambio de fecha del evento',
  clienteId: 'cliente-123',
  opId:      'op-456',
  tipo:      'Cambio',
  prio:      'Alta',
  quien:     'Laura Silva',
  desc:      'El cliente pide mover el evento una semana',
  accion:    'Confirmar disponibilidad de proveedores',
  status:    'Abierto',
  fecha:     '2026-07-01',
  historial: [{ fecha: '2026-07-01', nota: 'Caso creado' }],
};

describe('CRUD de casos', () => {
  test('crear caso con historial', async () => {
    const res = await request(app).post('/api/casos')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(CASO_VALIDO);
    expect([200, 201]).toContain(res.status);
    expect(res.body.titulo).toBe('Cambio de fecha del evento');
    expect(res.body.historial.length).toBe(1);
    expect(res.body.historial[0].nota).toBe('Caso creado');
  });

  test('opId vacío se normaliza a null en la lectura', async () => {
    const res = await request(app).post('/api/casos')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ ...CASO_VALIDO, opId: '' });
    expect(res.body.opId).toBeNull();
  });

  test('historial no-array se guarda como []', async () => {
    const res = await request(app).post('/api/casos')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ ...CASO_VALIDO, historial: 'no-es-array' });
    expect(Array.isArray(res.body.historial)).toBe(true);
    expect(res.body.historial.length).toBe(0);
  });

  test('listar casos', async () => {
    await request(app).post('/api/casos')
      .set('Authorization', `Bearer ${adminToken()}`).send(CASO_VALIDO);
    const res = await request(app).get('/api/casos')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
  });

  test('obtener caso por id', async () => {
    const creado = await request(app).post('/api/casos')
      .set('Authorization', `Bearer ${adminToken()}`).send(CASO_VALIDO);
    const res = await request(app).get(`/api/casos/${creado.body.id}`)
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.titulo).toBe('Cambio de fecha del evento');
  });

  test('agregar entrada al historial vía PATCH', async () => {
    const creado = await request(app).post('/api/casos')
      .set('Authorization', `Bearer ${adminToken()}`).send(CASO_VALIDO);
    const nuevoHistorial = [...CASO_VALIDO.historial, { fecha: '2026-07-02', nota: 'Proveedor confirmó' }];
    const res = await request(app).patch(`/api/casos/${creado.body.id}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ historial: nuevoHistorial, status: 'En proceso' });
    expect(res.status).toBe(200);
    expect(res.body.historial.length).toBe(2);
    expect(res.body.status).toBe('En proceso');
  });
});

describe('Errores', () => {
  test('GET /:id con id inexistente → 500 controlado', async () => {
    const res = await request(app).get('/api/casos/no-existe')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });

  test('PATCH con id inexistente → 500 controlado', async () => {
    const res = await request(app).patch('/api/casos/no-existe')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ status: 'Cerrado' });
    expect(res.status).toBe(500);
  });
});
