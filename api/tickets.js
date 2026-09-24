const express = require('express');
const router = express.Router();
const { queryDB, getRow, createRow, updateRow } = require('./db');
const { perteneceAlRegistro } = require('./_guard');

function toObj(row) {
  return {
    id:       row.id,
    tipo:     row.tipo || '',
    cotId:    row.cotizacionId || '',
    monto:    row.montoAfectado || '',
    quien:    row.quien || '',
    motivo:   row.motivo || '',
    status:   row.status || '',
    fecha:    row.fecha ?? null,
  };
}

function toRow(data) {
  const row = {};
  if (data.tipo   !== undefined) row.tipo          = data.tipo;
  if (data.cotId  !== undefined) row.cotizacionId  = data.cotId || null;
  if (data.monto  !== undefined) row.montoAfectado = data.monto;
  if (data.quien  !== undefined) row.quien         = data.quien;
  if (data.motivo !== undefined) row.motivo        = data.motivo;
  if (data.status !== undefined) row.status        = data.status;
  if (data.fecha  !== undefined) row.fecha         = data.fecha || null;
  return row;
}

// Un ticket no tiene columnas de rol propias — hereda los 3 roles de la
// cotización a la que está ligado (mismo criterio que api/casos.js).
async function _rolesEnlazados(cotId) {
  const vacio = { propietario: '', ejecCuenta: '', ejecAsignado: '', ejec: '' };
  if (!cotId) return vacio;
  try {
    const reg = await getRow('cotizaciones', cotId);
    return {
      propietario:  reg.propietario || '',
      ejecCuenta:   reg.ejecCuenta || '',
      ejecAsignado: reg.ejecAsignado || '',
      ejec:         reg.ejec || '',
    };
  } catch (_) {
    return vacio; // cotId inválido o inaccesible — no participa
  }
}

router.get('/', async (req, res) => {
  try {
    const rows = await queryDB('tickets', null, { field: 'fecha', direction: 'descending' });
    let objs = rows.map(toObj);
    if (req.rolFilter) {
      const roles = await Promise.all(objs.map(o => _rolesEnlazados(o.cotId)));
      objs = objs.filter((o, i) => perteneceAlRegistro(roles[i], req.rolFilter));
    }
    res.json(objs);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    if (req.rolFilter) {
      const roles = await _rolesEnlazados(req.body.cotId);
      if (!perteneceAlRegistro(roles, req.rolFilter)) {
        return res.status(403).json({ error: 'No tienes permiso para crear un ticket en esta cotización' });
      }
    }
    res.json(toObj(await createRow('tickets', toRow(req.body))));
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.patch('/:id', async (req, res) => {
  try {
    const existingObj = toObj(await getRow('tickets', req.params.id));
    if (req.rolFilter) {
      const roles = await _rolesEnlazados(existingObj.cotId);
      if (!perteneceAlRegistro(roles, req.rolFilter)) {
        return res.status(403).json({ error: 'No tienes permiso para modificar este ticket' });
      }
    }
    res.json(toObj(await updateRow('tickets', req.params.id, toRow(req.body))));
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

module.exports = router;
