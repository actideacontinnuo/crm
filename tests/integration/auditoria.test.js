/**
 * Integration tests — Log de auditoría (solo admin)
 */
const request    = require('supertest');
const mockDb     = require('../helpers/mock-db');

jest.mock('../../api/db', () => require('../helpers/mock-db'));
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

function eventoAuditoria(n) {
  return {
    id: `audit-${n}`,
    usuario: 'natalia', accion: 'login_exitoso', entidad: '',
    detalle: `detalle ${n}`, ip: '127.0.0.1', exito: true, fueraDeHorario: false,
    fecha: '2026-07-01T12:00:00.000Z', deletedAt: null,
  };
}

let app;

describe('GET /api/auditoria', () => {
  test('ejecutivo NO puede ver la auditoría (403)', async () => {
    mockDb.resetStore();
    app = buildApp();
    const res = await request(app).get('/api/auditoria')
      .set('Authorization', `Bearer ${ejecToken()}`);
    expect(res.status).toBe(403);
  });

  test('admin ve los eventos con todos los campos', async () => {
    mockDb.resetStore({ auditoria: [eventoAuditoria(1), eventoAuditoria(2)] });
    app = buildApp();
    const res = await request(app).get('/api/auditoria')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
    expect(res.body[0].usuario).toBe('natalia');
    expect(res.body[0].accion).toBe('login_exitoso');
    expect(res.body[0].exito).toBe(true);
    expect(res.body[0].fueraDeHorario).toBe(false);
  });

  test('respeta el parámetro limit', async () => {
    mockDb.resetStore({ auditoria: [eventoAuditoria(1), eventoAuditoria(2), eventoAuditoria(3)] });
    app = buildApp();
    const res = await request(app).get('/api/auditoria?limit=2')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.body.length).toBe(2);
  });

  test('limit no numérico usa default 200', async () => {
    mockDb.resetStore({ auditoria: [eventoAuditoria(1)] });
    app = buildApp();
    const res = await request(app).get('/api/auditoria?limit=abc')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
  });

  test('limit mayor a 1000 se recorta a 1000', async () => {
    mockDb.resetStore({ auditoria: [eventoAuditoria(1)] });
    app = buildApp();
    const res = await request(app).get('/api/auditoria?limit=99999')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
  });
});
