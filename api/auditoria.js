const express = require('express');
const router  = express.Router();
const {
  queryDB,
  read_title, read_text, read_select, read_checkbox, read_date,
} = require('./notion');

function toObj(page) {
  const p = page.properties;
  return {
    id:        page.id,
    evento:    read_title(p['Evento']),
    usuario:   read_text(p['Usuario']),
    accion:    read_select(p['Accion']),
    entidad:   read_text(p['Entidad']),
    detalle:   read_text(p['Detalle']),
    ip:        read_text(p['IP']),
    exito:     read_checkbox(p['Exito']),
    fueraDeHorario: read_checkbox(p['FueraDeHorario']),
    fecha:     read_date(p['Fecha']),
  };
}

// GET /api/auditoria?limit=200
router.get('/', async (req, res) => {
  try {
    const pages = await queryDB('auditoria', null, [{ property: 'Fecha', direction: 'descending' }]);
    const limit = Math.min(parseInt(req.query.limit) || 200, 1000);
    res.json(pages.slice(0, limit).map(toObj));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
