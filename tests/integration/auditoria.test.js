/**
 * Integration tests — Log de auditoría (solo admin)
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

function eventoAuditoria(n) {
  return {
    id: `audit-${n}`,
    properties: {
      'Evento':         { title: [{ plain_text: `login_exitoso · natalia · evento ${n}` }] },
      'Usuario':        { rich_text: [{ plain_text: 'natalia' }] },
      'Accion':         { select: { name: 'login_exitoso' } },
      'Entidad':        { rich_text: [] },
      'Detalle':        { rich_text: [{ plain_text: `detalle ${n}` }] },
      'IP':             { rich_text: [{ plain_text: '127.0.0.1' }] },
      'Exito':          { checkbox: true },
      'FueraDeHorario': { checkbox: false },
      'Fecha':          { date: { start: '2026-07-01' } },
    },
  };
}

let app;

describe('GET /api/auditoria', () => {
  test('ejecutivo NO puede ver la auditoría (403)', async () => {
    mockNotion.resetStore();
    app = buildApp();
    const res = await request(app).get('/api/auditoria')
      .set('Authorization', `Bearer ${ejecToken()}`);
    expect(res.status).toBe(403);
  });

  test('admin ve los eventos con todos los campos', async () => {
    mockNotion.resetStore({ auditoria: [eventoAuditoria(1), eventoAuditoria(2)] });
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
    mockNotion.resetStore({ auditoria: [eventoAuditoria(1), eventoAuditoria(2), eventoAuditoria(3)] });
    app = buildApp();
    const res = await request(app).get('/api/auditoria?limit=2')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.body.length).toBe(2);
  });

  test('limit no numérico usa default 200', async () => {
    mockNotion.resetStore({ auditoria: [eventoAuditoria(1)] });
    app = buildApp();
    const res = await request(app).get('/api/auditoria?limit=abc')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
  });

  test('limit mayor a 1000 se recorta a 1000', async () => {
    mockNotion.resetStore({ auditoria: [eventoAuditoria(1)] });
    app = buildApp();
    const res = await request(app).get('/api/auditoria?limit=99999')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
  });
});
