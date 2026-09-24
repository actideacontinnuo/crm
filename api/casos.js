const express = require('express');
const router = express.Router();
const { queryDB, getRow, createRow, updateRow } = require('./db');
const { perteneceAlRegistro } = require('./_guard');

function toObj(row) {
  let historial = row.historial;
  if (typeof historial === 'string') { try { historial = JSON.parse(historial); } catch { historial = []; } }
  if (!Array.isArray(historial)) historial = [];
  return {
    id:       row.id,
    titulo:   row.titulo || '',
    clienteId: row.clienteId || '',
    opId:     row.opId || null,
    tipo:     row.tipo || '',
    prio:     row.prioridad || '',
    quien:    row.quien || '',
    desc:     row.descripcion || '',
    accion:   row.accionRequerida || '',
    status:   row.status || '',
    fecha:    row.fecha ?? null,
    historial,
  };
}

const _uuidONull = v => (!v || v === '__interno__') ? null : v;

function toRow(data) {
  const row = {};
  if (data.titulo    !== undefined) row.titulo          = data.titulo;
  if (data.clienteId !== undefined) row.clienteId       = _uuidONull(data.clienteId);
  if (data.opId      !== undefined) row.opId            = _uuidONull(data.opId);
  if (data.tipo      !== undefined) row.tipo            = data.tipo;
  if (data.prio      !== undefined) row.prioridad       = data.prio;
  if (data.quien     !== undefined) row.quien           = data.quien;
  if (data.desc      !== undefined) row.descripcion     = data.desc;
  if (data.accion    !== undefined) row.accionRequerida = data.accion;
  if (data.status    !== undefined) row.status          = data.status;
  if (data.fecha     !== undefined) row.fecha           = data.fecha || null;
  if (data.historial !== undefined) row.historial       = JSON.stringify(Array.isArray(data.historial) ? data.historial : []);
  return row;
}

// Un caso no tiene columnas de rol propias — hereda los 3 roles del registro al
// que está ligado (la OP si existe, si no el cliente directo), igual que hacen
// las cotizaciones con _heredarRoles en api/cotizaciones.js.
async function _rolesEnlazados(clienteId, opId) {
  const vacio = { propietario: '', ejecCuenta: '', ejecAsignado: '', ejec: '' };
  const targetId = opId || clienteId;
  if (!targetId || targetId === '__interno__') return vacio;
  try {
    const reg = await getRow(opId ? 'ops' : 'clientes', targetId);
    return {
      propietario:  reg.propietario || '',
      ejecCuenta:   reg.ejecCuenta || '',
      ejecAsignado: reg.ejecAsignado || '',
      ejec:         reg.ejec || '',
    };
  } catch (_) {
    return vacio; // clienteId/opId inválido o inaccesible — no participa
  }
}

router.get('/', async (req, res) => {
  try {
    const rows = await queryDB('casos', null, { field: 'fecha', direction: 'descending' });
    let objs = rows.map(toObj);
    if (req.rolFilter) {
      const roles = await Promise.all(objs.map(o => _rolesEnlazados(o.clienteId, o.opId)));
      objs = objs.filter((o, i) => perteneceAlRegistro(roles[i], req.rolFilter));
    }
    res.json(objs);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const obj = toObj(await getRow('casos', req.params.id));
    if (req.rolFilter) {
      const roles = await _rolesEnlazados(obj.clienteId, obj.opId);
      if (!perteneceAlRegistro(roles, req.rolFilter)) {
        return res.status(403).json({ error: 'No tienes permiso para ver este caso' });
      }
    }
    res.json(obj);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    if (req.rolFilter) {
      const roles = await _rolesEnlazados(req.body.clienteId, req.body.opId);
      if (!perteneceAlRegistro(roles, req.rolFilter)) {
        return res.status(403).json({ error: 'No tienes permiso para crear un caso en este cliente/OP' });
      }
    }
    res.json(toObj(await createRow('casos', toRow(req.body))));
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.patch('/:id', async (req, res) => {
  try {
    const existingObj = toObj(await getRow('casos', req.params.id));
    if (req.rolFilter) {
      const roles = await _rolesEnlazados(existingObj.clienteId, existingObj.opId);
      if (!perteneceAlRegistro(roles, req.rolFilter)) {
        return res.status(403).json({ error: 'No tienes permiso para modificar este caso' });
      }
    }
    res.json(toObj(await updateRow('casos', req.params.id, toRow(req.body))));
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

module.exports = router;
