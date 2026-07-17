const express = require('express');
const router = express.Router();
const {
  notion, queryDB, createPage, updatePage, archivePage,
  prop_title, prop_text, prop_number, prop_select, prop_date, prop_email, prop_phone,
  read_title, read_text, read_number, read_select, read_date, read_email, read_phone,
} = require('./notion');
const { filtroRolesNotion, assertRolAccess } = require('./_guard');
const { aplicarReglasComision } = require('./_roles');

function toObj(page) {
  const p = page.properties;
  let notas = [];
  try { notas = JSON.parse(read_text(p['Notas']) || '[]'); } catch {}
  if (!Array.isArray(notas)) notas = [];
  return {
    id: page.id,
    empresa:      read_title(p['Empresa']),
    contacto:     read_text(p['Contacto']),
    cargo:        read_text(p['Cargo']),
    tel:          read_phone(p['Telefono']),
    email:        read_email(p['Email']),
    evento:       read_text(p['Evento']),
    estimado:     read_number(p['Estimado']),
    ejec:         read_select(p['Ejecutivo']),      // legado (compatibilidad)
    propietario:  read_select(p['Propietario']),
    ejecCuenta:   read_select(p['EjecutivoCuenta']),
    ejecAsignado: read_select(p['EjecutivoAsignado']),
    comision:     p['Comision']?.number ?? null,    // % fijo; null = no gestionada
    fuente:       read_select(p['Fuente']),
    status:       read_select(p['Status']),
    seguimiento:  read_date(p['Seguimiento']),
    notas,
  };
}

function toProps(data) {
  const props = {};
  if (data.empresa      !== undefined) props['Empresa']            = prop_title(data.empresa);
  if (data.contacto     !== undefined) props['Contacto']           = prop_text(data.contacto);
  if (data.cargo        !== undefined) props['Cargo']              = prop_text(data.cargo);
  if (data.tel          !== undefined) props['Telefono']           = prop_phone(data.tel);
  if (data.email        !== undefined) props['Email']              = prop_email(data.email);
  if (data.evento       !== undefined) props['Evento']             = prop_text(data.evento);
  if (data.estimado     !== undefined) props['Estimado']           = prop_number(data.estimado);
  if (data.ejec         !== undefined) props['Ejecutivo']          = prop_select(data.ejec);
  if (data.propietario  !== undefined) props['Propietario']        = prop_select(data.propietario);
  if (data.ejecCuenta   !== undefined) props['EjecutivoCuenta']    = prop_select(data.ejecCuenta);
  if (data.ejecAsignado !== undefined) props['EjecutivoAsignado']  = prop_select(data.ejecAsignado);
  if (data.comision     !== undefined) props['Comision']           = prop_number(data.comision);
  if (data.fuente       !== undefined) props['Fuente']             = prop_select(data.fuente);
  if (data.status       !== undefined) props['Status']             = prop_select(data.status);
  if (data.seguimiento  !== undefined) props['Seguimiento']        = prop_date(data.seguimiento);
  if (data.notas        !== undefined) {
    const json = JSON.stringify(Array.isArray(data.notas) ? data.notas : []);
    props['Notas'] = prop_text(json.substring(0, 1990));
  }
  return props;
}

router.get('/', async (req, res) => {
  try {
    const filter = req.rolFilter ? filtroRolesNotion(req.rolFilter) : null;
    const pages = await queryDB('prospectos', filter, [{ property: 'Empresa', direction: 'ascending' }]);
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
    const data = { ...req.body };
    // Aplicar reglas de comisión y asignaciones automáticas (comisión FIJA al alta)
    const esApollo = data.fuente === 'Apollo';
    const r = aplicarReglasComision(data, { esApollo });
    data.propietario  = r.propietario;
    data.ejecCuenta   = r.ejecCuenta;
    data.ejecAsignado = r.ejecAsignado;
    data.comision     = r.comision;
    // Un usuario no-admin que crea, se pone como propietario si no vino ninguno
    if (req.rolFilter && !data.propietario) {
      data.propietario = req.rolFilter;
      const r2 = aplicarReglasComision(data, { esApollo });
      data.ejecCuenta = r2.ejecCuenta; data.comision = r2.comision;
    }
    const page = await createPage('prospectos', toProps(data));
    res.json(toObj(page));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/:id', async (req, res) => {
  try {
    const existing = await notion.pages.retrieve({ page_id: req.params.id });
    if (!assertRolAccess(req, res, toObj(existing))) return;

    const body = { ...req.body };
    // Datos de contacto: inmutables para ejecutivos/administración; el admin sí corrige
    if (req.rolFilter) {
      delete body.empresa; delete body.contacto; delete body.tel; delete body.email;
    }
    // §3.1 — la comisión NO se recalcula retroactivamente: se preserva la del alta.
    delete body.comision;
    const page = await updatePage(req.params.id, toProps(body));
    res.json(toObj(page));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const existing = await notion.pages.retrieve({ page_id: req.params.id });
    if (!assertRolAccess(req, res, toObj(existing))) return;
    await archivePage(req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
