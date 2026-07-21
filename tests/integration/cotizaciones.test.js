/**
 * Integration tests — Cotizaciones (modelo SOLO archivos: PDF + Excel en Notion)
 * Cubre: alta con archivos, lectura de URLs, ownership.
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

const PDF   = Buffer.from('%PDF-1.4 contenido de prueba');
const XLSX  = Buffer.from('PK excel de prueba');

// Alta con multipart (campos + archivos)
function crearCot(token, { fields = {}, pdf = true, excel = true } = {}) {
  const req = request(app).post('/api/cotizaciones').set('Authorization', `Bearer ${token}`);
  Object.entries(fields).forEach(([k, v]) => req.field(k, String(v)));
  if (pdf)   req.attach('pdf',   PDF,  { filename: 'cotizacion.pdf', contentType: 'application/pdf' });
  if (excel) req.attach('excel', XLSX, { filename: 'costos.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  return req;
}

let app;
beforeEach(() => {
  mockNotion.resetStore();
  app = buildApp();
});

describe('POST /api/cotizaciones (archivos)', () => {
  test('crea cotización con PDF + Excel y devuelve sus URLs', async () => {
    const res = await crearCot(adminToken(), { fields: { cotId: 'COT-2026-001', clienteId: 'cliente-abc', ejec: 'Natalia Gama' } });
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

describe('Ownership de cotizaciones', () => {
  test('ejecutivo solo ve sus cotizaciones', async () => {
    await crearCot(adminToken(), { fields: { cotId: 'COT-NAT' } });
    await crearCot(ejecToken('Alexia'), { fields: { cotId: 'COT-ALE' } });

    const res = await request(app).get('/api/cotizaciones')
      .set('Authorization', `Bearer ${ejecToken('Alexia')}`);
    expect(res.status).toBe(200);
    expect(res.body.every(c => c.ejec === 'Alexia')).toBe(true);
  });

  test('ejecutivo NO puede editar cotización ajena (403)', async () => {
    const creada = await crearCot(adminToken(), { fields: { cotId: 'COT-NAT' } });
    const res = await request(app).patch(`/api/cotizaciones/${creada.body.id}`)
      .set('Authorization', `Bearer ${ejecToken('Alexia')}`)
      .field('status', 'Aprobada');
    expect(res.status).toBe(403);
  });

  test('admin puede editar cualquier cotización (metadatos sin archivo)', async () => {
    const creada = await crearCot(ejecToken('Alexia'), { fields: { cotId: 'COT-ALE' } });
    const res = await request(app).patch(`/api/cotizaciones/${creada.body.id}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .field('status', 'Aprobada');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Aprobada');
  });
});
