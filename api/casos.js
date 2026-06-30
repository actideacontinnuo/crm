const express = require('express');
const router = express.Router();
const {
  notion, queryDB, createPage, updatePage,
  prop_title, prop_text, prop_select, prop_date,
  read_title, read_text, read_select, read_date,
} = require('./notion');

function toObj(page) {
  const p = page.properties;
  let historial = [];
  try { historial = JSON.parse(read_text(p['Historial']) || '[]'); } catch {}
  if (!Array.isArray(historial)) historial = [];
  return {
    id:       page.id,
    titulo:   read_title(p['Título']),
    clienteId: read_text(p['Cliente ID']),
    opId:     read_text(p['OP ID']) || null,
    tipo:     read_select(p['Tipo']),
    prio:     read_select(p['Prioridad']),
    quien:    read_text(p['Quién']),
    desc:     read_text(p['Descripción']),
    accion:   read_text(p['Acción Requerida']),
    status:   read_select(p['Status']),
    fecha:    read_date(p['Fecha']),
    historial,
  };
}

function toProps(data) {
  const props = {};
  if (data.titulo    !== undefined) props['Título']            = prop_title(data.titulo);
  if (data.clienteId !== undefined) props['Cliente ID']        = prop_text(data.clienteId);
  if (data.opId      !== undefined) props['OP ID']             = prop_text(data.opId || '');
  if (data.tipo      !== undefined) props['Tipo']              = prop_select(data.tipo);
  if (data.prio      !== undefined) props['Prioridad']         = prop_select(data.prio);
  if (data.quien     !== undefined) props['Quién']             = prop_text(data.quien);
  if (data.desc      !== undefined) props['Descripción']       = prop_text(data.desc);
  if (data.accion    !== undefined) props['Acción Requerida']  = prop_text(data.accion);
  if (data.status    !== undefined) props['Status']            = prop_select(data.status);
  if (data.fecha     !== undefined) props['Fecha']             = prop_date(data.fecha);
  if (data.historial !== undefined) {
    const json = JSON.stringify(Array.isArray(data.historial) ? data.historial : []);
    props['Historial'] = prop_text(json.substring(0, 1990));
  }
  return props;
}

router.get('/', async (req, res) => {
  try {
    const pages = await queryDB('casos', null, [{ property: 'Fecha', direction: 'descending' }]);
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
    const page = await createPage('casos', toProps(req.body));
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
