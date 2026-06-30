const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const fs      = require('fs');
const path    = require('path');
const { SECRET } = require('../middleware/auth');

const USERS_FILE = path.join(__dirname, '../data/users.json');
const getUsers   = () => JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));

router.post('/login', (req, res) => {
  const { usuario, password } = req.body;
  if (!usuario || !password) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });

  const users = getUsers();
  const user  = users.find(u => u.id === usuario.toLowerCase().trim());
  if (!user || !bcrypt.compareSync(password, user.hash))
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });

  const token = jwt.sign(
    { id: user.id, nombre: user.nombre, role: user.role, ejec: user.ejec },
    SECRET,
    { expiresIn: '12h' }
  );
  res.json({ token, id: user.id, nombre: user.nombre, role: user.role, ejec: user.ejec });
});

router.post('/cambiar-password', require('../middleware/auth').authMiddleware, (req, res) => {
  const { passwordActual, passwordNuevo } = req.body;
  if (!passwordActual || !passwordNuevo) return res.status(400).json({ error: 'Faltan campos' });
  if (passwordNuevo.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });

  const users = getUsers();
  const idx   = users.findIndex(u => u.id === req.user.id);
  if (idx === -1) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (!bcrypt.compareSync(passwordActual, users[idx].hash))
    return res.status(401).json({ error: 'Contraseña actual incorrecta' });

  users[idx].hash = bcrypt.hashSync(passwordNuevo, 10);
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  res.json({ ok: true });
});

module.exports = router;
