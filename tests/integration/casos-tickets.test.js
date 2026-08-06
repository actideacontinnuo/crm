/**
 * Integration tests — Casos y Tickets: heredan acceso por fila del registro
 * al que están ligados (OP/Cliente para Casos, Cotización para Tickets).
 * Antes no tenían NINGÚN control de acceso — cualquier usuario autenticado
 * veía y editaba los de todos los demás.
 */
const request    = require('supertest');
const mockNotion = require('../helpers/mock-notion');

jest.mock('../../api/notion', () => require('../helpers/mock-notion'));
jest.mock('../../api/_audit', () => ({ logAudit: jest.fn(), clientIp: () => '127.0.0.1' }));

const { buildApp } = require('../helpers/test-app');
const jwt = require('jsonwebtoken');
const { SECRET } = require('../../middleware/auth');

const adminToken = () =>
  jwt.sign({ id: 'natalia', nombre: 'Natalia', role: 'admin', ejec: 'Natalia Gama' }, SECRET, { expiresIn: '1h' });
const ejecToken = (ejec) =>
  jwt.sign({ id: ejec.toLowerCase(), nombre: ejec, role: 'ejecutivo', ejec }, SECRET, { expiresIn: '1h' });

let app;
beforeEach(() => {
  mockNotion.resetStore();
  app = buildApp();
});

async function crear(ruta, body, token = adminToken()) {
  const res = await request(app).post(ruta).set('Authorization', `Bearer ${token}`).send(body);
  expect(res.status).toBe(200);
  return res.body;
}

