/**
 * Integration tests — Detalle (GET /:id), propiedad por ejecutivo y campos JSON
 * Cierra los huecos de cobertura de ops, prospectos, cotizaciones, pagos y backup.
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
const ejecToken = (ejec = 'Alexia') =>
  jwt.sign({ id: 'alexia', nombre: 'Alexia', role: 'ejecutivo', ejec }, SECRET, { expiresIn: '1h' });

let app;
beforeEach(() => {
  mockNotion.resetStore();
  app = buildApp();
});

async function crear(ruta, body) {
  const res = await request(app).post(ruta).set('Authorization', `Bearer ${adminToken()}`).send(body);
  expect(res.status).toBe(200);
  return res.body;
}

describe('OPs — detalle y propiedad', () => {
  test('GET /:id devuelve la OP', async () => {
    const op = await crear('/api/ops', { numero: 'OP-9', desc: 'Evento', ejec: 'Natalia Gama', cotizado: 100 });
    const res = await request(app).get(`/api/ops/${op.id}`).set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.numero).toBe('OP-9');
    expect(res.body.cotizado).toBe(100);
  });

  test('un ejecutivo NO puede ver la OP de otro (403)', async () => {
    const op = await crear('/api/ops', { numero: 'OP-9', ejec: 'Natalia Gama' });
    const res = await request(app).get(`/api/ops/${op.id}`).set('Authorization', `Bearer ${ejecToken()}`);
    expect(res.status).toBe(403);
  });

  test('un ejecutivo SÍ ve su propia OP', async () => {
    const op = await crear('/api/ops', { numero: 'OP-A', ejec: 'Alexia' });
    const res = await request(app).get(`/api/ops/${op.id}`).set('Authorization', `Bearer ${ejecToken()}`);
    expect(res.status).toBe(200);
  });

  test('un ejecutivo no puede editar la OP de otro (403)', async () => {
    const op = await crear('/api/ops', { numero: 'OP-9', ejec: 'Natalia Gama' });
    const res = await request(app).patch(`/api/ops/${op.id}`)
      .set('Authorization', `Bearer ${ejecToken()}`).send({ status: 'Ejecutado' });
    expect(res.status).toBe(403);
  });

  test('al editar su OP, el campo ejec del ejecutivo se ignora (no puede reasignar)', async () => {
    const op = await crear('/api/ops', { numero: 'OP-A', ejec: 'Alexia' });
    const res = await request(app).patch(`/api/ops/${op.id}`)
      .set('Authorization', `Bearer ${ejecToken()}`).send({ status: 'Ejecutado', ejec: 'Otro' });
    expect(res.status).toBe(200);
    expect(res.body.ejec).toBe('Alexia');
  });

  test('acepta alias fecha → Fecha Evento', async () => {
    const op = await crear('/api/ops', { numero: 'OP-F', fecha: '2026-09-01' });
    expect(op.fechaEvento).toBe('2026-09-01');
  });
});

describe('Prospectos — detalle, propiedad y notas', () => {
  test('GET /:id devuelve el prospecto con notas parseadas', async () => {
    const pr = await crear('/api/prospectos', { empresa: 'Acme', ejec: 'Natalia Gama', notas: [{ t: 'hola' }] });
    const res = await request(app).get(`/api/prospectos/${pr.id}`).set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.notas).toEqual([{ t: 'hola' }]);
  });

  test('notas que no son array se guardan como lista vacía', async () => {
    const pr = await crear('/api/prospectos', { empresa: 'Acme', notas: 'no-es-array' });
    expect(pr.notas).toEqual([]);
  });

  test('un ejecutivo no ve prospectos ajenos (403) ni los borra', async () => {
    const pr = await crear('/api/prospectos', { empresa: 'Acme', ejec: 'Natalia Gama' });
    const res = await request(app).get(`/api/prospectos/${pr.id}`).set('Authorization', `Bearer ${ejecToken()}`);
    expect(res.status).toBe(403);
    const del = await request(app).delete(`/api/prospectos/${pr.id}`).set('Authorization', `Bearer ${ejecToken()}`);
    expect(del.status).toBe(403);
  });

  test('PATCH ignora los campos inmutables (empresa, contacto, tel, email, ejec)', async () => {
    const pr = await crear('/api/prospectos', { empresa: 'Original', contacto: 'Juan', ejec: 'Natalia Gama' });
    const res = await request(app).patch(`/api/prospectos/${pr.id}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ empresa: 'Hackeada', contacto: 'Otro', status: 'Calificado' });
    expect(res.status).toBe(200);
    expect(res.body.empresa).toBe('Original');
    expect(res.body.contacto).toBe('Juan');
    expect(res.body.status).toBe('Calificado');
  });

  test('DELETE como admin elimina el prospecto', async () => {
    const pr = await crear('/api/prospectos', { empresa: 'Borrar' });
    const del = await request(app).delete(`/api/prospectos/${pr.id}`).set('Authorization', `Bearer ${adminToken()}`);
    expect(del.status).toBe(200);
    const lista = await request(app).get('/api/prospectos').set('Authorization', `Bearer ${adminToken()}`);
    expect(lista.body.find(p => p.id === pr.id)).toBeUndefined();
  });
});

describe('Cotizaciones — detalle, secciones y aliases', () => {
  test('GET /:id devuelve la cotización con secciones', async () => {
    const cot = await crear('/api/cotizaciones', {
      cotId: 'COT-1', ejec: 'Natalia Gama',
      secciones: { audio: [{ item: 'Bocinas' }] },
    });
    const res = await request(app).get(`/api/cotizaciones/${cot.id}`).set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.secciones.audio).toEqual([{ item: 'Bocinas' }]);
    expect(res.body.secciones.catering).toEqual([]); // defaults completados
  });

  test('acepta aliases fee → Fee % y total → Total con IVA', async () => {
    const cot = await crear('/api/cotizaciones', { idCot: 'COT-2', fee: 10, total: 116000 });
    expect(cot.cotId).toBe('COT-2');
    expect(cot.feePct).toBe(10);
    expect(cot.totalConIva).toBe(116000);
  });

  test('un ejecutivo no ve ni edita cotizaciones ajenas (403)', async () => {
    const cot = await crear('/api/cotizaciones', { cotId: 'COT-3', ejec: 'Natalia Gama' });
    const get = await request(app).get(`/api/cotizaciones/${cot.id}`).set('Authorization', `Bearer ${ejecToken()}`);
    expect(get.status).toBe(403);
    const patch = await request(app).patch(`/api/cotizaciones/${cot.id}`)
      .set('Authorization', `Bearer ${ejecToken()}`).send({ status: 'Aprobada' });
    expect(patch.status).toBe(403);
  });

  test('al crear, el ejecutivo queda como dueño aunque mande otro nombre', async () => {
    const res = await request(app).post('/api/cotizaciones')
      .set('Authorization', `Bearer ${ejecToken()}`)
      .send({ cotId: 'COT-4', ejec: 'Natalia Gama' });
    expect(res.status).toBe(200);
    expect(res.body.ejec).toBe('Alexia');
  });

  test('el ejecutivo puede editar la suya y el campo ejec se ignora', async () => {
    const creada = await request(app).post('/api/cotizaciones')
      .set('Authorization', `Bearer ${ejecToken()}`).send({ cotId: 'COT-5' });
    const patch = await request(app).patch(`/api/cotizaciones/${creada.body.id}`)
      .set('Authorization', `Bearer ${ejecToken()}`).send({ status: 'Aprobada', ejec: 'Otro' });
    expect(patch.status).toBe(200);
    expect(patch.body.ejec).toBe('Alexia');
    expect(patch.body.status).toBe('Aprobada');
  });
});

describe('Pagos — detalle', () => {
  test('GET /:id devuelve el pago completo', async () => {
    const pago = await crear('/api/pagos', {
      concepto: 'Anticipo', tipo: 'Cobro', monto: 100000,
      fechaAcordada: '2026-07-15', status: 'Pendiente', forma: 'SPEI', ref: 'REF-1', comprobante: true,
    });
    const res = await request(app).get(`/api/pagos/${pago.id}`).set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.concepto).toBe('Anticipo');
    expect(res.body.monto).toBe(100000);
    expect(res.body.comprobante).toBe(true);
  });
});

describe('Backup — POST /api/backup/export', () => {
  const fetchOriginal = global.fetch;
  afterEach(() => { global.fetch = fetchOriginal; });

  test('genera el respaldo y reporta el resultado del email', async () => {
    global.fetch = jest.fn(async () => ({ ok: true }));
    process.env.BACKUP_EMAIL_TO = 'ngama@actideacontinnuo.com';
    const res = await request(app).post('/api/backup/export')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.backup.entidades).toBeDefined();
    // El respaldo de usuarios nunca incluye hashes ni secretos 2FA
    const usuarios = res.body.backup.entidades.usuarios;
    expect(usuarios[0].properties.PasswordHash).toBeUndefined();
    expect(usuarios[0].properties.TwoFASecret).toBeUndefined();
  });

  test('si el envío del correo explota, responde 500 con error', async () => {
    global.fetch = jest.fn(async () => { throw new Error('Resend caído'); });
    process.env.BACKUP_EMAIL_TO = 'ngama@actideacontinnuo.com';
    const res = await request(app).post('/api/backup/export')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(500);
  });

  test('sin configuración de email, el respaldo igual se genera', async () => {
    const backupTo = process.env.BACKUP_EMAIL_TO;
    delete process.env.BACKUP_EMAIL_TO;
    const res = await request(app).post('/api/backup/export')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.emailResult.sent).toBe(false);
    if (backupTo) process.env.BACKUP_EMAIL_TO = backupTo;
  });

  test('un no-admin no puede generar respaldos (403)', async () => {
    const res = await request(app).post('/api/backup/export')
      .set('Authorization', `Bearer ${ejecToken()}`);
    expect(res.status).toBe(403);
  });
});
