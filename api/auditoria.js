const express = require('express');
const router  = express.Router();
const { queryDB } = require('./db');

function toObj(row) {
  const fecha = row.fecha ? new Date(row.fecha).toISOString() : null;
  return {
    id:        row.id,
    evento:    `${row.accion} · ${row.usuario || 'anónimo'} · ${fecha || ''}`,
    usuario:   row.usuario || '',
    accion:    row.accion || '',
    entidad:   row.entidad || '',
    detalle:   row.detalle || '',
    ip:        row.ip || '',
    exito:     !!row.exito,
    fueraDeHorario: !!row.fueraDeHorario,
    fecha,
  };
}

// GET /api/auditoria?limit=200
router.get('/', async (req, res) => {
  try {
    const rows = await queryDB('auditoria', null, { field: 'fecha', direction: 'descending' });
    const limit = Math.min(parseInt(req.query.limit) || 200, 1000);
    res.json(rows.slice(0, limit).map(toObj));
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

module.exports = router;
