/**
 * Simulación end-to-end: Cliente → OP → Proveedores → cerrar OP, 3 escenarios
 * pedidos explícitamente por el usuario para confirmar el comportamiento
 * correcto de Estado de Resultados y Dashboard tras el fix de duplicación de
 * pagos a proveedor. Corre contra el MISMO código real de producción
 * (api/clientes.js, api/ops.js, api/deudas.js, api/pagos.js) — solo la base de datos
 * está simulado en memoria (ver tests/helpers/mock-db.js), para no tocar
 * el workspace real (que además está al límite de su plan gratuito — ver
 * conversación: "This workspace has used all of its free blocks").
 */
const request    = require('supertest');
const mockDb     = require('../helpers/mock-db');

jest.mock('../../api/db', () => require('../helpers/mock-db'));
jest.mock('../../api/_audit', () => ({ logAudit: jest.fn(), clientIp: () => '127.0.0.1' }));

const { buildApp } = require('../helpers/test-app');
const jwt = require('jsonwebtoken');
const { SECRET } = require('../../middleware/auth');

const adminToken = () => jwt.sign({ id: 'natalia', nombre: 'Natalia', role: 'admin', ejec: 'Natalia Gama' }, SECRET, { expiresIn: '1h' });

let app;
beforeEach(() => {

  mockDb.resetStore();
  app = buildApp();
});

function netoSinIva(totalConIva) { return Math.round((totalConIva / 1.16) * 100) / 100; }

