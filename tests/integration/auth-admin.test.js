/**
 * Integration tests — Gestión de usuarios (solo Admin) y 2FA end-to-end
 * Cubre: alta de usuarios, activar/desactivar, resetear password,
 * desbloquear, y el ciclo completo de 2FA (setup → confirm → login → disable).
 */
const request    = require('supertest');
const mockNotion = require('../helpers/mock-notion');

jest.mock('../../api/notion', () => require('../helpers/mock-notion'));
jest.mock('../../api/_audit', () => ({ logAudit: jest.fn(), clientIp: () => '127.0.0.1' }));

const { buildApp } = require('../helpers/test-app');
const jwt = require('jsonwebtoken');
const { SECRET } = require('../../middleware/auth');
const { authenticator } = require('otplib');
const { validatePasswordStrength } = require('../../api/_password');

const adminToken = () =>
  jwt.sign({ id: 'natalia', nombre: 'Natalia', role: 'admin', ejec: 'Natalia Gama' }, SECRET, { expiresIn: '1h' });
const ejecToken = () =>
  jwt.sign({ id: 'alexia', nombre: 'Alexia', role: 'ejecutivo', ejec: 'Alexia' }, SECRET, { expiresIn: '1h' });

let app;
beforeEach(() => {
  mockNotion.resetStore();
  app = buildApp();
});

const NUEVO = { usuario: 'oscar', nombre: 'Oscar', email: 'oscar@actideacontinnuo.com', rol: 'administracion' };

describe('POST /api/auth/usuarios — alta de usuarios', () => {
  test('un no-admin recibe 403', async () => {
    const res = await request(app).post('/api/auth/usuarios')
      .set('Authorization', `Bearer ${ejecToken()}`).send(NUEVO);
    expect(res.status).toBe(403);
  });

  test('faltan campos → 400', async () => {
    const res = await request(app).post('/api/auth/usuarios')
      .set('Authorization', `Bearer ${adminToken()}`).send({ usuario: 'x' });
    expect(res.status).toBe(400);
  });

  test('rol inválido → 400', async () => {
    const res = await request(app).post('/api/auth/usuarios')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ ...NUEVO, rol: 'superadmin' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Rol inválido');
  });

  test('email malformado → 400', async () => {
    const res = await request(app).post('/api/auth/usuarios')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ ...NUEVO, email: 'no-es-un-correo' });
    expect(res.status).toBe(400);
  });

  test('alta exitosa devuelve contraseña temporal que cumple la política', async () => {
    const res = await request(app).post('/api/auth/usuarios')
      .set('Authorization', `Bearer ${adminToken()}`).send(NUEVO);
    expect(res.status).toBe(201);
    expect(res.body.usuario).toBe('oscar');
    expect(validatePasswordStrength(res.body.passwordTemporal)).toBeNull();
  });

  test('el usuario nuevo puede iniciar sesión y debe cambiar su contraseña', async () => {
    const alta = await request(app).post('/api/auth/usuarios')
      .set('Authorization', `Bearer ${adminToken()}`).send(NUEVO);
    const login = await request(app).post('/api/auth/login')
      .send({ usuario: 'oscar', password: alta.body.passwordTemporal });
    expect(login.status).toBe(200);
    expect(login.body.mustChangePassword).toBe(true);
  });

  test('rol ejecutivo hereda su nombre como Ejecutivo si no se especifica', async () => {
    const res = await request(app).post('/api/auth/usuarios')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ usuario: 'ximena', nombre: 'Ximena', email: 'ximena@actideacontinnuo.com', rol: 'ejecutivo' });
    expect(res.status).toBe(201);
    const lista = await request(app).get('/api/auth/usuarios')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(lista.body.find(u => u.id === 'ximena').ejec).toBe('Ximena');
  });

  test('usuario duplicado → 409', async () => {
    await request(app).post('/api/auth/usuarios')
      .set('Authorization', `Bearer ${adminToken()}`).send(NUEVO);
    const res = await request(app).post('/api/auth/usuarios')
      .set('Authorization', `Bearer ${adminToken()}`).send({ ...NUEVO, email: 'otro@x.com' });
    expect(res.status).toBe(409);
  });

  test('correo duplicado → 409', async () => {
    const res = await request(app).post('/api/auth/usuarios')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ ...NUEVO, usuario: 'otro', email: 'natalia@actideacontinnuo.com' });
    expect(res.status).toBe(409);
  });
});

