const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { SECRET, authMiddleware } = require('../middleware/auth');
const {
  notion, queryDB, updatePage,
  prop_title, prop_text, prop_select, prop_checkbox, prop_number, prop_date,
  read_title, read_text, read_select, read_checkbox, read_number, read_date,
} = require('./notion');
const { validatePasswordStrength, generateStrongTempPassword } = require('./_password');
const { generateSecret, generateOtpUri, generateQrDataUrl, verifyToken } = require('./_twofa');
const { logAudit, clientIp } = require('./_audit');

const MAX_INTENTOS = 5;
const BLOQUEO_MIN  = 30;

function toUser(page) {
  const p = page.properties;
  return {
    pageId:    page.id,
    id:        read_title(p['Usuario']),
    nombre:    read_text(p['Nombre']),
    role:      read_select(p['Rol']),
    ejec:      read_text(p['Ejecutivo']) || null,
    hash:      read_text(p['PasswordHash']),
    activo:    read_checkbox(p['Activo']),
    debeCambiarPassword: read_checkbox(p['DebeCambiarPassword']),
    twoFASecret:  read_text(p['TwoFASecret']),
    twoFAEnabled: read_checkbox(p['TwoFAEnabled']),
    intentosFallidos: read_number(p['IntentosFallidos']),
    bloqueadoHasta:   read_date(p['BloqueadoHasta']),
  };
}

async function findUserById(usuario) {
  const pages = await queryDB('usuarios', { property: 'Usuario', title: { equals: usuario } });
  return pages.length ? toUser(pages[0]) : null;
}

function signFullToken(user) {
  return jwt.sign(
    { id: user.id, nombre: user.nombre, role: user.role, ejec: user.ejec, mustChangePassword: !!user.debeCambiarPassword },
    SECRET,
    { expiresIn: '12h' }
  );
}

