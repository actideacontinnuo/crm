const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');
const { authMiddleware } = require('../middleware/auth');

const FILE = path.join(__dirname, '../data/objetivos.json');
const read  = () => JSON.parse(fs.readFileSync(FILE, 'utf8'));
const write = (d) => fs.writeFileSync(FILE, JSON.stringify(d, null, 2));

// GET /api/objetivos/:mes  (ej. 2026-06)
router.get('/:mes', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Solo el Admin puede ver los objetivos' });
  const data = read();
  res.json(data[req.params.mes] || {});
});

// PUT /api/objetivos/:mes  — solo admin
router.put('/:mes', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Solo el Admin puede modificar los objetivos' });
  const data = read();
  data[req.params.mes] = { ...data[req.params.mes], ...req.body };
  write(data);
  res.json({ ok: true, mes: req.params.mes, objetivos: data[req.params.mes] });
});

module.exports = router;
