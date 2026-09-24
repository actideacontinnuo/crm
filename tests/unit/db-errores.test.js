/**
 * Unit tests — traducción de errores de Postgres a mensajes seguros (api/db.js)
 */
const { traducirError } = require('../../api/db');

const pgErr = (code, message) => Object.assign(new Error(message), { code });

describe('traducirError', () => {
  let logSpy;
  beforeEach(() => { logSpy = jest.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => logSpy.mockRestore());

  test.each([
    ['22P02', 400, /formato inválido/],
    ['23505', 409, /Ya existe/],
    ['23503', 400, /Referencia inválida/],
    ['23514', 400, /no permitido/],
    ['23502', 400, /obligatorio/],
    ['22007', 400, /Fecha/],
    ['22003', 400, /rango/],
  ])('código %s → %i con mensaje amigable', (code, status, msg) => {
    const e = traducirError(pgErr(code, 'invalid input syntax for type uuid: "x" (tabla ops)'));
    expect(e.status).toBe(status);
    expect(e.message).toMatch(msg);
    expect(e.message).not.toMatch(/uuid|ops|syntax/); // no filtra detalles SQL
  });

  test('error de Postgres desconocido → 500 genérico', () => {
    const e = traducirError(pgErr('XX000', 'algo interno con tabla clientes'));
    expect(e.status).toBe(500);
    expect(e.message).toBe('Error de la base de datos');
  });

  test('caída de conexión → mensaje claro, sin detalles', () => {
    const e = traducirError(pgErr('ECONNREFUSED', 'connect ECONNREFUSED 10.0.0.1:5432'));
    expect(e.status).toBe(500);
    expect(e.message).toMatch(/No se pudo conectar/);
    expect(e.message).not.toMatch(/10\.0\.0\.1/);
  });

  test('errores ya tratados (con status) o no relacionados pasan intactos', () => {
    const conStatus = Object.assign(new Error('Registro no encontrado'), { status: 404 });
    expect(traducirError(conStatus)).toBe(conStatus);
    const normal = new Error('boom');
    expect(traducirError(normal)).toBe(normal);
    expect(traducirError(null)).toBeNull();
  });
});