async function post(path, body) {
  const res = await request(app).post(path).set('Authorization', `Bearer ${adminToken()}`).send(body);
  if (res.status >= 300) throw new Error(`POST ${path} → ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body;
}
async function patch(path, body) {
  const res = await request(app).patch(path).set('Authorization', `Bearer ${adminToken()}`).send(body);
  if (res.status >= 300) throw new Error(`PATCH ${path} → ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body;
}
async function get(path) {
  const res = await request(app).get(path).set('Authorization', `Bearer ${adminToken()}`);
  if (res.status >= 300) throw new Error(`GET ${path} → ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body;
}

describe('SIMULACIÓN 1 — Cliente → OP → un proveedor, pago completo, cobro completo, sin extras, cerrar OP', () => {
  test('Dashboard/EdR reflejan los números correctos en cada paso', async () => {
    const cli = await post('/api/clientes', { nombre: 'PRUEBA QA 1 SA', propietario: 'Natalia Gama' });
    const op  = await post('/api/ops', { desc: 'Evento simulado 1', clienteId: cli.id, fechaEvento: '2026-09-15', cotizado: netoSinIva(116000) });
    expect(op.cotizado).toBe(100000);
    expect(op.utilidad).toBe(100000); // sin costos aún

    const prov  = await post('/api/proveedores', { nombre: 'PRUEBA QA Proveedor Audio' });
    const deuda = await post('/api/deudas', { provId: prov.id, opId: op.id, concepto: 'Audio y video', montoConIva: 46400 });
    expect(deuda.monto).toBe(40000);           // neto
    expect(deuda.debemosConIva).toBe(46400);   // aún no se paga nada

    let opGet = await get(`/api/ops/${op.id}`);
    expect(opGet.utilidad).toBe(60000); // 100,000 − 40,000

    const abono = await post(`/api/deudas/${deuda.id}/abonar`, { montoConIva: 46400 });
    expect(abono.status).toBe('pagado');
    expect(abono.debemosConIva).toBe(0);

    opGet = await get(`/api/ops/${op.id}`);
    expect(opGet.utilidad).toBe(60000); // pagar al proveedor NO mueve la utilidad

    await post('/api/pagos', {
      tipo: 'Cobro a cliente', concepto: 'Liquidación evento', opId: op.id, monto: 116000,
      fechaAcordada: '2026-09-15', fechaReal: '2026-09-15', status: 'Pagado', forma: 'SPEI', ref: '', comprobante: false,
    });
    opGet = await get(`/api/ops/${op.id}`);
    expect(opGet.cobrado).toBe(116000); // Dashboard: "cobrado" real de esta OP

    const cerrada = await patch(`/api/ops/${op.id}`, { status: 'Ejecutado' });
    expect(cerrada.status).toBe('Ejecutado');
    expect(cerrada.utilidad).toBe(60000);

    const deudasOP = (await get('/api/deudas')).filter(d => d.opId === op.id);
    expect(deudasOP).toHaveLength(1); // sin duplicados
  });
});

describe('SIMULACIÓN 2 — pagos PARCIALES a proveedor (re-prueba directa del bug de duplicación) + cobro parcial', () => {
  test('la Utilidad nunca se mueve por pagar, y nunca se duplica el registro de deuda', async () => {
    const cli = await post('/api/clientes', { nombre: 'PRUEBA QA 2 SA', propietario: 'Natalia Gama' });
    const op  = await post('/api/ops', { desc: 'Evento simulado 2', clienteId: cli.id, fechaEvento: '2026-09-15', cotizado: netoSinIva(58000) });
    expect(op.cotizado).toBe(50000);

    const prov  = await post('/api/proveedores', { nombre: 'PRUEBA QA Proveedor Mobiliario' });
    const deuda = await post('/api/deudas', { provId: prov.id, opId: op.id, concepto: 'Mobiliario', montoConIva: 23200 });

    const a1 = await post(`/api/deudas/${deuda.id}/abonar`, { montoConIva: 10000 });
    expect(a1.status).toBe('parcial');
    expect(a1.debemosConIva).toBe(13200);

    const a2 = await post(`/api/deudas/${deuda.id}/abonar`, { montoConIva: 13200 });
    expect(a2.status).toBe('pagado');
    expect(a2.debemosConIva).toBe(0);

    const deudasOP = (await get('/api/deudas')).filter(d => d.opId === op.id);
    expect(deudasOP).toHaveLength(1); // BUG REAL: antes esto habría creado 3 registros
    expect(deudasOP[0].montoConIva).toBe(23200); // la cotización nunca se movió

    let opGet = await get(`/api/ops/${op.id}`);
    expect(opGet.utilidad).toBe(30000); // 50,000 − 20,000, sin importar cuántos abonos hubo

    // Cobro parcial: uno Pagado, otro Pendiente.
    await post('/api/pagos', { tipo: 'Cobro a cliente', concepto: 'Anticipo 50%', opId: op.id, monto: 30000, fechaAcordada: '2026-09-15', fechaReal: '2026-09-15', status: 'Pagado', forma: 'SPEI', ref: '', comprobante: false });
    await post('/api/pagos', { tipo: 'Cobro a cliente', concepto: 'Liquidación', opId: op.id, monto: 28000, fechaAcordada: '2026-09-15', fechaReal: '', status: 'Pendiente', forma: 'SPEI', ref: '', comprobante: false });

    opGet = await get(`/api/ops/${op.id}`);
    expect(opGet.cobrado).toBe(30000); // solo el Pagado cuenta, NO 58,000
    expect(opGet.utilidad).toBe(30000); // el cobro parcial tampoco mueve la utilidad

    await patch(`/api/ops/${op.id}`, { status: 'Ejecutado' });
  });
});

describe('SIMULACIÓN 3 — múltiples proveedores + Extra + comisión 15% + cierre (réplica del caso real ACUERDOS 2026)', () => {
  test('el Estado de Resultados cuadra exacto: Pago Cliente/Extras/Utilidad/Comisión', async () => {
    const cli = await post('/api/clientes', { nombre: 'PRUEBA QA 3 SA', propietario: 'Natalia Gama' });
    const op  = await post('/api/ops', { desc: 'Evento simulado 3', clienteId: cli.id, fechaEvento: '2026-09-15', cotizado: netoSinIva(232000) });
    expect(op.cotizado).toBe(200000);
    expect(op.comision).toBe(15); // Regla 2 — propietario es ejecutivo real

    const provA  = await post('/api/proveedores', { nombre: 'PRUEBA QA Proveedor A' });
    const provB  = await post('/api/proveedores', { nombre: 'PRUEBA QA Proveedor B' });
    const deudaA = await post('/api/deudas', { provId: provA.id, opId: op.id, concepto: 'Producción A', montoConIva: 58000 });
    const deudaB = await post('/api/deudas', { provId: provB.id, opId: op.id, concepto: 'Producción B', montoConIva: 23200 });

    await post(`/api/deudas/${deudaA.id}/abonar`, { montoConIva: 29000 });
    const abA2 = await post(`/api/deudas/${deudaA.id}/abonar`, { montoConIva: 29000 });
    expect(abA2.debemosConIva).toBe(0);

    const deudasCheck = await get('/api/deudas');
    const dB = deudasCheck.find(d => d.id === deudaB.id);
    expect(dB.debemosConIva).toBe(23200); // los abonos de A NO tocaron a B
    expect(dB.status).toBe('pendiente');

    let opGet = await get(`/api/ops/${op.id}`);
    expect(opGet.utilidad).toBe(130000); // 200,000 − (50,000+20,000)

    await post('/api/pagos', { tipo: 'Cobro a cliente', concepto: 'Liquidación evento', opId: op.id, monto: 232000, fechaAcordada: '2026-09-15', fechaReal: '2026-09-15', status: 'Pagado', forma: 'SPEI', ref: '', comprobante: false, extra: false });
    await post('/api/pagos', { tipo: 'Cobro a cliente', concepto: 'Extra: renta de equipo adicional', opId: op.id, monto: 11600, fechaAcordada: '2026-09-15', fechaReal: '2026-09-15', status: 'Pagado', forma: 'SPEI', ref: '', comprobante: false, extra: true });

    opGet = await get(`/api/ops/${op.id}`);
    expect(opGet.cobrado).toBe(243600);  // 232,000 + 11,600 (incluye el extra)
    expect(opGet.utilidad).toBe(130000); // el extra NO mueve la utilidad

    const pagosOP = (await get('/api/pagos')).filter(p => p.opId === op.id && p.status === 'Pagado' && p.tipo === 'Cobro a cliente');
    const pagoCliente = pagosOP.filter(p => !p.extra).reduce((a, p) => a + p.monto, 0);
    const extras      = pagosOP.filter(p => p.extra).reduce((a, p) => a + p.monto, 0);
    expect(pagoCliente).toBe(232000);
    expect(extras).toBe(11600);

    const comisionMonto = opGet.utilidad * (opGet.comision / 100);
    expect(comisionMonto).toBe(19500);
    expect(opGet.utilidad - comisionMonto).toBe(110500); // utilidad después de comisión

    const cerrada = await patch(`/api/ops/${op.id}`, { status: 'Ejecutado' });
    expect(cerrada.status).toBe('Ejecutado');
    expect(cerrada.utilidad).toBe(130000);

    const deudasFinal = (await get('/api/deudas')).filter(d => d.opId === op.id);
    expect(deudasFinal).toHaveLength(2); // A y B, sin duplicados
  });
});
