const express = require('express');
const router = express.Router();
const {
  notion, queryDB, createPage, updatePage,
  prop_title, prop_text, prop_number, prop_select, prop_date,
  read_title, read_text, read_number, read_select, read_date,
} = require('./notion');
const { assertOwnership, forceOwnerOnCreate } = require('./_guard');

function toObj(page) {
  const p = page.properties;
  let secciones = { audio: [], esceno: [], logistica: [], catering: [], otros: [] };
  try {
    const parsed = JSON.parse(read_text(p['Secciones']) || '{}');
    if (parsed && typeof parsed === 'object') secciones = { ...secciones, ...parsed };
  } catch {}
  return {
    id:        page.id,
    cotId:     read_title(p['ID Cot']),
    opId:      read_text(p['OP ID']),
    clienteId: read_text(p['Cliente ID']),
    version:   read_text(p['Versión']),
    fecha:     read_date(p['Fecha']),
    status:    read_select(p['Status']),
    subtotal:  read_number(p['Subtotal']),
    fee:       read_number(p['Fee %']),
    iva:       read_number(p['IVA']),
    total:     read_number(p['Total con IVA']),
    ejec:      read_select(p['Ejecutivo']),
    secciones,
  };
}

function toProps(data) {
  const props = {};
  if (data.cotId     !== undefined) props['ID Cot']       = prop_title(data.cotId);
  if (data.opId      !== undefined) props['OP ID']        = prop_text(data.opId);
  if (data.clienteId !== undefined) props['Cliente ID']   = prop_text(data.clienteId);
  if (data.version   !== undefined) props['Versión']      = prop_text(data.version);
  if (data.fecha     !== undefined) props['Fecha']        = prop_date(data.fecha);
  if (data.status    !== undefined) props['Status']       = prop_select(data.status);
  if (data.subtotal  !== undefined) props['Subtotal']     = prop_number(data.subtotal);
  if (data.fee       !== undefined) props['Fee %']        = prop_number(data.fee);
  if (data.iva       !== undefined) props['IVA']          = prop_number(data.iva);
  if (data.total     !== undefined) props['Total con IVA'] = prop_number(data.total);
  if (data.ejec      !== undefined) props['Ejecutivo']    = prop_select(data.ejec);
  if (data.secciones !== undefined) {
    const json = JSON.stringify(data.secciones);
    props['Secciones'] = prop_text(json.substring(0, 1990));
  }
  return props;
}

router.get('/', async (req, res) => {
  try {
    const filter = req.ejecFilter
      ? { property: 'Ejecutivo', select: { equals: req.ejecFilter } }
      : null;
    const pages = await queryDB('cotizaciones', filter, [{ property: 'Fecha', direction: 'descending' }]);
    res.json(pages.map(toObj));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const page = await notion.pages.retrieve({ page_id: req.params.id });
    const obj = toObj(page);
    if (!assertOwnership(req, res, obj.ejec)) return;
    res.json(obj);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const data = forceOwnerOnCreate(req, { ...req.body });
    const page = await createPage('cotizaciones', toProps(data));
    res.json(toObj(page));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/:id', async (req, res) => {
  try {
    const existing = await notion.pages.retrieve({ page_id: req.params.id });
    if (!assertOwnership(req, res, toObj(existing).ejec)) return;
    const body = { ...req.body };
    if (req.ejecFilter) delete body.ejec;
    const page = await updatePage(req.params.id, toProps(body));
    res.json(toObj(page));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
