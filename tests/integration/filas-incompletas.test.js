/**
 * Integration tests — filas con campos vacíos en la base no deben romper la lectura
 * (Postgres devuelve null en columnas sin dato; cada API los normaliza).
 */
const request = require('supertest');
const mockDb  = require('../helpers/mock-db');

jest.mock('../../api/db', () => require('../helpers/mock-db'));
jest.mock('../../api/_audit', () => ({ logAudit: jest.fn(), clientIp: () => '127.0.0.1' }));

const { buildApp } = require('../helpers/test-app');
const jwt = require('jsonwebtoken');
const { SECRET } = require('../../middleware/auth');

const token = () => jwt.sign({ id: 'natalia', nombre: 'Natalia', role: 'admin', ejec: 'Natalia Gama' }, SECRET, { expiresIn: '1h' });
const get = (app, ruta) => request(app).get(ruta).set('Authorization', `Bearer ${token()}`);
const vacio = { deletedAt: null };

let app;
beforeEach(() => {
  mockDb.resetStore();
  const s = mockDb.getStore();
  s.auditoria.push({ id: 'a1', accion: 'x', fecha: null, ...vacio });
  s.pagos.push({ id: 'p1', monto: null, ...vacio });
  s.deudas.push({ id: 'd1', monto: null, montoConIva: null, pagado: null, pagadoConIva: null, ...vacio });
  s.ops.push({ id: 'o1', numero: null, cotizado: null, ...vacio });
  s.cotizaciones.push({ id: 'c1', ...vacio });
  s.tickets.push({ id: 't1', ...vacio });
  s.casos.push({ id: 'k1', historial: null, ...vacio });
  app = buildApp();
});

describe('Lectura de filas incompletas — todo se normaliza sin error', () => {
  test('auditoría sin fecha ni usuario', async () => {
    const r = await get(app, '/api/auditoria');
    expect(r.status).toBe(200);
    expect(r.body[0].usuario).toBe('');
    expect(r.body[0].fecha).toBeNull();
    expect(r.body[0].exito).toBe(false);
  });
  test('pago sin datos', async () => {
    const r = await get(app, '/api/pagos/p1');
    expect(r.status).toBe(200);
    expect(r.body.monto).toBe(0);
    expect(r.body.concepto).toBe('');
    expect(r.body.comprobante).toBe(false);
  });
  test('deuda sin montos', async () => {
    const r = await get(app, '/api/deudas');
    expect(r.status).toBe(200);
    expect(r.body[0].monto).toBe(0);
    expect(r.body[0].montoConIva).toBeNull();
    expect(r.body[0].debemos).toBe(0);
  });
  test('OP sin datos: utilidad y cobrado en 0', async () => {
    const r = await get(app, '/api/ops/o1');
    expect(r.status).toBe(200);
    expect(r.body.numero).toBe('');
    expect(r.body.cotizado).toBe(0);
    expect(r.body.comision).toBeNull();
  });
  test('cotización sin archivos', async () => {
    const r = await get(app, '/api/cotizaciones/c1');
    expect(r.status).toBe(200);
    expect(r.body.pdf).toEqual([]);
    expect(r.body.excel).toEqual([]);
    expect(r.body.cotId).toBe('');
  });
  test('ticket sin datos', async () => {
    const r = await get(app, '/api/tickets');
    expect(r.status).toBe(200);
    expect(r.body[0].tipo).toBe('');
    expect(r.body[0].cotId).toBe('');
  });
  test('caso con historial nulo → []', async () => {
    const r = await get(app, '/api/casos/k1');
    expect(r.status).toBe(200);
    expect(r.body.historial).toEqual([]);
  });
  test('usuarios: listado con la cuenta admin por defecto', async () => {
    const r = await get(app, '/api/auth/usuarios');
    expect(r.status).toBe(200);
    expect(r.body[0].bloqueado).toBe(false);
  });
});
