const express = require('express');
const router = express.Router();
const {
  notion, queryDB, createPage, updatePage,
  prop_title, prop_text, prop_number, prop_select, prop_date,
  read_title, read_text, read_number, read_select, read_date,
} = require('./notion');

function toObj(page) {
  const p = page.properties;
  return {
    id:       page.id,
    concepto: read_title(p['Concepto']),
    provId:   read_text(p['Proveedor ID']),
    opId:     read_text(p['OP ID']),
    monto:    read_number(p['Monto']),
    fecha:    read_date(p['Fecha Acordada']),
    status:   read_select(p['Status']),
  };
}

function toProps(data) {
  const props = {};
  if (data.concepto !== undefined) props['Concepto']      = prop_title(data.concepto);
  if (data.provId   !== undefined) props['Proveedor ID']  = prop_text(data.provId);
  if (data.opId     !== undefined) props['OP ID']         = prop_text(data.opId);
  if (data.monto    !== undefined) props['Monto']         = prop_number(data.monto);
  if (data.fecha    !== undefined) props['Fecha Acordada'] = prop_date(data.fecha);
  if (data.status   !== undefined) props['Status']        = prop_select(data.status);
  return props;
}

router.get('/', async (req, res) => {
  try {
    const pages = await queryDB('deudas', null, [{ property: 'Fecha Acordada', direction: 'ascending' }]);
    res.json(pages.map(toObj));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const page = await createPage('deudas', toProps(req.body));
    res.json(toObj(page));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/:id', async (req, res) => {
  try {
    const page = await updatePage(req.params.id, toProps(req.body));
    res.json(toObj(page));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
