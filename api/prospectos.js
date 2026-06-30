const express = require('express');
const router = express.Router();
const {
  notion, queryDB, createPage, updatePage, archivePage,
  prop_title, prop_text, prop_number, prop_select, prop_date, prop_email, prop_phone,
  read_title, read_text, read_number, read_select, read_date, read_email, read_phone,
} = require('./notion');

function toObj(page) {
  const p = page.properties;
  let notas = [];
  try { notas = JSON.parse(read_text(p['Notas']) || '[]'); } catch {}
  if (!Array.isArray(notas)) notas = [];
  return {
    id: page.id,
    empresa:     read_title(p['Empresa']),
    contacto:    read_text(p['Contacto']),
    cargo:       read_text(p['Cargo']),
    tel:         read_phone(p['Telefono']),
    email:       read_email(p['Email']),
    evento:      read_text(p['Evento']),
    estimado:    read_number(p['Estimado']),
    ejec:        read_select(p['Ejecutivo']),
    fuente:      read_select(p['Fuente']),
    status:      read_select(p['Status']),
    seguimiento: read_date(p['Seguimiento']),
    notas,
  };
}

function toProps(data) {
  const props = {};
  if (data.empresa     !== undefined) props['Empresa']     = prop_title(data.empresa);
  if (data.contacto    !== undefined) props['Contacto']    = prop_text(data.contacto);
  if (data.cargo       !== undefined) props['Cargo']       = prop_text(data.cargo);
  if (data.tel         !== undefined) props['Telefono']    = prop_phone(data.tel);
  if (data.email       !== undefined) props['Email']       = prop_email(data.email);
  if (data.evento      !== undefined) props['Evento']      = prop_text(data.evento);
  if (data.estimado    !== undefined) props['Estimado']    = prop_number(data.estimado);
  if (data.ejec        !== undefined) props['Ejecutivo']   = prop_select(data.ejec);
  if (data.fuente      !== undefined) props['Fuente']      = prop_select(data.fuente);
  if (data.status      !== undefined) props['Status']      = prop_select(data.status);
  if (data.seguimiento !== undefined) props['Seguimiento'] = prop_date(data.seguimiento);
  if (data.notas       !== undefined) {
    const json = JSON.stringify(Array.isArray(data.notas) ? data.notas : []);
    props['Notas'] = prop_text(json.substring(0, 1990));
  }
  return props;
}

router.get('/', async (req, res) => {
  try {
    const filter = req.ejecFilter
      ? { property: 'Ejecutivo', select: { equals: req.ejecFilter } }
      : null;
    const pages = await queryDB('prospectos', filter, [{ property: 'Empresa', direction: 'ascending' }]);
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
    const page = await createPage('prospectos', toProps(req.body));
    res.json(toObj(page));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/:id', async (req, res) => {
  try {
    // These fields are immutable after creation — strip them from any update
    const body = { ...req.body };
    delete body.empresa;
    delete body.contacto;
    delete body.tel;
    delete body.email;
    const page = await updatePage(req.params.id, toProps(body));
    res.json(toObj(page));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await archivePage(req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
