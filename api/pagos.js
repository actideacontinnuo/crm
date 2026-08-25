const express = require('express');
const router = express.Router();
const {
  notion, queryDB, createPage, updatePage,
  prop_title, prop_text, prop_number, prop_select, prop_date, prop_checkbox,
  read_title, read_text, read_number, read_select, read_date, read_checkbox,
} = require('./notion');
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
// No se sobrescribe lo guardado en Notion — solo el estatus EFECTIVO que ve
// el resto de la app (Dashboard, notificaciones, pestaña Vencidos de Pagos).
function _hoyISO() { return new Date().toISOString().slice(0, 10); }
function _statusEfectivo(status, fechaAcordada) {
  if (status === 'Pendiente' && fechaAcordada && fechaAcordada < _hoyISO()) return 'Vencido';
  return status;
}

function toObj(page) {
  const p = page.properties;
  const fechaAcordada = read_date(p['Fecha Acordada']);
  return {
    id:            page.id,
    concepto:      read_title(p['Concepto']),
    tipo:          read_select(p['Tipo']),
    opId:          read_text(p['OP ID']),
    monto:         read_number(p['Monto']),
    fechaAcordada,
    fechaReal:     read_date(p['Fecha Real']),
    status:        _statusEfectivo(read_select(p['Status']), fechaAcordada),
    forma:         read_select(p['Forma de Pago']),
    ref:           read_text(p['Referencia']),
    comprobante:   read_checkbox(p['Comprobante']),
  };
}

function toProps(data) {
  const props = {};
  if (data.concepto      !== undefined) props['Concepto']      = prop_title(data.concepto);
  if (data.tipo          !== undefined) props['Tipo']          = prop_select(data.tipo);
  if (data.opId          !== undefined) props['OP ID']         = prop_text(data.opId);
  if (data.monto         !== undefined) props['Monto']         = prop_number(data.monto);
  if (data.fechaAcordada !== undefined) props['Fecha Acordada'] = prop_date(data.fechaAcordada);
  if (data.fechaReal     !== undefined) props['Fecha Real']    = prop_date(data.fechaReal);
  if (data.status        !== undefined) props['Status']        = prop_select(data.status);
  if (data.forma         !== undefined) props['Forma de Pago'] = prop_select(data.forma);
  if (data.ref           !== undefined) props['Referencia']    = prop_text(data.ref);
  if (data.comprobante   !== undefined) props['Comprobante']   = prop_checkbox(data.comprobante);
  return props;
}

router.get('/', async (req, res) => {
  try {
    const pages = await queryDB('pagos', null, [{ property: 'Fecha Acordada', direction: 'descending' }]);
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
    const page = await createPage('pagos', toProps(req.body));
    const obj = toObj(page);
    _logCobroSiAplica(req, obj);
    res.json(obj);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/:id', async (req, res) => {
  try {
    const page = await updatePage(req.params.id, toProps(req.body));
    const obj = toObj(page);
    _logCobroSiAplica(req, obj);
    res.json(obj);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
