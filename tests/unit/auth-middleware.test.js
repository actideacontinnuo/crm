/**
 * Unit tests — Middleware de autenticación JWT
 */
const jwt = require('jsonwebtoken');
const { authMiddleware, SECRET } = require('../../middleware/auth');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json   = jest.fn().mockReturnValue(res);
  return res;
}

function tokenFor(payload, opts = {}) {
  return jwt.sign(payload, SECRET, { expiresIn: '1h', ...opts });
}

describe('authMiddleware', () => {
  test('pasa cuando el token es válido', () => {
    const token = tokenFor({ id: 'natalia', role: 'admin', nombre: 'Natalia' });
    const req   = { headers: { authorization: `Bearer ${token}` } };
    const res   = mockRes();
    const next  = jest.fn();

    authMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user.id).toBe('natalia');
    expect(req.user.role).toBe('admin');
  });

  test('rechaza sin header Authorization (401)', () => {
    const req  = { headers: {} };
    const res  = mockRes();
    const next = jest.fn();

    authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('rechaza token con firma inválida (401)', () => {
    const req  = { headers: { authorization: 'Bearer token.invalido.firma' } };
    const res  = mockRes();
    const next = jest.fn();

    authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('rechaza token expirado (401)', () => {
    const token = tokenFor({ id: 'natalia', role: 'admin' }, { expiresIn: '-1s' });
    const req   = { headers: { authorization: `Bearer ${token}` } };
    const res   = mockRes();
    const next  = jest.fn();

    authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('rechaza token con scope 2fa-pending (401)', () => {
    const token = tokenFor({ id: 'natalia', scope: '2fa-pending' });
    const req   = { headers: { authorization: `Bearer ${token}` } };
    const res   = mockRes();
    const next  = jest.fn();

    authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('rechaza header sin prefijo Bearer (401)', () => {
    const token = tokenFor({ id: 'natalia', role: 'admin' });
    const req   = { headers: { authorization: token } };
    const res   = mockRes();
    const next  = jest.fn();

    authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
