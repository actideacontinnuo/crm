const express = require('express');
const router = express.Router();
const {
  notion, queryDB, createPage, updatePage,
  prop_title, prop_text, prop_number, prop_select, prop_date,
  read_title, read_text, read_number, read_select, read_date,
} = require('./notion');
const { filtroRolesNotion, assertRolAccess, esOficinaTotal } = require('./_guard');

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
  return props;
}

router.get('/', async (req, res) => {
  try {
    // Acceso por jerarquía: la OP hereda los 3 roles del cliente (Propietario /
    // Ejec. de cuenta / Ejec. asignado). Non-admin ve solo donde participa.
    const filter = req.rolFilter ? filtroRolesNotion(req.rolFilter) : null;
    const pages = await queryDB('ops', filter, [{ property: 'Fecha Evento', direction: 'descending' }]);
    res.json(pages.map(toObj));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const page = await notion.pages.retrieve({ page_id: req.params.id });
    const obj = toObj(page);
    if (!assertRolAccess(req, res, obj)) return;
    res.json(obj);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const page = await createPage('ops', toProps({ ...req.body }));
    res.json(toObj(page));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/:id', async (req, res) => {
  try {
    const existing = await notion.pages.retrieve({ page_id: req.params.id });
    if (!assertRolAccess(req, res, toObj(existing))) return;
    const body = { ...req.body };
    // Solo la oficina total (Dirección/Oscar) puede reasignar roles y renumerar la OP
    // (p. ej. al cambiar el Ejecutivo asignado). El resto no reasigna por edición.
    if (!esOficinaTotal(req.user)) {
      delete body.ejec; delete body.propietario; delete body.ejecCuenta; delete body.ejecAsignado;
      delete body.numero; delete body.num;
    }
    const page = await updatePage(req.params.id, toProps(body));
    res.json(toObj(page));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
