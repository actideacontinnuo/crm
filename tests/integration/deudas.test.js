/**
 * Integration tests — Deudas (solo admin)
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

const DEUDA_VALIDA = {
  concepto: 'Renta de mobiliario',
  provId:   'prov-123',
  opId:     'op-456',
  monto:    45000,
  fecha:    '2026-07-20',
  status:   'Pendiente',
};

describe('Control de acceso', () => {
  test('ejecutivo NO puede ver deudas (403)', async () => {
    const res = await request(app).get('/api/deudas')
      .set('Authorization', `Bearer ${ejecToken()}`);
    expect(res.status).toBe(403);
  });

  test('admin puede listar deudas', async () => {
    const res = await request(app).get('/api/deudas')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('CRUD de deudas (admin)', () => {
  test('crear deuda y leerla de vuelta', async () => {
    const res = await request(app).post('/api/deudas')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(DEUDA_VALIDA);
    expect([200, 201]).toContain(res.status);
    expect(res.body.concepto).toBe('Renta de mobiliario');
    expect(res.body.monto).toBe(45000);

    const lista = await request(app).get('/api/deudas')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(lista.body.length).toBe(1);
  });

  test('la fecha enviada como fechaAcordada (frontend) se persiste y regresa', async () => {
    const res = await request(app).post('/api/deudas')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ concepto: 'Audio', provId: 'p1', opId: 'o1', monto: 1000, fechaAcordada: '2026-08-15', status: 'pendiente' });
    expect([200, 201]).toContain(res.status);
    expect(res.body.fechaAcordada).toBe('2026-08-15');
    expect(res.body.fecha).toBe('2026-08-15'); // alias legado también disponible
  });

  test('una deuda nueva SIEMPRE arranca pendiente, Pagado=0 — sin importar qué status mande el cliente', async () => {
    const res = await request(app).post('/api/deudas')
      .set('Authorization', `Bearer ${adminToken()}`).send({ ...DEUDA_VALIDA, status: 'pagado' });
    expect(res.body.status).toBe('pendiente');
    expect(res.body.pagado).toBe(0);
    expect(res.body.pagadoConIva).toBe(0);
    expect(res.body.debemos).toBe(45000);
  });

  test('PATCH ya NO acepta "status" directo — el status siempre se deriva de Pagado vs Cotización, nunca se fuerza a mano', async () => {
    const creada = await request(app).post('/api/deudas')
      .set('Authorization', `Bearer ${adminToken()}`).send(DEUDA_VALIDA);
    const res = await request(app).patch(`/api/deudas/${creada.body.id}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ status: 'pagado' }); // se ignora — no hay 'Status' en toProps
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pendiente'); // sigue pendiente, no se coló el status forzado
  });

  test('PATCH con id inexistente → 500 controlado', async () => {
    const res = await request(app).patch('/api/deudas/no-existe')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ concepto: 'x' });
    expect(res.status).toBe(500);
  });
});

describe('POST /:id/abonar — la ÚNICA forma correcta de registrar un pago a proveedor', () => {
  async function crearDeudaConIva(app, montoConIva) {
    const res = await request(app).post('/api/deudas')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ concepto: 'Audio y video', provId: 'prov-1', opId: 'op-1', montoConIva });
    return res.body;
  }

  test('BUG REAL CORREGIDO: dos abonos parciales a la misma deuda NUNCA crean un segundo registro', async () => {
    const deuda = await crearDeudaConIva(app, 50000); // como el ejemplo real: Actidea debe 50,000

    await request(app).post(`/api/deudas/${deuda.id}/abonar`)
      .set('Authorization', `Bearer ${adminToken()}`).send({ montoConIva: 20000 });
    await request(app).post(`/api/deudas/${deuda.id}/abonar`)
      .set('Authorization', `Bearer ${adminToken()}`).send({ montoConIva: 15000 });

    const lista = await request(app).get('/api/deudas').set('Authorization', `Bearer ${adminToken()}`);
    // Sigue habiendo UN solo registro de esta deuda — no dos, no tres.
    expect(lista.body.filter(d => d.concepto === 'Audio y video')).toHaveLength(1);

    const actualizada = lista.body[0];
    expect(actualizada.pagadoConIva).toBe(35000);
    expect(actualizada.debemosConIva).toBe(15000);
    expect(actualizada.status).toBe('parcial');
    // La COTIZACIÓN (lo que cuenta para la Utilidad) NUNCA se mueve al abonar.
    expect(actualizada.montoConIva).toBe(50000);
  });

  test('el status pasa de pendiente → parcial → pagado según se va abonando', async () => {
    const deuda = await crearDeudaConIva(app, 11600); // 11600/1.16 = 10000 neto

    let r = await request(app).get('/api/deudas').set('Authorization', `Bearer ${adminToken()}`);
    expect(r.body[0].status).toBe('pendiente');

    await request(app).post(`/api/deudas/${deuda.id}/abonar`)
      .set('Authorization', `Bearer ${adminToken()}`).send({ montoConIva: 5000 });
    r = await request(app).get('/api/deudas').set('Authorization', `Bearer ${adminToken()}`);
    expect(r.body[0].status).toBe('parcial');

    await request(app).post(`/api/deudas/${deuda.id}/abonar`)
      .set('Authorization', `Bearer ${adminToken()}`).send({ montoConIva: 6600 });
    r = await request(app).get('/api/deudas').set('Authorization', `Bearer ${adminToken()}`);
    expect(r.body[0].status).toBe('pagado');
    expect(r.body[0].debemosConIva).toBe(0);
  });

  test('la Utilidad (Monto neto) nunca cambia al abonar — solo Pagado cambia', async () => {
    const deuda = await crearDeudaConIva(app, 11600);
    await request(app).post(`/api/deudas/${deuda.id}/abonar`)
      .set('Authorization', `Bearer ${adminToken()}`).send({ montoConIva: 11600 });
    const r = await request(app).get('/api/deudas').set('Authorization', `Bearer ${adminToken()}`);
    expect(r.body[0].monto).toBe(10000);     // cotización neta, sin cambio
    expect(r.body[0].pagado).toBe(10000);    // abonado neto, ahora igual (pagado completo)
  });

  test('no se puede abonar más de lo cotizado (evita un "debemos" negativo)', async () => {
    const deuda = await crearDeudaConIva(app, 10000);
    const res = await request(app).post(`/api/deudas/${deuda.id}/abonar`)
      .set('Authorization', `Bearer ${adminToken()}`).send({ montoConIva: 15000 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/por encima de lo cotizado/i);
  });

  test('un abono de $0 o negativo se rechaza', async () => {
    const deuda = await crearDeudaConIva(app, 10000);
    const res = await request(app).post(`/api/deudas/${deuda.id}/abonar`)
      .set('Authorization', `Bearer ${adminToken()}`).send({ montoConIva: 0 });
    expect(res.status).toBe(400);
  });
});

describe('Captura CON IVA — el servidor deriva el neto (÷1.16)', () => {
  test('montoConIva=237249 → guarda montoConIva=237249 y monto neto=204525', async () => {
    const res = await request(app).post('/api/deudas')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ concepto: 'Producción', provId: 'p1', opId: 'o1', montoConIva: 237249, status: 'pendiente' });
    expect([200, 201]).toContain(res.status);
    expect(res.body.montoConIva).toBe(237249);
    // 237249 / 1.16 = 204525.00 exacto (el número real del Excel de Actidea)
    expect(res.body.monto).toBe(204525);
  });

  test('el neto es el que sirve para la utilidad (cotizado − neto), no el con IVA', async () => {
    const res = await request(app).post('/api/deudas')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ concepto: 'Audio', provId: 'p1', opId: 'o1', montoConIva: 11600, status: 'pendiente' });
    expect(res.body.montoConIva).toBe(11600);
    expect(res.body.monto).toBe(10000); // 11600 / 1.16
  });

  test('compatibilidad: si se manda monto directo (sin montoConIva) se respeta tal cual', async () => {
    const res = await request(app).post('/api/deudas')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ concepto: 'Legado', provId: 'p1', opId: 'o1', monto: 5000, status: 'pendiente' });
    expect(res.body.monto).toBe(5000);
    expect(res.body.montoConIva).toBeNull(); // no se inventa un con IVA
  });
});
