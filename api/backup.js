const express = require('express');
const router  = express.Router();
const { runBackup } = require('../jobs/backup');

// POST /api/backup/export — genera el respaldo ahora, lo envía por correo (si está configurado)
// y además lo regresa para descarga directa desde el navegador.
router.post('/export', async (req, res) => {
  try {
    const { data, emailResult } = await runBackup({ trigger: 'manual', usuario: req.user.id });
    res.json({ ok: true, emailResult, backup: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
