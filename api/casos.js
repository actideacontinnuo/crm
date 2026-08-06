const express = require('express');
const router = express.Router();
const {
  notion, queryDB, createPage, updatePage,
  prop_title, prop_text, prop_select, prop_date,
  read_title, read_text, read_select, read_date,
} = require('./notion');
const { perteneceAlRegistro } = require('./_guard');

function toObj(page) {
  const p = page.properties;
  let historial = [];
  try { historial = JSON.parse(read_text(p['Historial']) || '[]'); } catch {}
  if (!Array.isArray(historial)) historial = [];
  return {
    id:       page.id,
    titulo:   read_title(p['Título']),
    clienteId: read_text(p['Cliente ID']),
    opId:     read_text(p['OP ID']) || null,
    tipo:     read_select(p['Tipo']),
    prio:     read_select(p['Prioridad']),
    quien:    read_text(p['Quién']),
    desc:     read_text(p['Descripción']),
    accion:   read_text(p['Acción Requerida']),
    status:   read_select(p['Status']),
    fecha:    read_date(p['Fecha']),
    historial,
  };
}

function toProps(data) {
  const props = {};
  if (data.titulo    !== undefined) props['Título']            = prop_title(data.titulo);
  if (data.clienteId !== undefined) props['Cliente ID']        = prop_text(data.clienteId);
  if (data.opId      !== undefined) props['OP ID']             = prop_text(data.opId || '');
  if (data.tipo      !== undefined) props['Tipo']              = prop_select(data.tipo);
  if (data.prio      !== undefined) props['Prioridad']         = prop_select(data.prio);
  if (data.quien     !== undefined) props['Quién']             = prop_text(data.quien);
  if (data.desc      !== undefined) props['Descripción']       = prop_text(data.desc);
  if (data.accion    !== undefined) props['Acción Requerida']  = prop_text(data.accion);
  if (data.status    !== undefined) props['Status']            = prop_select(data.status);
  if (data.fecha     !== undefined) props['Fecha']             = prop_date(data.fecha);
  if (data.historial !== undefined) {
    const json = JSON.stringify(Array.isArray(data.historial) ? data.historial : []);
    props['Historial'] = prop_text(json.substring(0, 1990));
  }
  return props;
}

// Un caso no tiene columnas de rol propias — hereda los 3 roles del registro al
// que está ligado (la OP si existe, si no el cliente directo), igual que hacen
// las cotizaciones con _heredarRoles en api/cotizaciones.js.
async function _rolesEnlazados(clienteId, opId) {
  const vacio = { propietario: '', ejecCuenta: '', ejecAsignado: '', ejec: '' };
  const targetId = opId || clienteId;
  if (!targetId || targetId === '__interno__') return vacio;
  try {
    const page = await notion.pages.retrieve({ page_id: targetId });
    const p = page.properties;
    return {
      propietario:  read_select(p['Propietario']),
      ejecCuenta:   read_select(p['EjecutivoCuenta']),
      ejecAsignado: read_select(p['EjecutivoAsignado']),
      ejec:         read_select(p['Ejecutivo']),
    };
  } catch (_) {
    return vacio; // clienteId/opId inválido o inaccesible — no participa
  }
}

router.get('/', async (req, res) => {
  try {
    const pages = await queryDB('casos', null, [{ property: 'Fecha', direction: 'descending' }]);
    let objs = pages.map(toObj);
    if (req.rolFilter) {
      const roles = await Promise.all(objs.map(o => _rolesEnlazados(o.clienteId, o.opId)));
      objs = objs.filter((o, i) => perteneceAlRegistro(roles[i], req.rolFilter));
    }
    res.json(objs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const page = await notion.pages.retrieve({ page_id: req.params.id });
    const obj = toObj(page);
    if (req.rolFilter) {
      const roles = await _rolesEnlazados(obj.clienteId, obj.opId);
      if (!perteneceAlRegistro(roles, req.rolFilter)) {
        return res.status(403).json({ error: 'No tienes permiso para ver este caso' });
      }
    }
    res.json(obj);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    if (req.rolFilter) {
      const roles = await _rolesEnlazados(req.body.clienteId, req.body.opId);
      if (!perteneceAlRegistro(roles, req.rolFilter)) {
        return res.status(403).json({ error: 'No tienes permiso para crear un caso en este cliente/OP' });
      }
    }
    const page = await createPage('casos', toProps(req.body));
    res.json(toObj(page));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/:id', async (req, res) => {
  try {
    const existing = await notion.pages.retrieve({ page_id: req.params.id });
    const existingObj = toObj(existing);
    if (req.rolFilter) {
      const roles = await _rolesEnlazados(existingObj.clienteId, existingObj.opId);
      if (!perteneceAlRegistro(roles, req.rolFilter)) {
        return res.status(403).json({ error: 'No tienes permiso para modificar este caso' });
      }
    }
    const page = await updatePage(req.params.id, toProps(req.body));
    res.json(toObj(page));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
