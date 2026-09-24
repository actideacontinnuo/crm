const express = require('express');
const router = express.Router();
const { queryDB, getRow, createRow, updateRow, archiveRow } = require('./db');

function toObj(row) {
  return {
    id:       row.id,
    nombre:   row.nombre || '',
    razon:    row.razon || '',
    rfc:      row.rfc || '',
    banco:    row.banco || '',
    clabe:    row.clabe || '',
    servicio: row.servicio || '',
    cond:     row.cond || '',
    factura:  row.emiteFactura ? 'Sí — emite factura' : 'No — solo recibo',
    emiteFactura: !!row.emiteFactura,
    contacto: row.contacto || '',
    tel:      row.tel || '',
    email:    row.email || '',
    notas:    row.notas || '',
  };
}

function toRow(data) {
  const row = {};
  if (data.nombre   !== undefined) row.nombre   = data.nombre;
  if (data.razon    !== undefined) row.razon    = data.razon;
  if (data.rfc      !== undefined) row.rfc      = data.rfc;
  if (data.banco    !== undefined) row.banco    = data.banco;
  if (data.clabe    !== undefined) row.clabe    = data.clabe;
  if (data.servicio !== undefined) row.servicio = data.servicio;
  if (data.cond     !== undefined) row.cond     = data.cond;
  if (data.emiteFactura !== undefined) row.emiteFactura = !!data.emiteFactura;
  if (data.contacto !== undefined) row.contacto = data.contacto;
  if (data.tel      !== undefined) row.tel      = data.tel;
  if (data.email    !== undefined) row.email    = data.email;
  if (data.notas    !== undefined) row.notas    = data.notas;
  return row;
}

router.get('/', async (req, res) => {
  try {
    const rows = await queryDB('proveedores', null, { field: 'nombre', direction: 'ascending' });
    res.json(rows.map(toObj));
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    res.json(toObj(await getRow('proveedores', req.params.id)));
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const created = await createRow('proveedores', toRow(req.body));
    res.json(toObj(created));
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.patch('/:id', async (req, res) => {
  try {
    const updated = await updateRow('proveedores', req.params.id, toRow(req.body));
    res.json(toObj(updated));
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await archiveRow('proveedores', req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

module.exports = router;
