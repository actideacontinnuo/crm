const express = require('express');
const router = express.Router();
const { queryDB, getRow, createRow, updateRow } = require('./db');
const { assertRolAccess, esOficinaTotal, perteneceAlRegistro } = require('./_guard');
const { logAudit, clientIp } = require('./_audit');

function toObj(row) {
  return {
    id:         row.id,
    num:        row.numero || '',
    numero:     row.numero || '',
    desc:       row.descripcion || '',
    clienteId:  row.clienteId || '',
    ejec:       row.ejec || '',               // legado / operativo
    propietario:  row.propietario || '',      // heredados del cliente (jerarquía)
    ejecCuenta:   row.ejecCuenta || '',
    ejecAsignado: row.ejecAsignado || '',
    fechaEvento: row.fechaEvento ?? null,
    cotizado:   Number(row.cotizado) || 0,
    cobrado:    Number(row.cobrado) || 0,
    utilidad:   Number(row.utilidad) || 0,
    status:     row.status || '',
    bono:       row.bono || '',
    // % de comisión del ejecutivo — heredado del Cliente al crear la OP (Regla
    // 2 = 15%, Regla 3 = 7.5%, ver api/_roles.js) y FIJO desde entonces, igual
    // que ya se hace con la comisión de Clientes/Prospectos: no se recalcula
    // si el cliente cambia de dueño después. null en OPs viejas (antes de este
    // campo) — se sigue mostrando 7.5% como respaldo, no un dato inventado.
    comision:   row.comision ?? null,
  };
}

function toRow(data) {
  const row = {};
  if (data.num    !== undefined) row.numero = data.num;
  else if (data.numero !== undefined) row.numero = data.numero;
  if (data.desc      !== undefined) row.descripcion = data.desc;
  if (data.clienteId !== undefined) row.clienteId = data.clienteId;
  if (data.ejec      !== undefined) row.ejec = data.ejec;
  if (data.propietario  !== undefined) row.propietario  = data.propietario;
  if (data.ejecCuenta   !== undefined) row.ejecCuenta   = data.ejecCuenta;
  if (data.ejecAsignado !== undefined) row.ejecAsignado = data.ejecAsignado;
  if (data.fechaEvento !== undefined) row.fechaEvento = data.fechaEvento || null;
  else if (data.fecha  !== undefined) row.fechaEvento = data.fecha || null;
  if (data.cotizado !== undefined) row.cotizado = data.cotizado;
  if (data.status   !== undefined) row.status   = data.status;
  if (data.bono     !== undefined) row.bono     = data.bono;
  if (data.comision !== undefined) row.comision = data.comision;
  return row;
}

// Datos del cliente que la OP necesita HEREDAR al crearse — código (para el
// número) y los 3 roles comerciales. Una sola lectura a Postgres, autoridad
// del servidor: nunca se confía en lo que mande el cliente HTTP para ninguno
// de estos campos (mismo criterio que api/clientes.js _generarCodigoCliente).
async function _datosClienteParaOP(clienteId) {
  const vacio = { codigo: '', propietario: '', ejecCuenta: '', ejecAsignado: '', comision: null };
  if (!clienteId || clienteId === '__interno__') return vacio;
  try {
    const cliente = await getRow('clientes', clienteId);
    return {
      codigo:       cliente.codigo || '',
      propietario:  cliente.propietario || '',
      ejecCuenta:   cliente.ejecCuenta || '',
      ejecAsignado: cliente.ejecAsignado || '',
      comision:     cliente.comision ?? null,
    };
  } catch (_) {
    return vacio; // clienteId inválido/inexistente — no se puede heredar nada
  }
}

// Número de OP — FIJO al crear, jamás editable por reasignación de ejecutivo.
// Formato confirmado: {código del cliente}-{consecutivo por cliente, 01/02/03...}
// Si la OP es interna (sin cliente) o el cliente no tiene código aún, se
// conserva el comportamiento previo — no hay de dónde derivar un consecutivo.
async function _generarNumeroOP(clienteId, codigoCliente) {
  if (!clienteId || clienteId === '__interno__' || !codigoCliente) return null;
  const opsDelCliente = await queryDB('ops', { clienteId });
  const consecutivo = String(opsDelCliente.length + 1).padStart(2, '0');
  return `${codigoCliente}-${consecutivo}`;
}

// Utilidad = cotizado − costos reales de proveedores (Deudas ligadas a la OP).
// ÚNICA fuente de verdad para toda la app (Dashboard, Estado de Resultados,
// Comercial, tabla de OPs, comisión 7.5%) — ya NO se captura a mano ni se
// autocompleta con un porcentaje inventado al marcar la OP como Ejecutada.
async function withUtilidadReal(objs) {
  let deudas;
  try {
    deudas = await queryDB('deudas', null);
  } catch (_) {
    // Si Postgres falla al traer los costos, no reventamos el listado de OPs
    // — se conserva el valor bruto ya guardado (respaldo, puede estar desfasado).
    return objs;
  }
  const costosPorOP = {};
  deudas.forEach(d => {
    if (!d.opId) return;
    costosPorOP[d.opId] = (costosPorOP[d.opId] || 0) + (Number(d.monto) || 0);
  });
  return objs.map(o => ({
    ...o,
    utilidad: Math.round((o.cotizado || 0) - (costosPorOP[o.id] || 0)),
    costosReales: costosPorOP[o.id] || 0,
  }));
}

