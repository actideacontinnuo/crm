const express = require('express');
const router = express.Router();
const { queryDB, getRow, createRow, updateRow } = require('./db');
const { logAudit, clientIp } = require('./_audit');

// Registra en Actividad Reciente (solo Dirección la ve) cuando un Cobro a
// cliente queda en Pagado — es el evento de negocio real, no el CRUD crudo.
function _logCobroSiAplica(req, obj) {
  if (obj.tipo === 'Cobro a cliente' && obj.status === 'Pagado') {
    logAudit({
      usuario: req.user?.ejec || req.user?.nombre || req.user?.id,
      accion: 'cobro_registrado',
      entidad: String(obj.monto || 0),
      detalle: obj.concepto || '',
      ip: clientIp(req), exito: true,
    });
  }
}

// "Vencido" se calcula SIEMPRE por fecha, no depende de que alguien lo marque
// a mano: un cobro/pago "Pendiente" cuya fecha acordada ya pasó es "Vencido".
// No se sobrescribe lo guardado en la base — solo el estatus EFECTIVO que ve
// el resto de la app (Dashboard, notificaciones, pestaña Vencidos de Pagos).
function _hoyISO() { return new Date().toISOString().slice(0, 10); }
function _statusEfectivo(status, fechaAcordada) {
  if (status === 'Pendiente' && fechaAcordada && fechaAcordada < _hoyISO()) return 'Vencido';
  return status;
}

function toObj(row) {
  return {
    id:            row.id,
    concepto:      row.concepto || '',
    tipo:          row.tipo || '',
    opId:          row.opId || '',
    monto:         Number(row.monto) || 0,
    fechaAcordada: row.fechaAcordada ?? null,
    fechaReal:     row.fechaReal ?? null,
    status:        _statusEfectivo(row.status || '', row.fechaAcordada),
    forma:         row.forma || '',
    ref:           row.ref || '',
    comprobante:   !!row.comprobante,
    // Cobro "extra": dinero cobrado al cliente por algo FUERA de la
    // cotización original de la OP (no estaba contemplado). Se desglosa aparte
    // en el Estado de Resultados — nunca se suma al Precio de Venta cotizado.
    extra:         !!row.extra,
  };
}

function toRow(data) {
  const row = {};
  if (data.concepto      !== undefined) row.concepto      = data.concepto;
  if (data.tipo          !== undefined) row.tipo          = data.tipo;
  if (data.opId          !== undefined) row.opId          = data.opId || null;
  if (data.monto         !== undefined) row.monto         = data.monto;
  if (data.fechaAcordada !== undefined) row.fechaAcordada = data.fechaAcordada || null;
  if (data.fechaReal     !== undefined) row.fechaReal     = data.fechaReal || null;
  if (data.status        !== undefined) row.status        = data.status;
  if (data.forma         !== undefined) row.forma         = data.forma;
  if (data.ref           !== undefined) row.ref           = data.ref;
  if (data.comprobante   !== undefined) row.comprobante   = !!data.comprobante;
  if (data.extra         !== undefined) row.extra         = !!data.extra;
  return row;
}

router.get('/', async (req, res) => {
  try {
    const rows = await queryDB('pagos', null, { field: 'fechaAcordada', direction: 'descending' });
    res.json(rows.map(toObj));
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    res.json(toObj(await getRow('pagos', req.params.id)));
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const created = await createRow('pagos', toRow(req.body));
    const obj = toObj(created);
    _logCobroSiAplica(req, obj);
    res.json(obj);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.patch('/:id', async (req, res) => {
  try {
    const updated = await updateRow('pagos', req.params.id, toRow(req.body));
    const obj = toObj(updated);
    _logCobroSiAplica(req, obj);
    res.json(obj);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

module.exports = router;
