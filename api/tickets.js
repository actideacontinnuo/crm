const express = require('express');
const router = express.Router();
const {
  notion, queryDB, createPage, updatePage,
  prop_title, prop_text, prop_select, prop_date,
  read_title, read_text, read_select, read_date,
} = require('./notion');

function toObj(page) {
  const p = page.properties;
  return {
    id:       page.id,
    tipo:     read_title(p['Tipo']),
    cotId:    read_text(p['Cotización ID']),
    monto:    read_text(p['Monto Afectado']),
    quien:    read_text(p['Quién']),
    motivo:   read_text(p['Motivo']),
    status:   read_select(p['Status']),
    fecha:    read_date(p['Fecha']),
  };
}

function toProps(data) {
  const props = {};
  if (data.tipo   !== undefined) props['Tipo']           = prop_title(data.tipo);
  if (data.cotId  !== undefined) props['Cotización ID']  = prop_text(data.cotId);
  if (data.monto  !== undefined) props['Monto Afectado'] = prop_text(data.monto);
  if (data.quien  !== undefined) props['Quién']          = prop_text(data.quien);
  if (data.motivo !== undefined) props['Motivo']         = prop_text(data.motivo);
  if (data.status !== undefined) props['Status']         = prop_select(data.status);
  if (data.fecha  !== undefined) props['Fecha']          = prop_date(data.fecha);
  return props;
}

router.get('/', async (req, res) => {
  try {
    const pages = await queryDB('tickets', null, [{ property: 'Fecha', direction: 'descending' }]);
    res.json(pages.map(toObj));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const page = await createPage('tickets', toProps(req.body));
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