// Cobrado = suma de los Pagos tipo "Cobro a cliente" con status "Pagado" ligados
// a la OP. ÚNICA fuente de verdad — antes lo calculaba el frontend con una
// lectura-modifica-escritura (op.cobrado + monto) en public/js/views/pagos.js,
// vulnerable a condición de carrera entre pagos casi simultáneos y confiando en
// la aritmética del navegador para un número que alimenta Utilidad y Dashboard.
async function withCobradoReal(objs) {
  let pagos;
  try {
    pagos = await queryDB('pagos', null);
  } catch (_) {
    return objs; // si Postgres falla, se conserva el valor bruto ya guardado (respaldo)
  }
  const cobradoPorOP = {};
  pagos.forEach(p => {
    if (p.tipo !== 'Cobro a cliente') return;
    if (p.status !== 'Pagado') return;
    if (!p.opId) return;
    cobradoPorOP[p.opId] = (cobradoPorOP[p.opId] || 0) + (Number(p.monto) || 0);
  });
  return objs.map(o => ({ ...o, cobrado: Math.round(cobradoPorOP[o.id] || 0) }));
}

router.get('/', async (req, res) => {
  try {
    // Acceso por jerarquía: la OP hereda los 3 roles del cliente (Propietario /
    // Ejec. de cuenta / Ejec. asignado). Non-admin ve solo donde participa.
    // El filtro OR-entre-3-columnas ya no se resuelve en la base (Postgres no
    // tiene el helper de la base de datos) — se trae todo y se filtra en JS, igual que
    // antes se hacía con assertRolAccess por registro individual.
    const rows = await queryDB('ops', null, { field: 'fechaEvento', direction: 'descending' });
    let objs = rows.map(toObj);
    if (req.rolFilter) objs = objs.filter(o => perteneceAlRegistro(o, req.rolFilter));
    res.json(await withCobradoReal(await withUtilidadReal(objs)));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const obj = toObj(await getRow('ops', req.params.id));
    if (!assertRolAccess(req, res, obj)) return;
    const [enriched] = await withCobradoReal(await withUtilidadReal([obj]));
    res.json(enriched);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const data = { ...req.body };
    delete data.utilidad; // se calcula siempre en GET, nunca se captura directamente
    delete data.cobrado;  // ídem — se calcula siempre a partir de Pagos reales

    const cli = await _datosClienteParaOP(data.clienteId);
    const numeroGenerado = await _generarNumeroOP(data.clienteId, cli.codigo);
    if (numeroGenerado) {
      data.numero = numeroGenerado;
      delete data.num; // 'num' tiene prioridad en toRow — no debe pisar el generado
    }
    // Los 3 roles SIEMPRE se heredan del cliente aquí — nunca se confía en lo
    // que mande el frontend (mismo criterio que el número/código: si hubiera
    // un bug o alguien llamara a la API directo, antes la OP podía quedar con
    // roles vacíos e invisible para su propio equipo). El "dueño operativo"
    // (Ejecutivo) de la OP es SIEMPRE el Ejecutivo asignado del cliente. Una
    // OP interna (sin cliente) no tiene de dónde heredar — se deja el 'ejec'
    // que haya mandado el formulario (selección manual para gasto interno).
    if (data.clienteId && data.clienteId !== '__interno__') {
      data.propietario  = cli.propietario;
      data.ejecCuenta    = cli.ejecCuenta;
      data.ejecAsignado = cli.ejecAsignado;
      data.ejec         = cli.ejecAsignado || data.ejec || '';
      // Comisión: FIJA al crear la OP, igual que ya se hace en Clientes/
      // Prospectos — no se recalcula después aunque el cliente cambie de dueño.
      data.comision     = cli.comision;
    }

    const created = await createRow('ops', toRow(data));
    const [enriched] = await withCobradoReal(await withUtilidadReal([toObj(created)]));
    // Actividad Reciente (solo Dirección la ve, ver dashboard.js) — evento de
    // negocio real, no el CRUD crudo.
    logAudit({
      usuario: req.user?.ejec || req.user?.nombre || req.user?.id,
      accion: 'op_creada', entidad: enriched.numero || '',
      ip: clientIp(req), exito: true,
    });
    res.json(enriched);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/:id', async (req, res) => {
  try {
    const existingObj = toObj(await getRow('ops', req.params.id));
    if (!assertRolAccess(req, res, existingObj)) return;
    const body = { ...req.body };
    // La Utilidad y el Cobrado ya NO se capturan a mano: se calculan siempre en
    // GET (cotizado − costos reales de proveedores; suma de Pagos "Pagado" —
    // única fuente de verdad, ver arriba). Cualquier valor recibido aquí se ignora.
    delete body.utilidad;
    delete body.cobrado;
    // El PROPIETARIO nunca cambia ni se reasigna (regla de negocio confirmada):
    // se hereda del cliente al crear la OP y queda fijo. Como el Ejecutivo de
    // cuenta y la comisión se derivan del propietario, también quedan fijos.
    // Lo ÚNICO reasignable —y solo por la oficina total— es el Ejecutivo ASIGNADO
    // (quien lleva el evento); el 'ejec' operativo lo sigue.
    delete body.comision;
    delete body.propietario;
    delete body.ejecCuenta;
    delete body.numero;
    delete body.num;
    if (!esOficinaTotal(req.user)) {
      delete body.ejec; delete body.ejecAsignado;
    } else if (body.ejecAsignado !== undefined) {
      body.ejec = body.ejecAsignado; // el dueño operativo sigue al ejec. asignado
    }
    const updated = await updateRow('ops', req.params.id, toRow(body));
    const [enriched] = await withCobradoReal(await withUtilidadReal([toObj(updated)]));
    res.json(enriched);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

module.exports = router;