describe('POST /api/auth/usuarios/:id/activar', () => {
  test('no-admin → 403', async () => {
    const res = await request(app).post('/api/auth/usuarios/natalia/activar')
      .set('Authorization', `Bearer ${ejecToken()}`).send({ activo: false });
    expect(res.status).toBe(403);
  });

  test('usuario inexistente → 404', async () => {
    const res = await request(app).post('/api/auth/usuarios/fantasma/activar')
      .set('Authorization', `Bearer ${adminToken()}`).send({ activo: false });
    expect(res.status).toBe(404);
  });

  test('no puede desactivarse a sí mismo → 400', async () => {
    const res = await request(app).post('/api/auth/usuarios/natalia/activar')
      .set('Authorization', `Bearer ${adminToken()}`).send({ activo: false });
    expect(res.status).toBe(400);
  });

  test('desactivar a otro usuario impide su login', async () => {
    mockNotion.addEjecUser(); // alexia / EjecTest123!
    const res = await request(app).post('/api/auth/usuarios/alexia/activar')
      .set('Authorization', `Bearer ${adminToken()}`).send({ activo: false });
    expect(res.status).toBe(200);
    const login = await request(app).post('/api/auth/login')
      .send({ usuario: 'alexia', password: 'EjecTest123!' });
    expect(login.status).toBe(401);
  });

  test('reactivar restaura el acceso', async () => {
    mockNotion.addEjecUser();
    await request(app).post('/api/auth/usuarios/alexia/activar')
      .set('Authorization', `Bearer ${adminToken()}`).send({ activo: false });
    await request(app).post('/api/auth/usuarios/alexia/activar')
      .set('Authorization', `Bearer ${adminToken()}`).send({ activo: true });
    const login = await request(app).post('/api/auth/login')
      .send({ usuario: 'alexia', password: 'EjecTest123!' });
    expect(login.status).toBe(200);
  });
});

describe('resetear-password y desbloquear', () => {
  test('resetear password de usuario inexistente → 404', async () => {
    const res = await request(app).post('/api/auth/usuarios/fantasma/resetear-password')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(404);
  });

  test('resetear genera temporal válida y el usuario entra con ella', async () => {
    mockNotion.addEjecUser();
    const res = await request(app).post('/api/auth/usuarios/alexia/resetear-password')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(validatePasswordStrength(res.body.passwordTemporal)).toBeNull();
    const login = await request(app).post('/api/auth/login')
      .send({ usuario: 'alexia', password: res.body.passwordTemporal });
    expect(login.status).toBe(200);
    expect(login.body.mustChangePassword).toBe(true);
  });

  test('no-admin no puede resetear → 403', async () => {
    const res = await request(app).post('/api/auth/usuarios/natalia/resetear-password')
      .set('Authorization', `Bearer ${ejecToken()}`);
    expect(res.status).toBe(403);
  });

  test('desbloquear usuario inexistente → 404', async () => {
    const res = await request(app).post('/api/auth/usuarios/fantasma/desbloquear')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(404);
  });

  test('desbloquear limpia intentos y bloqueo', async () => {
    mockNotion.addEjecUser();
    // Bloquear a alexia con 5 intentos fallidos
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/auth/login').send({ usuario: 'alexia', password: 'mal' });
    }
    const bloqueado = await request(app).post('/api/auth/login')
      .send({ usuario: 'alexia', password: 'EjecTest123!' });
    expect(bloqueado.status).toBe(423);

    await request(app).post('/api/auth/usuarios/alexia/desbloquear')
      .set('Authorization', `Bearer ${adminToken()}`);
    const login = await request(app).post('/api/auth/login')
      .send({ usuario: 'alexia', password: 'EjecTest123!' });
    expect(login.status).toBe(200);
  });

  test('no-admin no puede desbloquear → 403', async () => {
    const res = await request(app).post('/api/auth/usuarios/natalia/desbloquear')
      .set('Authorization', `Bearer ${ejecToken()}`);
    expect(res.status).toBe(403);
  });
});

