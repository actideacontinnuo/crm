const express = require('express');
const router = express.Router();
const { queryDB, getRow, createRow, updateRow, archiveRow } = require('./db');
const { assertRolAccess, perteneceAlRegistro } = require('./_guard');
const { aplicarReglasComision, obtenerRosterEjecutivos } = require('./_roles');
const { logAudit, clientIp } = require('./_audit');

// Código de cliente — FIJO al crear, jamás editable (ver PATCH: siempre se
// descarta). Formato confirmado: RFC(3)-EJECUTIVO DE CUENTA(3)-DDMMAA de la
// fecha de alta en el sistema. Se calcula AQUÍ (autoridad del servidor, con
// su propio reloj) — nunca se confía en un 'codigo' que mande el cliente,
// para que sea imposible de falsificar o desincronizar con la fecha real.
function _generarCodigoCliente(rfc, ejecCuenta) {
  const r = String(rfc || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 3) || 'XXX';
  const e = String(ejecCuenta || '').replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 3) || 'EJE';
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(2);
  return `${r}-${e}-${dd}${mm}${yy}`;
}

function toObj(row) {
  return {
    id:       row.id,
    nombre:   row.nombre || '',
    codigo:   row.codigo || '',
    razon:    row.razon || '',
    rfc:      row.rfc || '',
    dir:      row.dir || '',
    contacto: row.contacto || '',
    cargo:    row.cargo || '',
    tel:      row.tel || '',
    email:    row.email || '',
    ejec:         row.ejec || '',       // legado
    propietario:  row.propietario || '',
    ejecCuenta:   row.ejecCuenta || '',
    ejecAsignado: row.ejecAsignado || '',
    comision:     row.comision ?? null,
    pago:     row.pago || '',
    status:   row.status || '',
    docs:     row.docs || '',
  };
}

function toRow(data) {
  const row = {};
  if (data.nombre   !== undefined) row.nombre   = data.nombre;
  if (data.codigo   !== undefined) row.codigo   = data.codigo;
  if (data.razon    !== undefined) row.razon    = data.razon;
  if (data.rfc      !== undefined) row.rfc      = data.rfc;
  if (data.dir      !== undefined) row.dir      = data.dir;
  if (data.contacto !== undefined) row.contacto = data.contacto;
  if (data.cargo    !== undefined) row.cargo    = data.cargo;
  if (data.tel      !== undefined) row.tel      = data.tel;
  if (data.email    !== undefined) row.email    = data.email;
  if (data.ejec         !== undefined) row.ejec         = data.ejec;
  if (data.propietario  !== undefined) row.propietario  = data.propietario;
  if (data.ejecCuenta   !== undefined) row.ejecCuenta   = data.ejecCuenta;
  if (data.ejecAsignado !== undefined) row.ejecAsignado = data.ejecAsignado;
  if (data.comision     !== undefined) row.comision     = data.comision;
  if (data.pago     !== undefined) row.pago     = data.pago;
  if (data.status   !== undefined) row.status   = data.status;
  if (data.docs     !== undefined) row.docs     = typeof data.docs === 'object' ? JSON.stringify(data.docs) : String(data.docs);
  return row;
}

router.get('/', async (req, res) => {
  try {
    const rows = await queryDB('clientes', null, { field: 'nombre', direction: 'ascending' });
    let objs = rows.map(toObj);
    if (req.rolFilter) objs = objs.filter(o => perteneceAlRegistro(o, req.rolFilter));
    res.json(objs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const obj = toObj(await getRow('clientes', req.params.id));
    if (!assertRolAccess(req, res, obj)) return;
    res.json(obj);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const data = { ...req.body };
    // Reglas de comisión (los clientes no vienen de Apollo; ese origen es de prospectos)
    const ejecutivosRoster = await obtenerRosterEjecutivos();
    const r = aplicarReglasComision(data, { esApollo: false, ejecutivosRoster });
    data.propietario  = r.propietario;
    data.ejecCuenta   = r.ejecCuenta;
    data.ejecAsignado = r.ejecAsignado;
    // Comisión: al convertir un prospecto viene la comisión FIJA (incluso null) —
    // se respeta tal cual (§3.1). Si no viene la llave, se calcula con las reglas.
    if (!Object.prototype.hasOwnProperty.call(req.body, 'comision')) {
      data.comision = r.comision;
    }
    if (req.rolFilter && !data.propietario) {
      data.propietario = req.rolFilter;
      const r2 = aplicarReglasComision(data, { esApollo: false, ejecutivosRoster });
      data.ejecCuenta = r2.ejecCuenta;
      if (data.comision === null || data.comision === undefined) data.comision = r2.comision;
    }
    // Código de cliente: SIEMPRE se calcula aquí, con el ejecCuenta ya
    // resuelto — cualquier 'codigo' que haya mandado el cliente se ignora.
    data.codigo = _generarCodigoCliente(data.rfc, data.ejecCuenta);
    const created = await createRow('clientes', toRow(data));
    res.json(toObj(created));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/:id', async (req, res) => {
  try {
    const existingObj = toObj(await getRow('clientes', req.params.id));
    if (!assertRolAccess(req, res, existingObj)) return;
    const body = { ...req.body };
    // El PROPIETARIO de un cliente NUNCA cambia ni se reasigna (regla de negocio
    // confirmada). Como el Ejecutivo de cuenta se deriva del propietario, también
    // queda fijo. La comisión y el código tampoco se recalculan. Lo ÚNICO que se
    // puede reasignar por edición es el Ejecutivo ASIGNADO (quien lleva el evento).
    delete body.comision;
    delete body.codigo;
    delete body.propietario;
    delete body.ejecCuenta;
    const updated = await updateRow('clientes', req.params.id, toRow(body));
    const obj = toObj(updated);
    // Actividad Reciente (solo Dirección la ve, ver dashboard.js) — evento de
    // negocio real, no el CRUD crudo.
    logAudit({
      usuario: req.user?.ejec || req.user?.nombre || req.user?.id,
      accion: 'cliente_actualizado', entidad: obj.nombre || '',
      ip: clientIp(req), exito: true,
    });
    res.json(obj);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const existing = toObj(await getRow('clientes', req.params.id));
    if (!assertRolAccess(req, res, existing)) return;
    await archiveRow('clientes', req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

module.exports = router;
