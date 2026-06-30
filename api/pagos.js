const express = require('express');
const router = express.Router();
const {
  notion, queryDB, createPage, updatePage,
  prop_title, prop_text, prop_number, prop_select, prop_date, prop_checkbox,
  read_title, read_text, read_number, read_select, read_date, read_checkbox,
} = require('./notion');

function toObj(page) {
  const p = page.properties;
  return {
    id:            page.id,
    concepto:      read_title(p['Concepto']),
    tipo:          read_select(p['Tipo']),
    opId:          read_text(p['OP ID']),
    monto:         read_number(p['Monto']),
    fechaAcordada: read_date(p['Fecha Acordada']),
    fechaReal:     read_date(p['Fecha Real']),
    status:        read_select(p['Status']),
    forma:         read_select(p['Forma de Pago']),
    ref:           read_text(p['Referencia']),
    comprobante:   read_checkbox(p['Comprobante']),
  };
}

function toProps(data) {
  const props = {};
  if (data.concepto      !== undefined) props['Concepto']      = prop_title(data.concepto);
  if (data.tipo          !== undefined) props['Tipo']          = prop_select(data.tipo);
  if (data.opId          !== undefined) props['OP ID']         = prop_text(data.opId);
  if (data.monto         !== undefined) props['Monto']         = prop_number(data.monto);
  if (data.fechaAcordada !== undefined) props['Fecha Acordada'] = prop_date(data.fechaAcordada);
  if (data.fechaReal     !== undefined) props['Fecha Real']    = prop_date(data.fechaReal);
  if (data.status        !== undefined) props['Status']        = prop_select(data.status);
  if (data.forma         !== undefined) props['Forma de Pago'] = prop_select(data.forma);
  if (data.ref           !== undefined) props['Referencia']    = prop_text(data.ref);
  if (data.comprobante   !== undefined) props['Comprobante']   = prop_checkbox(data.comprobante);
  return props;
}

router.get('/', async (req, res) => {
  try {
    const pages = await queryDB('pagos', null, [{ property: 'Fecha Acordada', direction: 'descending' }]);
    res.json(pages.map(toObj));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const page = await notion.pages.retrieve({ page_id: req.params.id });
    res.json(toObj(page));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const page = await createPage('pagos', toProps(req.body));
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