describe('2FA — ciclo completo', () => {
  async function setup2FA() {
    const setup = await request(app).get('/api/auth/2fa/setup')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(setup.status).toBe(200);
    expect(setup.body.qr).toMatch(/^data:image\/png;base64,/);
    return setup.body.secret;
  }

  test('setup devuelve secreto y QR; confirm con código válido activa 2FA', async () => {
    const secret = await setup2FA();
    const res = await request(app).post('/api/auth/2fa/confirm')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ code: authenticator.generate(secret) });
    expect(res.status).toBe(200);

    const status = await request(app).get('/api/auth/2fa/status')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(status.body.enabled).toBe(true);
  });

  test('confirm sin setup previo → 400', async () => {
    const res = await request(app).post('/api/auth/2fa/confirm')
      .set('Authorization', `Bearer ${adminToken()}`).send({ code: '123456' });
    expect(res.status).toBe(400);
  });

  test('confirm con código incorrecto → 401', async () => {
    await setup2FA();
    const res = await request(app).post('/api/auth/2fa/confirm')
      .set('Authorization', `Bearer ${adminToken()}`).send({ code: '000000' });
    expect(res.status).toBe(401);
  });

  test('con 2FA activo, el login pide segundo paso y verify-2fa completa la sesión', async () => {
    const secret = await setup2FA();
    await request(app).post('/api/auth/2fa/confirm')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ code: authenticator.generate(secret) });

    const login = await request(app).post('/api/auth/login')
      .send({ usuario: 'natalia', password: 'AdminTest123!' });
    expect(login.status).toBe(200);
    expect(login.body.requiresTwoFA).toBe(true);
    expect(login.body.token).toBeUndefined();

    // El token temporal NO sirve para la API de datos
    const bloqueado = await request(app).get('/api/clientes')
      .set('Authorization', `Bearer ${login.body.tempToken}`);
    expect(bloqueado.status).toBe(401);

    // Código incorrecto → 401
    const mal = await request(app).post('/api/auth/verify-2fa')
      .send({ tempToken: login.body.tempToken, code: '000000' });
    expect(mal.status).toBe(401);

    // Código correcto → sesión completa
    const ok = await request(app).post('/api/auth/verify-2fa')
      .send({ tempToken: login.body.tempToken, code: authenticator.generate(secret) });
    expect(ok.status).toBe(200);
    expect(ok.body.token).toBeDefined();
  });

  test('verify-2fa sin campos → 400; con token no-2fa → 401; usuario sin 2FA → 401', async () => {
    expect((await request(app).post('/api/auth/verify-2fa').send({})).status).toBe(400);
    expect((await request(app).post('/api/auth/verify-2fa')
      .send({ tempToken: adminToken(), code: '123456' })).status).toBe(401);
    const temp = jwt.sign({ id: 'natalia', scope: '2fa-pending' }, SECRET, { expiresIn: '5m' });
    expect((await request(app).post('/api/auth/verify-2fa')
      .send({ tempToken: temp, code: '123456' })).status).toBe(401);
  });

  test('disable con contraseña incorrecta → 401; con la correcta apaga 2FA', async () => {
    const secret = await setup2FA();
    await request(app).post('/api/auth/2fa/confirm')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ code: authenticator.generate(secret) });

    const mal = await request(app).post('/api/auth/2fa/disable')
      .set('Authorization', `Bearer ${adminToken()}`).send({ password: 'incorrecta' });
    expect(mal.status).toBe(401);

    const ok = await request(app).post('/api/auth/2fa/disable')
      .set('Authorization', `Bearer ${adminToken()}`).send({ password: 'AdminTest123!' });
    expect(ok.status).toBe(200);

    const status = await request(app).get('/api/auth/2fa/status')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(status.body.enabled).toBe(false);
  });
});
