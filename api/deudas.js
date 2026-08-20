const express = require('express');
const router = express.Router();
const {
  notion, queryDB, createPage, updatePage,
  prop_title, prop_text, prop_number, prop_select, prop_date,
  read_title, read_text, read_number, read_select, read_date,
} = require('./notion');

// IVA mexicano. El gasto de proveedor se CAPTURA con IVA (como la factura) y el
// Estado de Resultados trabaja en NETO (costo, venta y utilidad, todo sin IVA).
const IVA_RATE = 0.16;

function toObj(page) {
  const p = page.properties;
  const fecha = read_date(p['Fecha Acordada']);
  return {
    id:       page.id,
    concepto: read_title(p['Concepto']),
    provId:   read_text(p['Proveedor ID']),
    opId:     read_text(p['OP ID']),
    // 'monto' es el NETO sin IVA — el que resta en la Utilidad (no cambia la
    // fórmula del Estado de Resultados, solo se garantiza que sea neto).
    monto:    read_number(p['Monto']),
    // Lo que realmente se le paga al proveedor (factura con IVA). null en deudas
    // viejas capturadas antes de este campo — ahí 'monto' se conserva tal cual.
    montoConIva: p['Monto con IVA']?.number ?? null,
    fecha,                 // nombre legado
    fechaAcordada: fecha,  // nombre usado por el frontend (proveedores/control de pagos)
    status:   read_select(p['Status']),
  };
}

function toProps(data) {
  const props = {};
  if (data.concepto !== undefined) props['Concepto']      = prop_title(data.concepto);
  if (data.provId   !== undefined) props['Proveedor ID']  = prop_text(data.provId);
  if (data.opId     !== undefined) props['OP ID']         = prop_text(data.opId);
  // Captura con IVA: el frontend manda 'montoConIva' (el total de la factura) y
  // el servidor deriva el neto ÷1.16 — autoridad del servidor, no se confía en
  // que el navegador mande el neto ya calculado. Se guardan LOS DOS: el con IVA
  // (lo que sale del banco) y el neto (el que cuenta para la utilidad).
  if (data.montoConIva !== undefined && data.montoConIva !== null) {
    const conIva = Number(data.montoConIva) || 0;
    props['Monto con IVA'] = prop_number(conIva);
    props['Monto']         = prop_number(Math.round((conIva / (1 + IVA_RATE)) * 100) / 100);
  } else if (data.monto !== undefined) {
    // Respaldo / compatibilidad: si algún flujo aún manda 'monto' directo (sin
    // IVA), se respeta tal cual — no se re-deriva nada.
    props['Monto'] = prop_number(data.monto);
  }
  // El frontend envía 'fechaAcordada'; aceptamos también el alias legado 'fecha'.
  if (data.fechaAcordada !== undefined) props['Fecha Acordada'] = prop_date(data.fechaAcordada);
  else if (data.fecha    !== undefined) props['Fecha Acordada'] = prop_date(data.fecha);
  if (data.status   !== undefined) props['Status']        = prop_select(data.status);
  return props;
}

router.get('/', async (req, res) => {
  try {
    const pages = await queryDB('deudas', null, [{ property: 'Fecha Acordada', direction: 'ascending' }]);
    res.json(pages.map(toObj));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const page = await createPage('deudas', toProps(req.body));
    res.json(toObj(page));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/:id', async (req, res) => {
  try {
    const page = await updatePage(req.params.id, toProps(req.body));
    res.json(toObj(page));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
