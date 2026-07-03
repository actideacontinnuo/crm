/**
 * Integration tests — Flujos completos de autenticación
 * Cubre: olvide/reset password, bloqueo por intentos, 2FA end-to-end,
 * cambiar contraseña, gestión de usuarios por admin.
 */
const request    = require('supertest');
const mockNotion = require('../helpers/mock-notion');

jest.mock('../../api/notion', () => require('../helpers/mock-notion'));
jest.mock('../../api/_audit', () => ({ logAudit: jest.fn().mockResolvedValue(undefined), clientIp: () => '127.0.0.1' }));

const { buildApp } = require('../helpers/test-app');
const { authenticator } = require('otplib');

let app;
beforeEach(() => {
  mockNotion.resetStore();
  app = buildApp();
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
});

async function login(email = 'natalia@actideacontinnuo.com', password = 'AdminTest123!') {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  return res.body.token;
}

// ── Olvidé mi contraseña ──────────────────────────────────
describe('POST /api/auth/olvide-password', () => {
  test('sin email → 400', async () => {
    const res = await request(app).post('/api/auth/olvide-password').send({});
    expect(res.status).toBe(400);
  });

  test('email existente: guarda token y responde genérico', async () => {
    process.env.RESEND_API_KEY = 're_test_falso';
    const res = await request(app).post('/api/auth/olvide-password')
      .send({ email: 'natalia@actideacontinnuo.com' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalled(); // intentó mandar el correo
    delete process.env.RESEND_API_KEY;
  });

  test('email inexistente: misma respuesta genérica (no revela nada)', async () => {
    const res = await request(app).post('/api/auth/olvide-password')
      .send({ email: 'fantasma@actideacontinnuo.com' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// ── Reset de contraseña con token ─────────────────────────
describe('POST /api/auth/reset-password', () => {
  async function solicitarReset() {
    await request(app).post('/api/auth/olvide-password')
      .send({ email: 'natalia@actideacontinnuo.com' });
    // Leer el token directamente del mock store
    const users = await mockNotion.queryDB('usuarios', null);
    return users[0].properties['ResetToken'].rich_text[0]?.plain_text;
  }

  test('faltan campos → 400', async () => {
    const res = await request(app).post('/api/auth/reset-password').send({ token: 'x' });
    expect(res.status).toBe(400);
  });

  test('contraseña débil → 400 con mensaje de política', async () => {
    const token = await solicitarReset();
    const res = await request(app).post('/api/auth/reset-password')
      .send({ token, nueva: 'corta' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/12 caracteres/);
  });

  test('token inválido → 400', async () => {
    const res = await request(app).post('/api/auth/reset-password')
      .send({ token: 'token-falso', nueva: 'NuevaClaveSegura2026!' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/inválido/);
  });

  test('flujo completo: reset y login con la nueva contraseña', async () => {
    const token = await solicitarReset();
    const res = await request(app).post('/api/auth/reset-password')
      .send({ token, nueva: 'NuevaClaveSegura2026!' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // La vieja ya no sirve
    const viejaRes = await request(app).post('/api/auth/login')
      .send({ email: 'natalia@actideacontinnuo.com', password: 'AdminTest123!' });
    expect(viejaRes.status).toBe(401);

    // La nueva sí
    const nuevaRes = await request(app).post('/api/auth/login')
      .send({ email: 'natalia@actideacontinnuo.com', password: 'NuevaClaveSegura2026!' });
    expect(nuevaRes.status).toBe(200);
    expect(nuevaRes.body.token).toBeDefined();
  });

  test('el token no puede reutilizarse', async () => {
    const token = await solicitarReset();
    await request(app).post('/api/auth/reset-password')
      .send({ token, nueva: 'NuevaClaveSegura2026!' });
    const res = await request(app).post('/api/auth/reset-password')
      .send({ token, nueva: 'OtraClaveDistinta2026!' });
    expect(res.status).toBe(400);
  });
});

// ── Bloqueo por intentos fallidos ─────────────────────────
describe('Bloqueo de cuenta por intentos fallidos', () => {
  test('tras 5 intentos fallidos la cuenta se bloquea (423)', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/auth/login')
        .send({ email: 'natalia@actideacontinnuo.com', password: 'mala' });
    }
    const res = await request(app).post('/api/auth/login')
      .send({ email: 'natalia@actideacontinnuo.com', password: 'AdminTest123!' });
    expect(res.status).toBe(423);
    expect(res.body.error).toMatch(/bloqueada/i);
  });

  test('login exitoso resetea el contador de intentos', async () => {
    await request(app).post('/api/auth/login')
      .send({ email: 'natalia@actideacontinnuo.com', password: 'mala' });
    const ok = await request(app).post('/api/auth/login')
      .send({ email: 'natalia@actideacontinnuo.com', password: 'AdminTest123!' });
    expect(ok.status).toBe(200);

    const users = await mockNotion.queryDB('usuarios', null);
    expect(users[0].properties['IntentosFallidos'].number).toBe(0);
  });
});

// ── Cambiar contraseña propia ─────────────────────────────
describe('POST /api/auth/cambiar-password', () => {
  test('faltan campos → 400', async () => {
    const token = await login();
    const res = await request(app).post('/api/auth/cambiar-password')
      .set('Authorization', `Bearer ${token}`).send({});
    expect(res.status).toBe(400);
  });

  test('nueva contraseña débil → 400', async () => {
    const token = await login();
    const res = await request(app).post('/api/auth/cambiar-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ passwordActual: 'AdminTest123!', passwordNuevo: 'debil' });
    expect(res.status).toBe(400);
  });

  test('contraseña actual incorrecta → 401', async () => {
    const token = await login();
    const res = await request(app).post('/api/auth/cambiar-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ passwordActual: 'incorrecta', passwordNuevo: 'NuevaClaveSegura2026!' });
    expect(res.status).toBe(401);
  });

  test('cambio exitoso devuelve token nuevo y la nueva clave funciona', async () => {
    const token = await login();
    const res = await request(app).post('/api/auth/cambiar-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ passwordActual: 'AdminTest123!', passwordNuevo: 'NuevaClaveSegura2026!' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();

    const relogin = await request(app).post('/api/auth/login')
      .send({ email: 'natalia@actideacontinnuo.com', password: 'NuevaClaveSegura2026!' });
    expect(relogin.status).toBe(200);
  });
});

// ── 2FA end-to-end ────────────────────────────────────────
describe('2FA — configurar, confirmar, login en dos pasos, desactivar', () => {
  test('status inicial: deshabilitado', async () => {
    const token = await login();
    const res = await request(app).get('/api/auth/2fa/status')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
  });

  test('setup devuelve secreto y QR', async () => {
    const token = await login();
    const res = await request(app).get('/api/auth/2fa/setup')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.secret).toBeDefined();
    expect(res.body.qr).toMatch(/^data:image\/png/);
  });

  test('confirm sin setup previo → 400', async () => {
    const token = await login();
    const res = await request(app).post('/api/auth/2fa/confirm')
      .set('Authorization', `Bearer ${token}`).send({ code: '123456' });
    expect(res.status).toBe(400);
  });

  test('confirm con código incorrecto → 401', async () => {
    const token = await login();
    await request(app).get('/api/auth/2fa/setup').set('Authorization', `Bearer ${token}`);
    const res = await request(app).post('/api/auth/2fa/confirm')
      .set('Authorization', `Bearer ${token}`).send({ code: '000000' });
    expect(res.status).toBe(401);
  });

  test('flujo completo: activar 2FA, login en dos pasos, desactivar', async () => {
    const token = await login();

    // 1. Setup
    const setup = await request(app).get('/api/auth/2fa/setup')
      .set('Authorization', `Bearer ${token}`);
    const secret = setup.body.secret;

    // 2. Confirmar con código válido
    const confirm = await request(app).post('/api/auth/2fa/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: authenticator.generate(secret) });
    expect(confirm.status).toBe(200);

    // 3. Login ahora pide segundo paso
    const paso1 = await request(app).post('/api/auth/login')
      .send({ email: 'natalia@actideacontinnuo.com', password: 'AdminTest123!' });
    expect(paso1.status).toBe(200);
    expect(paso1.body.requiresTwoFA).toBe(true);
    expect(paso1.body.tempToken).toBeDefined();
    expect(paso1.body.token).toBeUndefined(); // sin token completo todavía

    // 4. El tempToken NO sirve para acceder a datos
    const bloqueado = await request(app).get('/api/clientes')
      .set('Authorization', `Bearer ${paso1.body.tempToken}`);
    expect(bloqueado.status).toBe(401);

    // 5. verify-2fa con código incorrecto → 401
    const mal = await request(app).post('/api/auth/verify-2fa')
      .send({ tempToken: paso1.body.tempToken, code: '000000' });
    expect(mal.status).toBe(401);

    // 6. verify-2fa con código válido → token completo
    const paso2 = await request(app).post('/api/auth/verify-2fa')
      .send({ tempToken: paso1.body.tempToken, code: authenticator.generate(secret) });
    expect(paso2.status).toBe(200);
    expect(paso2.body.token).toBeDefined();

    // 7. Desactivar requiere contraseña correcta
    const malPw = await request(app).post('/api/auth/2fa/disable')
      .set('Authorization', `Bearer ${paso2.body.token}`).send({ password: 'incorrecta' });
    expect(malPw.status).toBe(401);

    const off = await request(app).post('/api/auth/2fa/disable')
      .set('Authorization', `Bearer ${paso2.body.token}`).send({ password: 'AdminTest123!' });
    expect(off.status).toBe(200);

    // 8. Login vuelve a ser de un solo paso
    const directo = await request(app).post('/api/auth/login')
      .send({ email: 'natalia@actideacontinnuo.com', password: 'AdminTest123!' });
    expect(directo.body.token).toBeDefined();
    expect(directo.body.requiresTwoFA).toBeUndefined();
  });

  test('verify-2fa sin campos → 400; con token basura → 401', async () => {
    const sinCampos = await request(app).post('/api/auth/verify-2fa').send({});
    expect(sinCampos.status).toBe(400);

    const basura = await request(app).post('/api/auth/verify-2fa')
      .send({ tempToken: 'no-es-jwt', code: '123456' });
    expect(basura.status).toBe(401);
  });
});

// ── Gestión de usuarios (solo admin) ──────────────────────
describe('Gestión de usuarios — /api/auth/usuarios', () => {
  test('admin lista usuarios sin datos sensibles', async () => {
    const token = await login();
    const res = await request(app).get('/api/auth/usuarios')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0].id).toBe('natalia');
    expect(res.body[0].hash).toBeUndefined();
    expect(res.body[0].twoFASecret).toBeUndefined();
  });

  test('no-admin no puede listar usuarios (403)', async () => {
    const jwt = require('jsonwebtoken');
    const { SECRET } = require('../../middleware/auth');
    const ejec = jwt.sign({ id: 'alexia', role: 'ejecutivo', ejec: 'Alexia' }, SECRET, { expiresIn: '1h' });
    const res = await request(app).get('/api/auth/usuarios')
      .set('Authorization', `Bearer ${ejec}`);
    expect(res.status).toBe(403);
  });

  test('admin resetea contraseña: genera temporal fuerte y obliga cambio', async () => {
    const token = await login();
    const res = await request(app).post('/api/auth/usuarios/natalia/resetear-password')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.passwordTemporal).toBeDefined();

    // Login con la temporal marca mustChangePassword
    const relogin = await request(app).post('/api/auth/login')
      .send({ usuario: 'natalia', password: res.body.passwordTemporal });
    expect(relogin.status).toBe(200);
    expect(relogin.body.mustChangePassword).toBe(true);

    // Y con esa bandera, la API de datos queda bloqueada
    const bloqueado = await request(app).get('/api/clientes')
      .set('Authorization', `Bearer ${relogin.body.token}`);
    expect(bloqueado.status).toBe(403);
  });

  test('resetear password de usuario inexistente → 404', async () => {
    const token = await login();
    const res = await request(app).post('/api/auth/usuarios/fantasma/resetear-password')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  test('admin desbloquea una cuenta bloqueada', async () => {
    // Bloquear a natalia
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/auth/login')
        .send({ usuario: 'natalia', password: 'mala' });
    }
    const bloqueada = await request(app).post('/api/auth/login')
      .send({ usuario: 'natalia', password: 'AdminTest123!' });
    expect(bloqueada.status).toBe(423);

    // Desbloquear con un token admin firmado directamente (la cuenta está bloqueada)
    const jwt = require('jsonwebtoken');
    const { SECRET } = require('../../middleware/auth');
    const adminJwt = jwt.sign({ id: 'natalia', role: 'admin', ejec: 'Natalia Gama' }, SECRET, { expiresIn: '1h' });
    const res = await request(app).post('/api/auth/usuarios/natalia/desbloquear')
      .set('Authorization', `Bearer ${adminJwt}`);
    expect(res.status).toBe(200);

    // Ya puede entrar
    const ok = await request(app).post('/api/auth/login')
      .send({ usuario: 'natalia', password: 'AdminTest123!' });
    expect(ok.status).toBe(200);
  });

  test('desbloquear usuario inexistente → 404', async () => {
    const token = await login();
    const res = await request(app).post('/api/auth/usuarios/fantasma/desbloquear')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
