/**
 * Integration tests — Proveedores
 * Cubre: CRUD, mapeo de factura, DELETE solo admin
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

const PROV_VALIDO = {
  nombre:   'Audio Pro SA',
  razon:    'Audio Profesional SA de CV',
  rfc:      'APR010101AB1',
  banco:    'BBVA',
  clabe:    '012180001234567895',
  servicio: 'Renta de audio',
  cond:     '50% anticipo',
  emiteFactura: true,
  contacto: 'Marco Ruiz',
  tel:      '5599887766',
  email:    'marco@audiopro.mx',
  notas:    'Puntual y confiable',
};

describe('CRUD de proveedores', () => {
  test('crear proveedor completo', async () => {
    const res = await request(app).post('/api/proveedores')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(PROV_VALIDO);
    expect([200, 201]).toContain(res.status);
    expect(res.body.nombre).toBe('Audio Pro SA');
    expect(res.body.clabe).toBe('012180001234567895');
  });

  test('emiteFactura=true se mapea a texto legible', async () => {
    const res = await request(app).post('/api/proveedores')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(PROV_VALIDO);
    expect(res.body.factura).toBe('Sí — emite factura');
    expect(res.body.emiteFactura).toBe(true);
  });

  test('emiteFactura=false se mapea a "solo recibo"', async () => {
    const res = await request(app).post('/api/proveedores')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ ...PROV_VALIDO, emiteFactura: false });
    expect(res.body.factura).toBe('No — solo recibo');
  });

  test('ejecutivo puede crear y editar proveedores', async () => {
    const creado = await request(app).post('/api/proveedores')
      .set('Authorization', `Bearer ${ejecToken()}`)
      .send(PROV_VALIDO);
    expect([200, 201]).toContain(creado.status);

    const res = await request(app).patch(`/api/proveedores/${creado.body.id}`)
      .set('Authorization', `Bearer ${ejecToken()}`)
      .send({ notas: 'Actualizado por ejecutivo' });
    expect(res.status).toBe(200);
    expect(res.body.notas).toBe('Actualizado por ejecutivo');
  });

  test('listar y obtener por id', async () => {
    const creado = await request(app).post('/api/proveedores')
      .set('Authorization', `Bearer ${adminToken()}`).send(PROV_VALIDO);

    const lista = await request(app).get('/api/proveedores')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(lista.body.length).toBe(1);

    const uno = await request(app).get(`/api/proveedores/${creado.body.id}`)
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(uno.status).toBe(200);
    expect(uno.body.rfc).toBe('APR010101AB1');
  });
});

describe('DELETE — solo admin', () => {
  test('ejecutivo NO puede eliminar proveedor (403)', async () => {
    const creado = await request(app).post('/api/proveedores')
      .set('Authorization', `Bearer ${adminToken()}`).send(PROV_VALIDO);
    const res = await request(app).delete(`/api/proveedores/${creado.body.id}`)
      .set('Authorization', `Bearer ${ejecToken()}`);
    expect(res.status).toBe(403);
  });

  test('admin SÍ puede eliminar proveedor', async () => {
    const creado = await request(app).post('/api/proveedores')
      .set('Authorization', `Bearer ${adminToken()}`).send(PROV_VALIDO);
    const res = await request(app).delete(`/api/proveedores/${creado.body.id}`)
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);

    const lista = await request(app).get('/api/proveedores')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(lista.body.length).toBe(0);
  });
});

describe('Errores', () => {
  test('GET /:id inexistente → 500 controlado', async () => {
    const res = await request(app).get('/api/proveedores/no-existe')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(500);
  });

  test('PATCH /:id inexistente → 500 controlado', async () => {
    const res = await request(app).patch('/api/proveedores/no-existe')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ notas: 'x' });
    expect(res.status).toBe(500);
  });
});
