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
const netoDeConIva = conIva => Math.round((Number(conIva || 0) / (1 + IVA_RATE)) * 100) / 100;

// Una deuda tiene una COTIZACIÓN (lo comprometido con el proveedor, fijo desde
// que se registra) y un PAGADO (la suma de abonos — puede crecer con el tiempo
// sin nunca rebasar la cotización). Registrar un pago SIEMPRE abona a la deuda
// existente (ver POST /:id/abonar) — nunca crea un segundo registro, que era
// el bug real: antes cada abono generaba una deuda nueva y duplicaba el costo
// de la OP en la Utilidad y el Dashboard.
function _status(cotizacionConIva, pagadoConIva) {
  if (pagadoConIva <= 0) return 'pendiente';
  if (pagadoConIva >= cotizacionConIva) return 'pagado';
  return 'parcial';
}

function toObj(page) {
  const p = page.properties;
  const fecha = read_date(p['Fecha Acordada']);
  const cotizacionConIva = p['Monto con IVA']?.number ?? null;
  const pagadoConIva = p['Pagado con IVA']?.number ?? 0;
  // 'monto'/'montoConIva' = COTIZACIÓN (nombre legado, es lo que ya usaba el
  // resto del sistema — Utilidad, Estado de Resultados — como costo
  // comprometido; NUNCA cambia cuando se abona, confirmado con el usuario:
  // la Utilidad se calcula sobre lo cotizado, no sobre lo pagado).
  return {
    id:       page.id,
    concepto: read_title(p['Concepto']),
    provId:   read_text(p['Proveedor ID']),
    opId:     read_text(p['OP ID']),
    monto:    read_number(p['Monto']),                 // neto sin IVA (cotización)
    montoConIva: cotizacionConIva,                      // con IVA (cotización) — null en deudas viejas sin este campo
    pagado:      p['Pagado']?.number ?? 0,               // neto sin IVA abonado
    pagadoConIva,                                        // con IVA abonado
    debemos:        Math.max(0, read_number(p['Monto']) - (p['Pagado']?.number ?? 0)),
    debemosConIva:  Math.max(0, (cotizacionConIva ?? read_number(p['Monto'])) - pagadoConIva),
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
    props['Monto']         = prop_number(netoDeConIva(conIva));
  } else if (data.monto !== undefined) {
    // Respaldo / compatibilidad: si algún flujo aún manda 'monto' directo (sin
    // IVA), se respeta tal cual — no se re-deriva nada.
    props['Monto'] = prop_number(data.monto);
  }
  // El frontend envía 'fechaAcordada'; aceptamos también el alias legado 'fecha'.
  if (data.fechaAcordada !== undefined) props['Fecha Acordada'] = prop_date(data.fechaAcordada);
  else if (data.fecha    !== undefined) props['Fecha Acordada'] = prop_date(data.fecha);
  return props;
}

router.get('/', async (req, res) => {
  try {
    const pages = await queryDB('deudas', null, [{ property: 'Fecha Acordada', direction: 'ascending' }]);
    res.json(pages.map(toObj));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Alta de una deuda nueva — SIEMPRE arranca en 'pendiente', Pagado = 0. Los
// pagos posteriores NUNCA vuelven a llamar aquí: van por POST /:id/abonar.
router.post('/', async (req, res) => {
  try {
    const props = toProps(req.body);
    props['Pagado con IVA'] = prop_number(0);
    props['Pagado']         = prop_number(0);
    props['Status']         = prop_select('pendiente');
    const page = await createPage('deudas', props);
    res.json(toObj(page));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Edición de datos NO financieros de una deuda ya creada (concepto, fecha,
// proveedor/OP si se capturaron mal). NUNCA se usa para registrar un pago —
// eso es POST /:id/abonar. No acepta 'status' directo: el status siempre se
// deriva de Pagado vs Cotización (ver _status), nunca se fuerza a mano — así
// no puede quedar un "pagado" que no cuadra con lo realmente abonado.
router.patch('/:id', async (req, res) => {
  try {
    const page = await updatePage(req.params.id, toProps(req.body));
    res.json(toObj(page));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/deudas/:id/abonar  →  registra un ABONO a una deuda existente.
// Esta es la única forma correcta de registrar un pago a proveedor: suma al
// Pagado acumulado (nunca lo reemplaza, nunca crea un registro nuevo) y
// recalcula el status automáticamente. Corrige el bug reportado: antes cada
// pago (aunque fuera parcial) creaba una deuda nueva, duplicando el costo de
// la OP en la Utilidad y el Dashboard.
router.post('/:id/abonar', async (req, res) => {
  try {
    const montoConIva = Number(req.body.montoConIva) || 0;
    if (montoConIva <= 0) return res.status(400).json({ error: 'El monto del abono debe ser mayor a 0' });

    const existing = await notion.pages.retrieve({ page_id: req.params.id });
    const actual = toObj(existing);
    const cotizacionConIva = actual.montoConIva ?? actual.monto; // respaldo para deudas viejas sin 'Monto con IVA'

    const nuevoPagadoConIva = Math.round((actual.pagadoConIva + montoConIva) * 100) / 100;
    // No se permite abonar más de lo cotizado — evita un "debemos" negativo
    // que no tendría sentido de negocio (si la factura cambió, se edita la
    // cotización, no se sobre-abona).
    if (nuevoPagadoConIva > cotizacionConIva + 0.01) {
      return res.status(400).json({
        error: `El abono deja Pagado (${nuevoPagadoConIva.toFixed(2)}) por encima de lo cotizado (${cotizacionConIva.toFixed(2)}). Si la factura cambió, edita la cotización primero.`,
      });
    }
    const nuevoPagadoNeto = netoDeConIva(nuevoPagadoConIva);
    const nuevoStatus = _status(cotizacionConIva, nuevoPagadoConIva);

    const page = await updatePage(req.params.id, {
      'Pagado con IVA': prop_number(nuevoPagadoConIva),
      'Pagado':         prop_number(nuevoPagadoNeto),
      'Status':         prop_select(nuevoStatus),
    });
    res.json(toObj(page));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
