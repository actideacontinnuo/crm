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
    num:      read_title(p['Número OP']),
    desc:     read_text(p['Descripción']),
    cliente:  read_text(p['Cliente ID']),
    ejec:     read_select(p['Ejecutivo']),
    fecha:    read_date(p['Fecha Evento']),
    cotizado: read_number(p['Cotizado']),
    cobrado:  read_number(p['Cobrado']),
    utilidad: read_number(p['Utilidad']),
    status:   read_select(p['Status']),
  };
}

function toProps(data) {
  const props = {};
  if (data.num      !== undefined) props['Número OP']   = prop_title(data.num);
  if (data.desc     !== undefined) props['Descripción'] = prop_text(data.desc);
  if (data.cliente  !== undefined) props['Cliente ID']  = prop_text(data.cliente);
  if (data.ejec     !== undefined) props['Ejecutivo']   = prop_select(data.ejec);
  if (data.fecha    !== undefined) props['Fecha Evento'] = prop_date(data.fecha);
  if (data.cotizado !== undefined) props['Cotizado']    = prop_number(data.cotizado);
  if (data.cobrado  !== undefined) props['Cobrado']     = prop_number(data.cobrado);
  if (data.utilidad !== undefined) props['Utilidad']    = prop_number(data.utilidad);
  if (data.status   !== undefined) props['Status']      = prop_select(data.status);
  return props;
}

router.get('/', async (req, res) => {
  try {
    const pages = await queryDB('ops', null, [{ property: 'Fecha Evento', direction: 'descending' }]);
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
    const page = await createPage('ops', toProps(req.body));
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