describe('Casos — heredan acceso de la OP (o del cliente si no hay OP)', () => {
  test('un ejecutivo NO ve los casos de una OP donde no participa', async () => {
    const op = await crear('/api/ops', { numero: 'OP-CASO-1', ejec: 'Ximena' });
    const caso = await crear('/api/casos', { titulo: 'Queja', clienteId: op.clienteId || '', opId: op.id, tipo: 'Queja', status: 'Abierto' });

    const res = await request(app).get(`/api/casos/${caso.id}`).set('Authorization', `Bearer ${ejecToken('Alexia')}`);
    expect(res.status).toBe(403);
  });

  test('un ejecutivo SÍ ve el caso de su propia OP', async () => {
    const op = await crear('/api/ops', { numero: 'OP-CASO-2', ejec: 'Alexia' });
    const caso = await crear('/api/casos', { titulo: 'Cambio de fecha', opId: op.id, tipo: 'Cambio', status: 'Abierto' });

    const res = await request(app).get(`/api/casos/${caso.id}`).set('Authorization', `Bearer ${ejecToken('Alexia')}`);
    expect(res.status).toBe(200);
  });

  test('el listado filtra — el ejecutivo solo ve los casos donde participa', async () => {
    const opA = await crear('/api/ops', { numero: 'OP-CASO-A', ejec: 'Alexia' });
    const opX = await crear('/api/ops', { numero: 'OP-CASO-X', ejec: 'Ximena' });
    await crear('/api/casos', { titulo: 'De Alexia', opId: opA.id, tipo: 'Queja', status: 'Abierto' });
    await crear('/api/casos', { titulo: 'De Ximena', opId: opX.id, tipo: 'Queja', status: 'Abierto' });

    const res = await request(app).get('/api/casos').set('Authorization', `Bearer ${ejecToken('Alexia')}`);
    expect(res.status).toBe(200);
    expect(res.body.map(c => c.titulo)).toEqual(['De Alexia']);
  });

  test('un ejecutivo no puede crear un caso en una OP ajena (403)', async () => {
    const op = await crear('/api/ops', { numero: 'OP-CASO-3', ejec: 'Ximena' });
    const res = await request(app).post('/api/casos')
      .set('Authorization', `Bearer ${ejecToken('Alexia')}`)
      .send({ titulo: 'Intento ajeno', opId: op.id, tipo: 'Queja', status: 'Abierto' });
    expect(res.status).toBe(403);
  });

  test('un ejecutivo no puede editar un caso ajeno (403)', async () => {
    const op = await crear('/api/ops', { numero: 'OP-CASO-4', ejec: 'Ximena' });
    const caso = await crear('/api/casos', { titulo: 'Ajeno', opId: op.id, tipo: 'Queja', status: 'Abierto' });
    const res = await request(app).patch(`/api/casos/${caso.id}`)
      .set('Authorization', `Bearer ${ejecToken('Alexia')}`).send({ status: 'Cerrado' });
    expect(res.status).toBe(403);
  });

  test('admin (oficina total) ve y edita cualquier caso', async () => {
    const op = await crear('/api/ops', { numero: 'OP-CASO-5', ejec: 'Ximena' });
    const caso = await crear('/api/casos', { titulo: 'De cualquiera', opId: op.id, tipo: 'Queja', status: 'Abierto' });
    const res = await request(app).patch(`/api/casos/${caso.id}`)
      .set('Authorization', `Bearer ${adminToken()}`).send({ status: 'Cerrado' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Cerrado');
  });
});

describe('Tickets — heredan acceso de la Cotización a la que están ligados', () => {
  function postCot(token, fields) {
    const req = request(app).post('/api/cotizaciones').set('Authorization', `Bearer ${token}`);
    Object.entries(fields || {}).forEach(([k, v]) => req.field(k, String(v)));
    req.attach('pdf', Buffer.from('%PDF-1.4'), { filename: 'c.pdf', contentType: 'application/pdf' });
    return req;
  }

  test('un ejecutivo NO ve los tickets de una cotización donde no participa', async () => {
    const op = await crear('/api/ops', { numero: 'OP-TCK-1', ejec: 'Ximena' });
    const cot = await postCot(adminToken(), { cotId: 'COT-TCK-1', opId: op.id });
    expect(cot.status).toBe(200);
    const ticket = await crear('/api/tickets', { tipo: 'Descuento no autorizado', cotId: cot.body.id, status: 'Abierto' });

    const res = await request(app).get('/api/tickets').set('Authorization', `Bearer ${ejecToken('Alexia')}`);
    expect(res.status).toBe(200);
    expect(res.body.find(t => t.id === ticket.id)).toBeUndefined();
  });

  test('un ejecutivo SÍ ve el ticket de su propia cotización', async () => {
    const op = await crear('/api/ops', { numero: 'OP-TCK-2', ejec: 'Alexia' });
    const cot = await postCot(adminToken(), { cotId: 'COT-TCK-2', opId: op.id });
    await crear('/api/tickets', { tipo: 'Cambio de forma de pago', cotId: cot.body.id, status: 'Abierto' });

    const res = await request(app).get('/api/tickets').set('Authorization', `Bearer ${ejecToken('Alexia')}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
  });

  test('un ejecutivo no puede crear un ticket en una cotización ajena (403)', async () => {
    const op = await crear('/api/ops', { numero: 'OP-TCK-3', ejec: 'Ximena' });
    const cot = await postCot(adminToken(), { cotId: 'COT-TCK-3', opId: op.id });
    const res = await request(app).post('/api/tickets')
      .set('Authorization', `Bearer ${ejecToken('Alexia')}`)
      .send({ tipo: 'Intento ajeno', cotId: cot.body.id, status: 'Abierto' });
    expect(res.status).toBe(403);
  });

  test('un ejecutivo no puede editar un ticket ajeno (403)', async () => {
    const op = await crear('/api/ops', { numero: 'OP-TCK-4', ejec: 'Ximena' });
    const cot = await postCot(adminToken(), { cotId: 'COT-TCK-4', opId: op.id });
    const ticket = await crear('/api/tickets', { tipo: 'Ajeno', cotId: cot.body.id, status: 'Abierto' });
    const res = await request(app).patch(`/api/tickets/${ticket.id}`)
      .set('Authorization', `Bearer ${ejecToken('Alexia')}`).send({ status: 'Resuelto' });
    expect(res.status).toBe(403);
  });

  test('admin (oficina total) ve y edita cualquier ticket', async () => {
    const op = await crear('/api/ops', { numero: 'OP-TCK-5', ejec: 'Ximena' });
    const cot = await postCot(adminToken(), { cotId: 'COT-TCK-5', opId: op.id });
    const ticket = await crear('/api/tickets', { tipo: 'De cualquiera', cotId: cot.body.id, status: 'Abierto' });
    const res = await request(app).patch(`/api/tickets/${ticket.id}`)
      .set('Authorization', `Bearer ${adminToken()}`).send({ status: 'Resuelto' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Resuelto');
  });
});
