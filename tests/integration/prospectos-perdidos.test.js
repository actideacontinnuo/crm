/**
 * Integration tests — Cierre de prospectos como PERDIDOS (con motivo) y reapertura
 */
const request = require('supertest');
const mockDb  = require('../helpers/mock-db');

jest.mock('../../api/db', () => require('../helpers/mock-db'));
jest.mock('../../api/_audit', () => ({ logAudit: jest.fn(), clientIp: () => '127.0.0.1' }));

const { buildApp } = require('../helpers/test-app');
const { logAudit: mockAudit } = require('../../api/_audit');
const jwt = require('jsonwebtoken');
const { SECRET } = require('../../middleware/auth');

const tok = (id, nombre, role, ejec) => jwt.sign({ id, nombre, role, ejec }, SECRET, { expiresIn: '1h' });
const admin  = () => tok('natalia', 'Natalia', 'admin', 'Natalia Gama');
const alexia = () => tok('alexia', 'Alexia', 'ejecutivo', 'Alexia');
const ximena = () => tok('ximena', 'Ximena', 'ejecutivo', 'Ximena');

let app;
beforeEach(() => {
  mockAudit.mockClear();
  mockDb.resetStore();
  mockDb.addEjecutivo('Ximena', 'ximena');
  mockDb.addEjecutivo('Alexia', 'alexia-roster');
  require('../../api/_roles')._resetRosterCacheForTests();
  app = buildApp();
});

async function crear(propietario = 'Alexia', extra = {}) {
  const r = await request(app).post('/api/prospectos').set('Authorization', `Bearer ${admin()}`)
    .send({ empresa: 'Empresa ' + Math.random(), contacto: 'X', propietario, status: 'Contactado', ...extra });
  return r.body;
}
const perder = (id, body, token = admin()) => request(app).post(`/api/prospectos/${id}/perder`).set('Authorization', `Bearer ${token}`).send(body);

describe('POST /:id/perder', () => {
  test('cierra el prospecto con motivo: status Perdido, fecha de cierre y nota automática', async () => {
    const p = await crear();
    const r = await perder(p.id, { motivo: 'Precio', detalle: 'Les pareció caro' });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('Perdido');
    expect(r.body.motivoPerdida).toBe('Precio');
    expect(r.body.detallePerdida).toBe('Les pareció caro');
    expect(r.body.fechaCierre).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.body.notas.at(-1)).toMatch(/PERDIDO \(Precio\): Les pareció caro/);
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ accion: 'prospecto_perdido', detalle: 'Precio' }));
  });

  test('el detalle es opcional salvo en "Otro"', async () => {
    const p = await crear();
    expect((await perder(p.id, { motivo: 'Dejó de responder' })).status).toBe(200);
    const q = await crear();
    const sinDetalle = await perder(q.id, { motivo: 'Otro' });
    expect(sinDetalle.status).toBe(400);
    expect(sinDetalle.body.error).toMatch(/Otro/);
    expect((await perder(q.id, { motivo: 'Otro', detalle: 'Cambió de giro' })).status).toBe(200);
  });

  test('motivo ausente o inventado → 400', async () => {
    const p = await crear();
    expect((await perder(p.id, {})).status).toBe(400);
    expect((await perder(p.id, { motivo: 'Porque sí' })).status).toBe(400);
  });

  test('no se puede cerrar dos veces ni cerrar un prospecto ya convertido', async () => {
    const p = await crear();
    await perder(p.id, { motivo: 'Precio' });
    expect((await perder(p.id, { motivo: 'Precio' })).status).toBe(400);
    const c = await crear();
    await request(app).patch(`/api/prospectos/${c.id}`).set('Authorization', `Bearer ${admin()}`).send({ status: 'Convertido' });
    const r = await perder(c.id, { motivo: 'Precio' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/convirtió/);
  });

  test('un ejecutivo cierra los suyos, pero NO los ajenos (403)', async () => {
    const p = await crear('Alexia');
    expect((await perder(p.id, { motivo: 'Precio' }, ximena())).status).toBe(403);
    expect((await perder(p.id, { motivo: 'Precio' }, alexia())).status).toBe(200);
  });

  test('id inexistente → 404', async () => {
    expect((await perder('no-existe', { motivo: 'Precio' })).status).toBe(404);
  });
});

describe('PATCH no puede saltarse el motivo ni reabrir por accidente', () => {
  test('PATCH status=Perdido sin pasar por /perder → 400', async () => {
    const p = await crear();
    const r = await request(app).patch(`/api/prospectos/${p.id}`).set('Authorization', `Bearer ${admin()}`).send({ status: 'Perdido' });
    expect(r.status).toBe(400);
  });

  test('editar un perdido (ej. desde el formulario) conserva Perdido y su motivo', async () => {
    const p = await crear();
    await perder(p.id, { motivo: 'Precio' });
    const r = await request(app).patch(`/api/prospectos/${p.id}`).set('Authorization', `Bearer ${admin()}`)
      .send({ status: 'Nuevo', evento: 'Otro evento', motivoPerdida: 'Hack' });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('Perdido');
    expect(r.body.motivoPerdida).toBe('Precio');
    expect(r.body.evento).toBe('Otro evento');
  });
});

describe('POST /:id/reabrir', () => {
  test('reabre: vuelve a Nuevo, limpia el motivo y deja nota', async () => {
    const p = await crear();
    await perder(p.id, { motivo: 'Precio' });
    const r = await request(app).post(`/api/prospectos/${p.id}/reabrir`).set('Authorization', `Bearer ${admin()}`);
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('Nuevo');
    expect(r.body.motivoPerdida).toBeNull();
    expect(r.body.fechaCierre).toBeNull();
    expect(r.body.notas.at(-1)).toMatch(/Reabierto/);
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ accion: 'prospecto_reabierto' }));
  });

  test('solo se reabren los perdidos (400) y respeta permisos (403)', async () => {
    const p = await crear('Alexia');
    expect((await request(app).post(`/api/prospectos/${p.id}/reabrir`).set('Authorization', `Bearer ${admin()}`)).status).toBe(400);
    await perder(p.id, { motivo: 'Precio' });
    expect((await request(app).post(`/api/prospectos/${p.id}/reabrir`).set('Authorization', `Bearer ${ximena()}`)).status).toBe(403);
  });
});

describe('GET /motivos-perdida', () => {
  test('devuelve el catálogo cerrado de motivos', async () => {
    const r = await request(app).get('/api/prospectos/motivos-perdida').set('Authorization', `Bearer ${alexia()}`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual(expect.arrayContaining(['Precio', 'Eligió a la competencia', 'Otro']));
  });
});
