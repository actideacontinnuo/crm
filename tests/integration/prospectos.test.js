/**
 * Integration tests — CRUD de Prospectos
 * Cubre: creación, lectura, edición, campos inmutables, control de roles
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

const PROSPECTO_VALIDO = {
  empresa:  'TechCorp SA',
  contacto: 'Juan Pérez',
  tel:      '5512345678',
  email:    'juan@techcorp.com',
  cargo:    'Director',
  evento:   'Congreso anual',
  estimado: 80000,
  ejec:     'Natalia Gama',
  fuente:   'Referido',
  status:   'Nuevo',
};

// ── Creación ──────────────────────────────────────────────
describe('POST /api/prospectos', () => {
  test('admin puede crear prospecto', async () => {
    const res = await request(app).post('/api/prospectos')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(PROSPECTO_VALIDO);
    expect([200, 201]).toContain(res.status);
    expect(res.body.id).toBeDefined();
    expect(res.body.empresa).toBe('TechCorp SA');
  });

  test('ejecutivo puede crear prospecto', async () => {
    const res = await request(app).post('/api/prospectos')
      .set('Authorization', `Bearer ${ejecToken()}`)
      .send(PROSPECTO_VALIDO);
    expect([200, 201]).toContain(res.status);
  });
});

// ── Lectura ───────────────────────────────────────────────
describe('GET /api/prospectos', () => {
  test('devuelve lista vacía inicialmente', async () => {
    const res = await request(app).get('/api/prospectos')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('devuelve prospecto recién creado', async () => {
    await request(app).post('/api/prospectos')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(PROSPECTO_VALIDO);

    const res = await request(app).get('/api/prospectos')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.body.length).toBe(1);
    expect(res.body[0].empresa).toBe('TechCorp SA');
  });
});

// ── Edición y campos inmutables ───────────────────────────
describe('PATCH /api/prospectos/:id — campos inmutables', () => {
  async function crearProspecto() {
    const res = await request(app).post('/api/prospectos')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(PROSPECTO_VALIDO);
    return res.body.id;
  }

  test('actualiza campo mutable (status)', async () => {
    const id = await crearProspecto();
    const res = await request(app).patch(`/api/prospectos/${id}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ status: 'Contactado' });
    expect(res.status).toBe(200);
  });

  test('NO permite cambiar empresa (campo inmutable)', async () => {
    const id = await crearProspecto();
    await request(app).patch(`/api/prospectos/${id}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ empresa: 'EMPRESA MANIPULADA', status: 'Contactado' });

    const lista = await request(app).get('/api/prospectos')
      .set('Authorization', `Bearer ${adminToken()}`);
    const p = lista.body.find(x => x.id === id);
    expect(p.empresa).toBe('TechCorp SA'); // sin cambio
  });

  test('NO permite cambiar email (campo inmutable)', async () => {
    const id = await crearProspecto();
    await request(app).patch(`/api/prospectos/${id}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ email: 'hackeado@evil.com' });

    const lista = await request(app).get('/api/prospectos')
      .set('Authorization', `Bearer ${adminToken()}`);
    const p = lista.body.find(x => x.id === id);
    expect(p.email).toBe('juan@techcorp.com'); // sin cambio
  });

  test('ejecutivo NO puede eliminar prospectos (403)', async () => {
    const id = await crearProspecto();
    const res = await request(app).delete(`/api/prospectos/${id}`)
      .set('Authorization', `Bearer ${ejecToken()}`);
    expect(res.status).toBe(403);
  });
});

// ── Seguridad: XSS en campos de texto ────────────────────
describe('Seguridad — XSS en prospectos', () => {
  test('guarda el string XSS como texto plano (no ejecuta)', async () => {
    const xssPayload = '<script>alert("xss")</script>';
    const res = await request(app).post('/api/prospectos')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ ...PROSPECTO_VALIDO, empresa: xssPayload });

    expect([200, 201]).toContain(res.status);
    // El backend debe guardarlo como texto; el escape XSS es responsabilidad del frontend
    expect(res.body.empresa).toBe(xssPayload);
  });
});
