const express = require('express');
const router  = express.Router();
const { authMiddleware } = require('../middleware/auth');
const { queryDB, createPage, updatePage, prop_title, prop_number, read_number } = require('./notion');

function toObj(page) {
  const p = page.properties;
  return {
    pageId:       page.id,
    opsActivas:   read_number(p['OpsActivas']),
    cotizado:     read_number(p['Cotizado']),
    cobros:       read_number(p['Cobros']),
    pipeline:     read_number(p['Pipeline']),
    cliActivos:   read_number(p['ClientesActivos']),
    comisiones:   read_number(p['Comisiones']),
  };
}

// GET /api/objetivos/:mes  (ej. 2026-06)
router.get('/:mes', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Solo el Admin puede ver los objetivos' });
  try {
    const pages = await queryDB('objetivos', { property: 'Mes', title: { equals: req.params.mes } });
    res.json(pages.length ? toObj(pages[0]) : {});
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/objetivos/:mes  — solo admin
router.put('/:mes', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Solo el Admin puede modificar los objetivos' });
  try {
    const props = {};
    if (req.body.opsActivas !== undefined) props['OpsActivas']      = prop_number(req.body.opsActivas);
    if (req.body.cotizado   !== undefined) props['Cotizado']        = prop_number(req.body.cotizado);
    if (req.body.cobros     !== undefined) props['Cobros']          = prop_number(req.body.cobros);
    if (req.body.pipeline   !== undefined) props['Pipeline']        = prop_number(req.body.pipeline);
    if (req.body.cliActivos !== undefined) props['ClientesActivos'] = prop_number(req.body.cliActivos);
    if (req.body.comisiones !== undefined) props['Comisiones']      = prop_number(req.body.comisiones);

    const pages = await queryDB('objetivos', { property: 'Mes', title: { equals: req.params.mes } });
    let page;
    if (pages.length) {
      page = await updatePage(pages[0].id, props);
    } else {
      page = await createPage('objetivos', { 'Mes': prop_title(req.params.mes), ...props });
    }
    res.json({ ok: true, mes: req.params.mes, objetivos: toObj(page) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
