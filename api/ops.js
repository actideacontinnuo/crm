const express = require('express');
const router = express.Router();
const {
  notion, queryDB, createPage, updatePage,
  prop_title, prop_text, prop_number, prop_select, prop_date,
  read_title, read_text, read_number, read_select, read_date,
} = require('./notion');
const { filtroRolesNotion, assertRolAccess, esOficinaTotal } = require('./_guard');
const { aplicarReglasComision } = require('./_roles');

function toObj(page) {
  const p = page.properties;
  return {
    id:         page.id,
    num:        read_title(p['Número OP']),
    numero:     read_title(p['Número OP']),
    desc:       read_text(p['Descripción']),
    clienteId:  read_text(p['Cliente ID']),
    ejec:       read_select(p['Ejecutivo']),         // legado / operativo
    propietario:  read_select(p['Propietario']),      // heredados del cliente (jerarquía)
    ejecCuenta:   read_select(p['EjecutivoCuenta']),
    ejecAsignado: read_select(p['EjecutivoAsignado']),
    fechaEvento: read_date(p['Fecha Evento']),
    cotizado:   read_number(p['Cotizado']),
    cobrado:    read_number(p['Cobrado']),
    utilidad:   read_number(p['Utilidad']),
    status:     read_select(p['Status']),
    bono:       read_text(p['Bono']),
    // % de comisión del ejecutivo — heredado del Cliente al crear la OP (Regla
    // 2 = 15%, Regla 3 = 7.5%, ver api/_roles.js) y FIJO desde entonces, igual
    // que ya se hace con la comisión de Clientes/Prospectos: no se recalcula
    // si el cliente cambia de dueño después. null en OPs viejas (antes de este
    // campo) — se sigue mostrando 7.5% como respaldo, no un dato inventado.
    comision:   p['Comision']?.number ?? null,
  };
}

function toProps(data) {
  const props = {};
  if (data.num    !== undefined) props['Número OP']   = prop_title(data.num);
  else if (data.numero !== undefined) props['Número OP'] = prop_title(data.numero);
  if (data.desc     !== undefined) props['Descripción'] = prop_text(data.desc);
  if (data.clienteId !== undefined) props['Cliente ID']  = prop_text(data.clienteId);
  if (data.ejec     !== undefined) props['Ejecutivo']   = prop_select(data.ejec);
  if (data.propietario  !== undefined) props['Propietario']       = prop_select(data.propietario);
  if (data.ejecCuenta   !== undefined) props['EjecutivoCuenta']   = prop_select(data.ejecCuenta);
  if (data.ejecAsignado !== undefined) props['EjecutivoAsignado'] = prop_select(data.ejecAsignado);
  if (data.fechaEvento !== undefined) props['Fecha Evento'] = prop_date(data.fechaEvento);
  else if (data.fecha  !== undefined) props['Fecha Evento'] = prop_date(data.fecha);
  if (data.cotizado !== undefined) props['Cotizado']    = prop_number(data.cotizado);
  if (data.cobrado  !== undefined) props['Cobrado']     = prop_number(data.cobrado);
  if (data.utilidad !== undefined) props['Utilidad']    = prop_number(data.utilidad);
  if (data.status   !== undefined) props['Status']      = prop_select(data.status);
  if (data.bono     !== undefined) props['Bono']        = prop_text(data.bono);
  if (data.comision !== undefined) props['Comision']    = prop_number(data.comision);
  return props;
}

