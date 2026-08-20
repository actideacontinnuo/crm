/**
 * Integration tests — Cotizaciones (modelo SOLO archivos: PDF + Excel en Notion)
 * Cubre: alta con archivos, lectura de URLs, y el modelo de 3 roles HEREDADOS
 * de la OP (o del cliente si no hay OP) — Propietario/Ejec.cuenta/Ejec.asignado
 * nunca se capturan a mano, siempre se derivan en el servidor.
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
function ejecToken(nombre) {
  return jwt.sign({ id: nombre.toLowerCase(), nombre, role: 'ejecutivo', ejec: nombre }, SECRET, { expiresIn: '1h' });
}

const PDF  = Buffer.from('%PDF-1.4 contenido de prueba');
const XLSX = Buffer.from('PK excel de prueba');

function crearCot(token, { fields = {}, pdf = true, excel = true } = {}) {
  const req = request(app).post('/api/cotizaciones').set('Authorization', `Bearer ${token}`);
  Object.entries(fields).forEach(([k, v]) => req.field(k, String(v)));
  if (pdf)   req.attach('pdf',   PDF,  { filename: 'cotizacion.pdf', contentType: 'application/pdf' });
  if (excel) req.attach('excel', XLSX, { filename: 'costos.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  return req;
}

async function crearClienteYOp({ propietario = 'Natalia Gama' } = {}) {
  const cliente = await request(app).post('/api/clientes')
    .set('Authorization', `Bearer ${adminToken()}`)
    .send({
      nombre: 'Cliente Test', razon: 'Cliente Test SA', rfc: 'CTE130814368',
      dir: 'CDMX', contacto: 'Juan', cargo: 'Gerente', tel: '5500000000',
      email: 'juan@test.com', propietario, pago: '30 días', status: 'Activo',
    });
  const op = await request(app).post('/api/ops')
    .set('Authorization', `Bearer ${adminToken()}`)
    .send({
      desc: 'Evento Test', clienteId: cliente.body.id,
      propietario: cliente.body.propietario, ejecCuenta: cliente.body.ejecCuenta,
      ejecAsignado: cliente.body.ejecAsignado || propietario, ejec: cliente.body.ejecAsignado || propietario,
      fechaEvento: '2026-09-01', cotizado: 100000, status: 'Cotización',
    });
  return { cliente: cliente.body, op: op.body };
}

let app;
beforeEach(() => {
  mockNotion.resetStore();
  // Ximena y Alexia como ejecutivas reales del sistema — necesario para el
  // roster dinámico de comisiones (Regla 2). Natalia ya viene por defecto (admin).
  mockNotion.addEjecutivo('Ximena', 'ximena');
  mockNotion.addEjecutivo('Alexia', 'alexia-roster');
  require('../../api/_roles')._resetRosterCacheForTests();
  app = buildApp();
});

describe('POST /api/cotizaciones (archivos)', () => {
  test('crea cotización con PDF + Excel y devuelve sus URLs', async () => {
    const { op, cliente } = await crearClienteYOp();
    const res = await crearCot(adminToken(), { fields: { cotId: 'COT-2026-001', clienteId: cliente.id, opId: op.id } });
    expect([200, 201]).toContain(res.status);
    expect(res.body.cotId).toBe('COT-2026-001');
    expect(res.body.pdf.length).toBe(1);
    expect(res.body.pdf[0].url).toMatch(/^https?:\/\//);
    expect(res.body.excel.length).toBe(1);
  });

  test('acepta solo PDF (sin Excel)', async () => {
    const res = await crearCot(adminToken(), { fields: { cotId: 'COT-SOLO-PDF' }, excel: false });
    expect([200, 201]).toContain(res.status);
    expect(res.body.pdf.length).toBe(1);
    expect(res.body.excel.length).toBe(0);
  });

  test('rechaza cuando no se sube ningún archivo (400)', async () => {
    const res = await crearCot(adminToken(), { fields: { cotId: 'COT-VACIA' }, pdf: false, excel: false });
    expect(res.status).toBe(400);
  });

  test('rechaza un tipo de archivo no permitido (400)', async () => {
    const res = await request(app).post('/api/cotizaciones')
      .set('Authorization', `Bearer ${adminToken()}`)
      .attach('pdf', Buffer.from('texto'), { filename: 'nota.txt', contentType: 'text/plain' });
    expect(res.status).toBe(400);
  });
});

describe('Herencia de roles — desde la OP', () => {
  test('la cotización hereda Propietario/EjecCuenta/EjecAsignado de su OP', async () => {
    const { op } = await crearClienteYOp({ propietario: 'Ximena' });
    const res = await crearCot(adminToken(), { fields: { cotId: 'COT-1', opId: op.id, clienteId: op.clienteId } });
    expect(res.status).toBe(200);
    expect(res.body.propietario).toBe('Ximena');
    expect(res.body.ejecCuenta).toBe('Ximena'); // propietario=ejecCuenta siempre (regla confirmada)
  });

  test('sin OP pero con cliente, hereda del cliente directo', async () => {
    const { cliente } = await crearClienteYOp({ propietario: 'Alexia' });
    const res = await crearCot(adminToken(), { fields: { cotId: 'COT-2', clienteId: cliente.id } });
    expect(res.status).toBe(200);
    expect(res.body.propietario).toBe('Alexia');
  });

  test('lo que el cliente mande en propietario/ejecCuenta se IGNORA — siempre se hereda', async () => {
    const { op } = await crearClienteYOp({ propietario: 'Ximena' });
    const res = await crearCot(adminToken(), {
      fields: { cotId: 'COT-3', opId: op.id, clienteId: op.clienteId, propietario: 'Alguien Inventado', ejecCuenta: 'Otro Más' },
    });
    expect(res.status).toBe(200);
    expect(res.body.propietario).toBe('Ximena');
    expect(res.body.propietario).not.toBe('Alguien Inventado');
  });

  test('PATCH nunca puede cambiar los roles heredados, ni siquiera el admin', async () => {
    const { op } = await crearClienteYOp({ propietario: 'Alexia' });
    const creada = await crearCot(adminToken(), { fields: { cotId: 'COT-4', opId: op.id, clienteId: op.clienteId } });
    const patch = await request(app).patch(`/api/cotizaciones/${creada.body.id}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .field('status', 'Aprobada').field('propietario', 'Cambiado');
    expect(patch.status).toBe(200);
    expect(patch.body.propietario).toBe('Alexia');
    expect(patch.body.status).toBe('Aprobada');
  });
});

describe('Acceso por fila — igual que Prospectos/Clientes/OPs', () => {
  test('un ejecutivo NO puede subir cotización a un cliente/OP donde no participa (403)', async () => {
    const { op } = await crearClienteYOp({ propietario: 'Ximena' });
    const res = await crearCot(ejecToken('Alexia'), { fields: { cotId: 'COT-5', opId: op.id, clienteId: op.clienteId } });
    expect(res.status).toBe(403);
  });

  test('el ejecutivo SÍ puede subir cotización a su propia OP', async () => {
    const { op } = await crearClienteYOp({ propietario: 'Alexia' });
    const res = await crearCot(ejecToken('Alexia'), { fields: { cotId: 'COT-6', opId: op.id, clienteId: op.clienteId } });
    expect(res.status).toBe(200);
  });

  test('ejecutivo solo ve las cotizaciones donde participa', async () => {
    const { op: opAlexia } = await crearClienteYOp({ propietario: 'Alexia' });
    const { op: opXimena } = await crearClienteYOp({ propietario: 'Ximena' });
    await crearCot(adminToken(), { fields: { cotId: 'COT-ALE', opId: opAlexia.id, clienteId: opAlexia.clienteId } });
    await crearCot(adminToken(), { fields: { cotId: 'COT-XIM', opId: opXimena.id, clienteId: opXimena.clienteId } });

    const res = await request(app).get('/api/cotizaciones').set('Authorization', `Bearer ${ejecToken('Alexia')}`);
    expect(res.status).toBe(200);
    expect(res.body.map(c => c.cotId)).toEqual(['COT-ALE']);
  });

  test('un ejecutivo no ve ni edita cotizaciones ajenas (403)', async () => {
    const { op } = await crearClienteYOp({ propietario: 'Ximena' });
    const cot = await crearCot(adminToken(), { fields: { cotId: 'COT-7', opId: op.id, clienteId: op.clienteId } });
    const get = await request(app).get(`/api/cotizaciones/${cot.body.id}`).set('Authorization', `Bearer ${ejecToken('Alexia')}`);
    expect(get.status).toBe(403);
    const patch = await request(app).patch(`/api/cotizaciones/${cot.body.id}`)
      .set('Authorization', `Bearer ${ejecToken('Alexia')}`).field('status', 'Aprobada');
    expect(patch.status).toBe(403);
  });

  test('admin (oficina total) puede subir y editar cualquier cotización', async () => {
    const { op } = await crearClienteYOp({ propietario: 'Ximena' });
    const creada = await crearCot(adminToken(), { fields: { cotId: 'COT-8', opId: op.id, clienteId: op.clienteId } });
    expect(creada.status).toBe(200);
    const res = await request(app).patch(`/api/cotizaciones/${creada.body.id}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .field('status', 'Aprobada');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Aprobada');
  });
});
