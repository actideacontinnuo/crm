const express = require('express');
const router = express.Router();
const {
  notion, queryDB, createPage, updatePage, archivePage,
  prop_title, prop_text, prop_select, prop_email, prop_phone,
  read_title, read_text, read_select, read_email, read_phone,
} = require('./notion');

function toObj(page) {
  const p = page.properties;
  return {
    id:      page.id,
    nombre:  read_title(p['Nombre']),
    codigo:  read_text(p['Codigo']),
    razon:   read_text(p['Razon Social']),
    rfc:     read_text(p['RFC']),
    dir:     read_text(p['Direccion']),
    contacto: read_text(p['Contacto']),
    cargo:   read_text(p['Cargo']),
    tel:     read_phone(p['Telefono']),
    email:   read_email(p['Email']),
    ejec:    read_select(p['Ejecutivo']),
    pago:    read_select(p['Condiciones de Pago']),
    status:  read_select(p['Status']),
    docs:    read_text(p['Docs']),
  };
}

function toProps(data) {
  const props = {};
  if (data.nombre   !== undefined) props['Nombre']             = prop_title(data.nombre);
  if (data.codigo   !== undefined) props['Codigo']             = prop_text(data.codigo);
  if (data.razon    !== undefined) props['Razon Social']       = prop_text(data.razon);
  if (data.rfc      !== undefined) props['RFC']                = prop_text(data.rfc);
  if (data.dir      !== undefined) props['Direccion']          = prop_text(data.dir);
  if (data.contacto !== undefined) props['Contacto']           = prop_text(data.contacto);
  if (data.cargo    !== undefined) props['Cargo']              = prop_text(data.cargo);
  if (data.tel      !== undefined) props['Telefono']           = prop_phone(data.tel);
  if (data.email    !== undefined) props['Email']              = prop_email(data.email);
  if (data.ejec     !== undefined) props['Ejecutivo']          = prop_select(data.ejec);
  if (data.pago     !== undefined) props['Condiciones de Pago'] = prop_select(data.pago);
  if (data.status   !== undefined) props['Status']             = prop_select(data.status);
  if (data.docs     !== undefined) props['Docs']               = prop_text(
    typeof data.docs === 'object' ? JSON.stringify(data.docs) : String(data.docs)
  );
  return props;
}

router.get('/', async (req, res) => {
  try {
    const filter = req.ejecFilter
      ? { property: 'Ejecutivo', select: { equals: req.ejecFilter } }
      : null;
    const pages = await queryDB('clientes', filter, [{ property: 'Nombre', direction: 'ascending' }]);
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
    const page = await createPage('clientes', toProps(req.body));
    res.json(toObj(page));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/:id', async (req, res) => {
  try {
    const page = await updatePage(req.params.id, toProps(req.body));
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
