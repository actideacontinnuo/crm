const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const { SECRET, authMiddleware } = require('../middleware/auth');
const {
  notion, queryDB, updatePage,
  prop_title, prop_text, prop_select, prop_checkbox,
  read_title, read_text, read_select, read_checkbox,
} = require('./notion');

function toUser(page) {
  const p = page.properties;
  return {
    pageId:   page.id,
    id:       read_title(p['Usuario']),
    nombre:   read_text(p['Nombre']),
    role:     read_select(p['Rol']),
    ejec:     read_text(p['Ejecutivo']) || null,
    hash:     read_text(p['PasswordHash']),
    activo:   read_checkbox(p['Activo']),
  };
}

async function findUserById(usuario) {
  const pages = await queryDB('usuarios', { property: 'Usuario', title: { equals: usuario } });
  return pages.length ? toUser(pages[0]) : null;
}

router.post('/login', async (req, res) => {
  const { usuario, password } = req.body;
  if (!usuario || !password) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });

  try {
    const user = await findUserById(usuario.toLowerCase().trim());
    if (!user || !user.activo || !bcrypt.compareSync(password, user.hash))
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });

    const token = jwt.sign(
      { id: user.id, nombre: user.nombre, role: user.role, ejec: user.ejec },
      SECRET,
      { expiresIn: '12h' }
    );
    res.json({ token, id: user.id, nombre: user.nombre, role: user.role, ejec: user.ejec });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/cambiar-password', authMiddleware, async (req, res) => {
  const { passwordActual, passwordNuevo } = req.body;
  if (!passwordActual || !passwordNuevo) return res.status(400).json({ error: 'Faltan campos' });
  if (passwordNuevo.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });

  try {
    const user = await findUserById(req.user.id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (!bcrypt.compareSync(passwordActual, user.hash))
      return res.status(401).json({ error: 'Contraseña actual incorrecta' });

    const newHash = bcrypt.hashSync(passwordNuevo, 10);
    await updatePage(user.pageId, { 'PasswordHash': prop_text(newHash) });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Solo Admin: listar usuarios y resetear contraseñas ──────
router.get('/usuarios', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Solo el Admin puede ver esto' });
  try {
    const pages = await queryDB('usuarios', null, [{ property: 'Usuario', direction: 'ascending' }]);
    res.json(pages.map(toUser).map(u => ({ id: u.id, nombre: u.nombre, role: u.role, ejec: u.ejec, activo: u.activo })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/usuarios/:id/resetear-password', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Solo el Admin puede resetear contraseñas' });
  try {
    const user = await findUserById(req.params.id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    // Genera una contraseña temporal legible: 2 palabras + 2 dígitos
    const palabras = ['Sol', 'Luna', 'Mar', 'Rio', 'Vento', 'Cielo', 'Roca', 'Luz'];
    const a = palabras[crypto.randomInt(palabras.length)];
    const b = palabras[crypto.randomInt(palabras.length)];
    const n = crypto.randomInt(10, 99);
    const tempPassword = `${a}${b}${n}!`;

    const newHash = bcrypt.hashSync(tempPassword, 10);
    await updatePage(user.pageId, { 'PasswordHash': prop_text(newHash) });

    res.json({ ok: true, usuario: user.id, passwordTemporal: tempPassword });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
