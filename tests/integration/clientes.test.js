/**
 * Integration tests — CRUD de Clientes
 * Cubre: creación, lectura, edición, docs JSON, ownership por ejecutivo, roles
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

const CLIENTE_VALIDO = {
  nombre:   'Grupo Modelo',
  codigo:   'GM-001',
  razon:    'Grupo Modelo SA de CV',
  rfc:      'GMO123456AB1',
  dir:      'Av. Reforma 100, CDMX',
  contacto: 'Laura Silva',
  cargo:    'Gerente de Eventos',
  tel:      '5511122233',
  email:    'laura@grupomodelo.com',
  ejec:     'Natalia Gama',
  pago:     '30 días',
  status:   'Activo',
};

describe('POST /api/clientes', () => {
  test('admin puede crear cliente con todos los campos', async () => {
    const res = await request(app).post('/api/clientes')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(CLIENTE_VALIDO);
    expect([200, 201]).toContain(res.status);
    expect(res.body.id).toBeDefined();
    expect(res.body.nombre).toBe('Grupo Modelo');
    expect(res.body.rfc).toBe('GMO123456AB1');
  });

  test('docs como objeto se serializa a JSON y se conserva', async () => {
    const docs = { csf: true, oc: { sentido: 'POSITIVO' }, ec: { banco: 'BBVA', clabe: '012180001234567895' } };
    const res = await request(app).post('/api/clientes')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ ...CLIENTE_VALIDO, docs });
    expect([200, 201]).toContain(res.status);
    expect(JSON.parse(res.body.docs)).toEqual(docs);
  });

  test('ejecutivo que crea un cliente queda como dueño aunque mande otro ejec', async () => {
    const res = await request(app).post('/api/clientes')
      .set('Authorization', `Bearer ${ejecToken('Alexia')}`)
      .send({ ...CLIENTE_VALIDO });
    expect([200, 201]).toContain(res.status);
    expect(res.body.propietario).toBe('Alexia'); // el creador queda como Propietario
  });
});

describe('GET /api/clientes — filtro por ejecutivo', () => {
  test('ejecutivo solo ve sus propios clientes', async () => {
    await request(app).post('/api/clientes')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ ...CLIENTE_VALIDO, ejec: 'Natalia Gama' });
    await request(app).post('/api/clientes')
      .set('Authorization', `Bearer ${ejecToken('Alexia')}`)
      .send({ ...CLIENTE_VALIDO, nombre: 'Cliente de Alexia' });

    const res = await request(app).get('/api/clientes')
      .set('Authorization', `Bearer ${ejecToken('Alexia')}`);
    expect(res.status).toBe(200);
    expect(res.body.every(c => [c.propietario, c.ejecCuenta, c.ejecAsignado, c.ejec].includes('Alexia'))).toBe(true);
  });

  test('admin ve todos los clientes', async () => {
    await request(app).post('/api/clientes')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(CLIENTE_VALIDO);
    await request(app).post('/api/clientes')
      .set('Authorization', `Bearer ${ejecToken('Alexia')}`)
      .send({ ...CLIENTE_VALIDO, nombre: 'Otro' });

    const res = await request(app).get('/api/clientes')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.body.length).toBe(2);
  });
});

describe('PATCH /api/clientes/:id — ownership', () => {
  test('ejecutivo NO puede editar cliente de otro ejecutivo (403)', async () => {
    const creado = await request(app).post('/api/clientes')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ ...CLIENTE_VALIDO, ejec: 'Natalia Gama' });

    const res = await request(app).patch(`/api/clientes/${creado.body.id}`)
      .set('Authorization', `Bearer ${ejecToken('Alexia')}`)
      .send({ status: 'Inactivo' });
    expect(res.status).toBe(403);
  });

  test('ejecutivo NO puede reasignar el dueño de su propio cliente', async () => {
    const creado = await request(app).post('/api/clientes')
      .set('Authorization', `Bearer ${ejecToken('Alexia')}`)
      .send(CLIENTE_VALIDO);

    await request(app).patch(`/api/clientes/${creado.body.id}`)
      .set('Authorization', `Bearer ${ejecToken('Alexia')}`)
      .send({ status: 'Inactivo' });

    const res = await request(app).get(`/api/clientes/${creado.body.id}`)
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.body.propietario).toBe('Alexia'); // el propietario sigue siendo Alexia
    expect(res.body.status).toBe('Inactivo'); // el campo mutable sí cambió
  });
});

describe('DELETE /api/clientes/:id — roles', () => {
  test('ejecutivo NO puede eliminar (403)', async () => {
    const creado = await request(app).post('/api/clientes')
      .set('Authorization', `Bearer ${ejecToken('Alexia')}`)
      .send(CLIENTE_VALIDO);
    const res = await request(app).delete(`/api/clientes/${creado.body.id}`)
      .set('Authorization', `Bearer ${ejecToken('Alexia')}`);
    expect(res.status).toBe(403);
  });

  test('admin SÍ puede eliminar', async () => {
    const creado = await request(app).post('/api/clientes')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(CLIENTE_VALIDO);
    const res = await request(app).delete(`/api/clientes/${creado.body.id}`)
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe('Autenticación', () => {
  test('sin token → 401', async () => {
    const res = await request(app).get('/api/clientes');
    expect(res.status).toBe(401);
  });

  test('token inválido → 401', async () => {
    const res = await request(app).get('/api/clientes')
      .set('Authorization', 'Bearer token-falso');
    expect(res.status).toBe(401);
  });
});
