const express = require('express');
const router = express.Router();
const {
  notion, queryDB, createPage, updatePage, archivePage,
  prop_title, prop_text, prop_select, prop_checkbox, prop_email, prop_phone,
  read_title, read_text, read_select, read_checkbox, read_email, read_phone,
} = require('./notion');

function toObj(page) {
  const p = page.properties;
  return {
    id:       page.id,
    nombre:   read_title(p['Nombre']),
    razon:    read_text(p['Razón Social']),
    rfc:      read_text(p['RFC']),
    banco:    read_select(p['Banco']),
    clabe:    read_text(p['CLABE']),
    servicio: read_text(p['Servicio']),
    cond:     read_select(p['Condiciones de Pago']),
    factura:  read_checkbox(p['Emite Factura']) ? 'Sí — emite factura' : 'No — solo recibo',
    emiteFactura: read_checkbox(p['Emite Factura']),
    contacto: read_text(p['Contacto']),
    tel:      read_phone(p['Tel']),
    email:    read_email(p['Email']),
    notas:    read_text(p['Notas']),
  };
}

function toProps(data) {
  const props = {};
  if (data.nombre   !== undefined) props['Nombre']              = prop_title(data.nombre);
  if (data.razon    !== undefined) props['Razón Social']        = prop_text(data.razon);
  if (data.rfc      !== undefined) props['RFC']                 = prop_text(data.rfc);
  if (data.banco    !== undefined) props['Banco']               = prop_select(data.banco);
  if (data.clabe    !== undefined) props['CLABE']               = prop_text(data.clabe);
  if (data.servicio !== undefined) props['Servicio']            = prop_text(data.servicio);
  if (data.cond     !== undefined) props['Condiciones de Pago'] = prop_select(data.cond);
  if (data.emiteFactura !== undefined) props['Emite Factura']   = prop_checkbox(data.emiteFactura);
  if (data.contacto !== undefined) props['Contacto']            = prop_text(data.contacto);
  if (data.tel      !== undefined) props['Tel']                 = prop_phone(data.tel);
  if (data.email    !== undefined) props['Email']               = prop_email(data.email);
  if (data.notas    !== undefined) props['Notas']               = prop_text(data.notas);
  return props;
}

router.get('/', async (req, res) => {
  try {
    const pages = await queryDB('proveedores', null, [{ property: 'Nombre', direction: 'ascending' }]);
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
    const page = await createPage('proveedores', toProps(req.body));
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