// Datos del cliente que la OP necesita HEREDAR al crearse — código (para el
// número) y los 3 roles comerciales. Una sola lectura a Notion, autoridad del
// servidor: nunca se confía en lo que mande el cliente HTTP para ninguno de
// estos campos (mismo criterio que api/clientes.js _generarCodigoCliente).
async function _datosClienteParaOP(clienteId) {
  const vacio = { codigo: '', propietario: '', ejecCuenta: '', ejecAsignado: '', comision: null };
  if (!clienteId || clienteId === '__interno__') return vacio;
  try {
    const clientePage = await notion.pages.retrieve({ page_id: clienteId });
    const p = clientePage.properties;
    return {
      codigo:       read_text(p['Codigo']),
      propietario:  read_select(p['Propietario']),
      ejecCuenta:   read_select(p['EjecutivoCuenta']),
      ejecAsignado: read_select(p['EjecutivoAsignado']),
      comision:     p['Comision']?.number ?? null,
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
  const opsDelCliente = await queryDB('ops', { property: 'Cliente ID', rich_text: { equals: clienteId } }, null);
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
    deudas = await queryDB('deudas', null, null);
  } catch (_) {
    // Si Notion falla al traer los costos, no reventamos el listado de OPs —
    // se conserva el valor bruto ya guardado (respaldo, puede estar desfasado).
    return objs;
  }
  const costosPorOP = {};
  deudas.forEach(page => {
    const p = page.properties;
    const opId = read_text(p['OP ID']);
    if (!opId) return;
    costosPorOP[opId] = (costosPorOP[opId] || 0) + read_number(p['Monto']);
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
    pagos = await queryDB('pagos', null, null);
  } catch (_) {
    return objs; // si Notion falla, se conserva el valor bruto ya guardado (respaldo)
  }
  const cobradoPorOP = {};
  pagos.forEach(page => {
    const p = page.properties;
    if (read_select(p['Tipo']) !== 'Cobro a cliente') return;
    if (read_select(p['Status']) !== 'Pagado') return;
    const opId = read_text(p['OP ID']);
    if (!opId) return;
    cobradoPorOP[opId] = (cobradoPorOP[opId] || 0) + read_number(p['Monto']);
  });
  return objs.map(o => ({ ...o, cobrado: Math.round(cobradoPorOP[o.id] || 0) }));
}

router.get('/', async (req, res) => {
  try {
    // Acceso por jerarquía: la OP hereda los 3 roles del cliente (Propietario /
    // Ejec. de cuenta / Ejec. asignado). Non-admin ve solo donde participa.
    const filter = req.rolFilter ? filtroRolesNotion(req.rolFilter) : null;
    const pages = await queryDB('ops', filter, [{ property: 'Fecha Evento', direction: 'descending' }]);
    res.json(await withCobradoReal(await withUtilidadReal(pages.map(toObj))));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const page = await notion.pages.retrieve({ page_id: req.params.id });
    const obj = toObj(page);
    if (!assertRolAccess(req, res, obj)) return;
    const [enriched] = await withCobradoReal(await withUtilidadReal([obj]));
    res.json(enriched);
  } catch (err) { res.status(500).json({ error: err.message }); }
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
      delete data.num; // 'num' tiene prioridad en toProps — no debe pisar el generado
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

    const page = await createPage('ops', toProps(data));
    const [enriched] = await withCobradoReal(await withUtilidadReal([toObj(page)]));
    res.json(enriched);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/:id', async (req, res) => {
  try {
    const existing = await notion.pages.retrieve({ page_id: req.params.id });
    const existingObj = toObj(existing);
    if (!assertRolAccess(req, res, existingObj)) return;
    const body = { ...req.body };
    // La Utilidad y el Cobrado ya NO se capturan a mano: se calculan siempre en
    // GET (cotizado − costos reales de proveedores; suma de Pagos "Pagado" —
    // única fuente de verdad, ver arriba). Cualquier valor recibido aquí se ignora.
    delete body.utilidad;
    delete body.cobrado;
    // La comisión nunca se edita a mano — igual que en Clientes/Prospectos,
    // solo se re-deriva automáticamente cuando cambia el propietario (abajo).
    delete body.comision;
    // Solo la oficina total (Dirección/Oscar) puede reasignar roles y renumerar la OP
    // (p. ej. al cambiar el Ejecutivo asignado). El resto no reasigna por edición.
    if (!esOficinaTotal(req.user)) {
      delete body.ejec; delete body.propietario; delete body.ejecCuenta; delete body.ejecAsignado;
      delete body.numero; delete body.num;
    } else if (body.propietario !== undefined || body.ejecCuenta !== undefined) {
      // Propietario = Ejecutivo de cuenta SIEMPRE (excepto Eduardo/Alfredo) — se
      // re-deriva también aquí para que "Editar OP" no pueda romper la regla.
      // La comisión se re-deriva junto con el rol: reasignar el propietario
      // cuenta como una nueva asignación (misma filosofía que Clientes).
      const propietarioEfectivo = body.propietario !== undefined ? body.propietario : existingObj.propietario;
      const r = aplicarReglasComision({ propietario: propietarioEfectivo });
      body.propietario = r.propietario;
      body.ejecCuenta   = r.ejecCuenta;
      body.comision     = r.comision;
    }
    const page = await updatePage(req.params.id, toProps(body));
    const [enriched] = await withCobradoReal(await withUtilidadReal([toObj(page)]));
    res.json(enriched);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
