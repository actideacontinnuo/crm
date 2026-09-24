const express = require('express');
const router = express.Router();
const { queryDB, createRow, updateRow, transaccion } = require('./db');

// IVA mexicano. El gasto de proveedor se CAPTURA con IVA (como la factura) y el
// Estado de Resultados trabaja en NETO (costo, venta y utilidad, todo sin IVA).
const IVA_RATE = 0.16;
const netoDeConIva = conIva => Math.round((Number(conIva || 0) / (1 + IVA_RATE)) * 100) / 100;

// Una deuda tiene una COTIZACIÓN (lo comprometido con el proveedor, fijo desde
// que se registra) y un PAGADO (la suma de abonos — puede crecer con el tiempo
// sin nunca rebasar la cotización). Registrar un pago SIEMPRE abona a la deuda
// existente (ver POST /:id/abonar) — nunca crea un segundo registro, que era
// el bug real: antes cada abono generaba una deuda nueva y duplicaba el costo
// de la OP en la Utilidad y el Dashboard. Con Postgres, además, el abono corre
// dentro de una transacción con el renglón bloqueado (SELECT ... FOR UPDATE) —
// dos abonos simultáneos a la misma deuda ya no pueden pisarse entre sí, algo
// que Notion nunca pudo garantizar.
function _status(cotizacionConIva, pagadoConIva) {
  if (pagadoConIva <= 0) return 'pendiente';
  if (pagadoConIva >= cotizacionConIva) return 'pagado';
  return 'parcial';
}

// Reordena el row de Postgres (ya camelCase) al contrato que el frontend
// espera desde la época de Notion — 'provId' en vez de 'proveedorId', y los
// campos calculados 'debemos'/'debemosConIva'.
function toObj(row) {
  const cotizacionConIva = row.montoConIva ?? null;
  const pagadoConIva = row.pagadoConIva ?? 0;
  return {
    id:       row.id,
    concepto: row.concepto,
    provId:   row.proveedorId,
    opId:     row.opId,
    monto:    Number(row.monto) || 0,                     // neto sin IVA (cotización)
    montoConIva: cotizacionConIva !== null ? Number(cotizacionConIva) : null,
    pagado:      Number(row.pagado) || 0,                  // neto sin IVA abonado
    pagadoConIva: Number(pagadoConIva) || 0,
    debemos:        Math.max(0, (Number(row.monto) || 0) - (Number(row.pagado) || 0)),
    debemosConIva:  Math.max(0, (Number(cotizacionConIva ?? row.monto) || 0) - (Number(pagadoConIva) || 0)),
    fecha:         row.fechaAcordada,   // nombre legado
    fechaAcordada: row.fechaAcordada,   // nombre usado por el frontend (proveedores/control de pagos)
    status:   row.status,
  };
}

function toRow(data) {
  const row = {};
  if (data.concepto !== undefined) row.concepto     = data.concepto;
  if (data.provId   !== undefined) row.proveedorId  = data.provId || null;
  if (data.opId     !== undefined) row.opId         = data.opId || null;
  // Captura con IVA: el frontend manda 'montoConIva' (el total de la factura) y
  // el servidor deriva el neto ÷1.16 — autoridad del servidor, no se confía en
  // que el navegador mande el neto ya calculado. Se guardan LOS DOS: el con IVA
  // (lo que sale del banco) y el neto (el que cuenta para la utilidad).
  if (data.montoConIva !== undefined && data.montoConIva !== null) {
    const conIva = Number(data.montoConIva) || 0;
    row.montoConIva = conIva;
    row.monto       = netoDeConIva(conIva);
  } else if (data.monto !== undefined) {
    // Respaldo / compatibilidad: si algún flujo aún manda 'monto' directo (sin
    // IVA), se respeta tal cual — no se re-deriva nada.
    row.monto = data.monto;
  }
  // El frontend envía 'fechaAcordada'; aceptamos también el alias legado 'fecha'.
  if (data.fechaAcordada !== undefined) row.fechaAcordada = data.fechaAcordada || null;
  else if (data.fecha    !== undefined) row.fechaAcordada = data.fecha || null;
  return row;
}

router.get('/', async (req, res) => {
  try {
    const rows = await queryDB('deudas', null, { field: 'fechaAcordada', direction: 'ascending' });
    res.json(rows.map(toObj));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Alta de una deuda nueva — SIEMPRE arranca en 'pendiente', Pagado = 0. Los
// pagos posteriores NUNCA vuelven a llamar aquí: van por POST /:id/abonar.
router.post('/', async (req, res) => {
  try {
    const row = toRow(req.body);
    row.pagadoConIva = 0;
    row.pagado       = 0;
    row.status       = 'pendiente';
    const created = await createRow('deudas', row);
    res.json(toObj(created));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Edición de datos NO financieros de una deuda ya creada (concepto, fecha,
// proveedor/OP si se capturaron mal). NUNCA se usa para registrar un pago —
// eso es POST /:id/abonar. No acepta 'status' directo: el status siempre se
// deriva de Pagado vs Cotización (ver _status), nunca se fuerza a mano — así
// no puede quedar un "pagado" que no cuadra con lo realmente abonado.
router.patch('/:id', async (req, res) => {
  try {
    const updated = await updateRow('deudas', req.params.id, toRow(req.body));
    res.json(toObj(updated));
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// POST /api/deudas/:id/abonar  →  registra un ABONO a una deuda existente.
// Esta es la única forma correcta de registrar un pago a proveedor: suma al
// Pagado acumulado (nunca lo reemplaza, nunca crea un registro nuevo) y
// recalcula el status automáticamente. Corrige el bug reportado: antes cada
// pago (aunque fuera parcial) creaba una deuda nueva, duplicando el costo de
// la OP en la Utilidad y el Dashboard. Corre en una transacción con el
// renglón bloqueado — dos abonos simultáneos nunca se pisan.
router.post('/:id/abonar', async (req, res) => {
  try {
    const montoConIva = Number(req.body.montoConIva) || 0;
    if (montoConIva <= 0) return res.status(400).json({ error: 'El monto del abono debe ser mayor a 0' });

    let errorNegocio = null;
    const resultado = await transaccion(async (tx) => {
      const actual = toObj(await tx.getForUpdate('deudas', req.params.id));
      const cotizacionConIva = actual.montoConIva ?? actual.monto; // respaldo para deudas viejas sin 'Monto con IVA'

      const nuevoPagadoConIva = Math.round((actual.pagadoConIva + montoConIva) * 100) / 100;
      // No se permite abonar más de lo cotizado — evita un "debemos" negativo
      // que no tendría sentido de negocio (si la factura cambió, se edita la
      // cotización, no se sobre-abona).
      if (nuevoPagadoConIva > cotizacionConIva + 0.01) {
        errorNegocio = `El abono deja Pagado (${nuevoPagadoConIva.toFixed(2)}) por encima de lo cotizado (${cotizacionConIva.toFixed(2)}). Si la factura cambió, edita la cotización primero.`;
        return null;
      }
      const nuevoPagadoNeto = netoDeConIva(nuevoPagadoConIva);
      const nuevoStatus = _status(cotizacionConIva, nuevoPagadoConIva);

      return tx.update('deudas', req.params.id, {
        pagadoConIva: nuevoPagadoConIva,
        pagado:       nuevoPagadoNeto,
        status:       nuevoStatus,
      });
    });

    if (errorNegocio) return res.status(400).json({ error: errorNegocio });
    res.json(toObj(resultado));
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

module.exports = router;
