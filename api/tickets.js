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
  return {
    id:       page.id,
    tipo:     read_title(p['Tipo']),
    cotId:    read_text(p['Cotización ID']),
    monto:    read_text(p['Monto Afectado']),
    quien:    read_text(p['Quién']),
    motivo:   read_text(p['Motivo']),
    status:   read_select(p['Status']),
    fecha:    read_date(p['Fecha']),
  };
}

function toProps(data) {
  const props = {};
  if (data.tipo   !== undefined) props['Tipo']           = prop_title(data.tipo);
  if (data.cotId  !== undefined) props['Cotización ID']  = prop_text(data.cotId);
  if (data.monto  !== undefined) props['Monto Afectado'] = prop_text(data.monto);
  if (data.quien  !== undefined) props['Quién']          = prop_text(data.quien);
  if (data.motivo !== undefined) props['Motivo']         = prop_text(data.motivo);
  if (data.status !== undefined) props['Status']         = prop_select(data.status);
  if (data.fecha  !== undefined) props['Fecha']          = prop_date(data.fecha);
  return props;
}

// Un ticket no tiene columnas de rol propias — hereda los 3 roles de la
// cotización a la que está ligado (mismo criterio que api/casos.js).
async function _rolesEnlazados(cotId) {
  const vacio = { propietario: '', ejecCuenta: '', ejecAsignado: '', ejec: '' };
  if (!cotId) return vacio;
  try {
    const page = await notion.pages.retrieve({ page_id: cotId });
    const p = page.properties;
    return {
      propietario:  read_select(p['Propietario']),
      ejecCuenta:   read_select(p['EjecutivoCuenta']),
      ejecAsignado: read_select(p['EjecutivoAsignado']),
      ejec:         read_select(p['Ejecutivo']),
    };
  } catch (_) {
    return vacio; // cotId inválido o inaccesible — no participa
  }
}

router.get('/', async (req, res) => {
  try {
    const pages = await queryDB('tickets', null, [{ property: 'Fecha', direction: 'descending' }]);
    let objs = pages.map(toObj);
    if (req.rolFilter) {
      const roles = await Promise.all(objs.map(o => _rolesEnlazados(o.cotId)));
      objs = objs.filter((o, i) => perteneceAlRegistro(roles[i], req.rolFilter));
    }
    res.json(objs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    if (req.rolFilter) {
      const roles = await _rolesEnlazados(req.body.cotId);
      if (!perteneceAlRegistro(roles, req.rolFilter)) {
        return res.status(403).json({ error: 'No tienes permiso para crear un ticket en esta cotización' });
      }
    }
    const page = await createPage('tickets', toProps(req.body));
    res.json(toObj(page));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/:id', async (req, res) => {
  try {
    const existing = await notion.pages.retrieve({ page_id: req.params.id });
    const existingObj = toObj(existing);
    if (req.rolFilter) {
      const roles = await _rolesEnlazados(existingObj.cotId);
      if (!perteneceAlRegistro(roles, req.rolFilter)) {
        return res.status(403).json({ error: 'No tienes permiso para modificar este ticket' });
      }
    }
    const page = await updatePage(req.params.id, toProps(req.body));
    res.json(toObj(page));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