// ── LOGIN — paso 1: usuario + contraseña ──────────────────
router.post('/login', async (req, res) => {
  const { usuario, password } = req.body;
  const ip = clientIp(req);
  if (!usuario || !password) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });

  const usuarioId = usuario.toLowerCase().trim();

  try {
    const user = await findUserById(usuarioId);
    if (!user || !user.activo) {
      await logAudit({ usuario: usuarioId, accion: 'login_fallido', detalle: 'usuario no existe o inactivo', ip, exito: false });
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }

    // ── Bloqueo por intentos fallidos ──
    if (user.bloqueadoHasta && new Date(user.bloqueadoHasta) > new Date()) {
      const minutosRestantes = Math.ceil((new Date(user.bloqueadoHasta) - new Date()) / 60000);
      await logAudit({ usuario: usuarioId, accion: 'cuenta_bloqueada', detalle: `intento durante bloqueo, faltan ${minutosRestantes} min`, ip, exito: false });
      return res.status(423).json({ error: `Cuenta bloqueada por demasiados intentos fallidos. Intenta en ${minutosRestantes} minuto(s).` });
    }

    const passwordOk = bcrypt.compareSync(password, user.hash);

    if (!passwordOk) {
      const nuevosIntentos = (user.intentosFallidos || 0) + 1;
      const props = { 'IntentosFallidos': prop_number(nuevosIntentos) };
      if (nuevosIntentos >= MAX_INTENTOS) {
        const hasta = new Date(Date.now() + BLOQUEO_MIN * 60000);
        props['BloqueadoHasta'] = prop_date(hasta.toISOString());
        await logAudit({ usuario: usuarioId, accion: 'cuenta_bloqueada', detalle: `${nuevosIntentos} intentos fallidos`, ip, exito: false });
      }
      await updatePage(user.pageId, props);
      await logAudit({ usuario: usuarioId, accion: 'login_fallido', detalle: `intento ${nuevosIntentos}/${MAX_INTENTOS}`, ip, exito: false });
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }

    // Contraseña correcta — resetear contador de intentos
    if (user.intentosFallidos || user.bloqueadoHasta) {
      await updatePage(user.pageId, { 'IntentosFallidos': prop_number(0), 'BloqueadoHasta': { date: null } });
    }

    // ── 2FA activado: pedir segundo paso ──
    if (user.twoFAEnabled) {
      const tempToken = jwt.sign({ id: user.id, scope: '2fa-pending' }, SECRET, { expiresIn: '5m' });
      return res.json({ requiresTwoFA: true, tempToken });
    }

    // Sin 2FA: sesión completa de una vez
    const token = signFullToken(user);
    await logAudit({ usuario: usuarioId, accion: 'login_exitoso', ip, exito: true });
    res.json({ token, id: user.id, nombre: user.nombre, role: user.role, ejec: user.ejec, mustChangePassword: user.debeCambiarPassword });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── LOGIN — paso 2: código de 2FA ─────────────────────────
router.post('/verify-2fa', async (req, res) => {
  const { tempToken, code } = req.body;
  const ip = clientIp(req);
  if (!tempToken || !code) return res.status(400).json({ error: 'Falta el token temporal o el código' });

  let decoded;
  try {
    decoded = jwt.verify(tempToken, SECRET);
    if (decoded.scope !== '2fa-pending') throw new Error('token inválido');
  } catch {
    return res.status(401).json({ error: 'Token temporal inválido o expirado. Vuelve a iniciar sesión.' });
  }

  try {
    const user = await findUserById(decoded.id);
    if (!user || !user.twoFAEnabled) return res.status(401).json({ error: 'Usuario no válido' });

    if (!verifyToken(code, user.twoFASecret)) {
      await logAudit({ usuario: user.id, accion: 'login_fallido', detalle: 'código 2FA incorrecto', ip, exito: false });
      return res.status(401).json({ error: 'Código de verificación incorrecto' });
    }

    const token = signFullToken(user);
    await logAudit({ usuario: user.id, accion: 'login_exitoso', detalle: 'con 2FA', ip, exito: true });
    res.json({ token, id: user.id, nombre: user.nombre, role: user.role, ejec: user.ejec, mustChangePassword: user.debeCambiarPassword });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Cambiar contraseña propia ──────────────────────────────
router.post('/cambiar-password', authMiddleware, async (req, res) => {
  const { passwordActual, passwordNuevo } = req.body;
  const ip = clientIp(req);
  if (!passwordActual || !passwordNuevo) return res.status(400).json({ error: 'Faltan campos' });

  const errorPolitica = validatePasswordStrength(passwordNuevo);
  if (errorPolitica) return res.status(400).json({ error: errorPolitica });

  try {
    const user = await findUserById(req.user.id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (!bcrypt.compareSync(passwordActual, user.hash)) {
      await logAudit({ usuario: req.user.id, accion: 'password_cambiado', detalle: 'contraseña actual incorrecta', ip, exito: false });
      return res.status(401).json({ error: 'Contraseña actual incorrecta' });
    }

    const newHash = bcrypt.hashSync(passwordNuevo, 12);
    await updatePage(user.pageId, {
      'PasswordHash': prop_text(newHash),
      'DebeCambiarPassword': prop_checkbox(false),
    });
    await logAudit({ usuario: req.user.id, accion: 'password_cambiado', ip, exito: true });

    // Token nuevo sin la bandera de "debe cambiar password"
    const token = signFullToken({ ...user, debeCambiarPassword: false });
    res.json({ ok: true, token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Solo Admin: listar usuarios y resetear contraseñas ──────
router.get('/usuarios', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Solo el Admin puede ver esto' });
  try {
    const pages = await queryDB('usuarios', null, [{ property: 'Usuario', direction: 'ascending' }]);
    res.json(pages.map(toUser).map(u => ({
      id: u.id, nombre: u.nombre, role: u.role, ejec: u.ejec, activo: u.activo,
      twoFAEnabled: u.twoFAEnabled, bloqueado: !!(u.bloqueadoHasta && new Date(u.bloqueadoHasta) > new Date()),
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/usuarios/:id/resetear-password', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Solo el Admin puede resetear contraseñas' });
  try {
    const user = await findUserById(req.params.id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const tempPassword = generateStrongTempPassword();
    const newHash = bcrypt.hashSync(tempPassword, 12);
    await updatePage(user.pageId, {
      'PasswordHash': prop_text(newHash),
      'DebeCambiarPassword': prop_checkbox(true), // debe cambiarla en su próximo login
      'IntentosFallidos': prop_number(0),
      'BloqueadoHasta': { date: null },
    });
    await logAudit({ usuario: req.user.id, accion: 'password_reseteado', entidad: req.params.id, ip: clientIp(req), exito: true });

    res.json({ ok: true, usuario: user.id, passwordTemporal: tempPassword });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/usuarios/:id/desbloquear', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Solo el Admin puede desbloquear cuentas' });
  try {
    const user = await findUserById(req.params.id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    await updatePage(user.pageId, { 'IntentosFallidos': prop_number(0), 'BloqueadoHasta': { date: null } });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── 2FA: configurar ─────────────────────────────────────────
router.get('/2fa/setup', authMiddleware, async (req, res) => {
  try {
    const secret = generateSecret();
    const uri    = generateOtpUri(secret, req.user.id);
    const qr     = await generateQrDataUrl(uri);

    // Se guarda como "pendiente" — TwoFAEnabled sigue en false hasta confirmar con un código válido
    const user = await findUserById(req.user.id);
    await updatePage(user.pageId, { 'TwoFASecret': prop_text(secret) });

    res.json({ secret, qr });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/2fa/confirm', authMiddleware, async (req, res) => {
  const { code } = req.body;
  try {
    const user = await findUserById(req.user.id);
    if (!user.twoFASecret) return res.status(400).json({ error: 'Primero solicita el código QR' });
    if (!verifyToken(code, user.twoFASecret)) {
      return res.status(401).json({ error: 'Código incorrecto. Verifica la hora de tu teléfono e intenta de nuevo.' });
    }
    await updatePage(user.pageId, { 'TwoFAEnabled': prop_checkbox(true) });
    await logAudit({ usuario: req.user.id, accion: '2fa_activado', ip: clientIp(req), exito: true });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/2fa/disable', authMiddleware, async (req, res) => {
  const { password } = req.body;
  try {
    const user = await findUserById(req.user.id);
    if (!bcrypt.compareSync(password || '', user.hash)) {
      return res.status(401).json({ error: 'Contraseña incorrecta' });
    }
    await updatePage(user.pageId, { 'TwoFAEnabled': prop_checkbox(false), 'TwoFASecret': prop_text('') });
    await logAudit({ usuario: req.user.id, accion: '2fa_desactivado', ip: clientIp(req), exito: true });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/2fa/status', authMiddleware, async (req, res) => {
  try {
    const user = await findUserById(req.user.id);
    res.json({ enabled: !!user.twoFAEnabled });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
