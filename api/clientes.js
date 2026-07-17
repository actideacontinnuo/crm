const express = require('express');
const router = express.Router();
const {
  notion, queryDB, createPage, updatePage, archivePage,
  prop_title, prop_text, prop_number, prop_select, prop_email, prop_phone,
  read_title, read_text, read_number, read_select, read_email, read_phone,
} = require('./notion');
const { filtroRolesNotion, assertRolAccess } = require('./_guard');
const { aplicarReglasComision } = require('./_roles');

function toObj(page) {
  const p = page.properties;
  return {
    id:       page.id,
    nombre:   read_title(p['Nombre']),
    codigo:   read_text(p['Codigo']),
    razon:    read_text(p['Razon Social']),
    rfc:      read_text(p['RFC']),
    dir:      read_text(p['Direccion']),
    contacto: read_text(p['Contacto']),
    cargo:    read_text(p['Cargo']),
    tel:      read_phone(p['Telefono']),
    email:    read_email(p['Email']),
    ejec:         read_select(p['Ejecutivo']),      // legado
    propietario:  read_select(p['Propietario']),
    ejecCuenta:   read_select(p['EjecutivoCuenta']),
    ejecAsignado: read_select(p['EjecutivoAsignado']),
    comision:     p['Comision']?.number ?? null,
    pago:     read_select(p['Condiciones de Pago']),
    status:   read_select(p['Status']),
    docs:     read_text(p['Docs']),
  };
}

function toProps(data) {
  const props = {};
  if (data.nombre   !== undefined) props['Nombre']             = prop_title(data.nombre);
  if (data.codigo   !== undefined) props['Codigo']             = prop_text(data.codigo);
  if (data.razon    !== undefined) props['Razon Social']       = prop_text(data.razon);
  if (data.rfc      !== undefined) props['RFC']                = prop_text(data.rfc);
  if (data.dir      !== undefined) props['Direccion']          = prop_text(data.dir);
  if (data.contacto !== undefined) props['Contacto']           = prop_text(data.contacto);
  if (data.cargo    !== undefined) props['Cargo']              = prop_text(data.cargo);
  if (data.tel      !== undefined) props['Telefono']           = prop_phone(data.tel);
  if (data.email    !== undefined) props['Email']              = prop_email(data.email);
  if (data.ejec         !== undefined) props['Ejecutivo']         = prop_select(data.ejec);
  if (data.propietario  !== undefined) props['Propietario']       = prop_select(data.propietario);
  if (data.ejecCuenta   !== undefined) props['EjecutivoCuenta']   = prop_select(data.ejecCuenta);
  if (data.ejecAsignado !== undefined) props['EjecutivoAsignado'] = prop_select(data.ejecAsignado);
  if (data.comision     !== undefined) props['Comision']          = prop_number(data.comision);
  if (data.pago     !== undefined) props['Condiciones de Pago'] = prop_select(data.pago);
  if (data.status   !== undefined) props['Status']             = prop_select(data.status);
  if (data.docs     !== undefined) props['Docs']               = prop_text(
    typeof data.docs === 'object' ? JSON.stringify(data.docs) : String(data.docs)
  );
  return props;
}

router.get('/', async (req, res) => {
  try {
    const filter = req.rolFilter ? filtroRolesNotion(req.rolFilter) : null;
    const pages = await queryDB('clientes', filter, [{ property: 'Nombre', direction: 'ascending' }]);
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
    // Reglas de comisión (los clientes no vienen de Apollo; ese origen es de prospectos)
    const r = aplicarReglasComision(data, { esApollo: false });
    data.propietario  = r.propietario;
    data.ejecCuenta   = r.ejecCuenta;
    data.ejecAsignado = r.ejecAsignado;
    // Comisión: al convertir un prospecto viene la comisión FIJA (incluso null) —
    // se respeta tal cual (§3.1). Si no viene la llave, se calcula con las reglas.
    if (!Object.prototype.hasOwnProperty.call(req.body, 'comision')) {
      data.comision = r.comision;
    }
    if (req.rolFilter && !data.propietario) {
      data.propietario = req.rolFilter;
      const r2 = aplicarReglasComision(data, { esApollo: false });
      data.ejecCuenta = r2.ejecCuenta;
      if (data.comision === null || data.comision === undefined) data.comision = r2.comision;
    }
    const page = await createPage('clientes', toProps(data));
    res.json(toObj(page));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/:id', async (req, res) => {
  try {
    const existing = await notion.pages.retrieve({ page_id: req.params.id });
    if (!assertRolAccess(req, res, toObj(existing))) return;
    const body = { ...req.body };
    // §3.1 — la comisión no se recalcula retroactivamente; el código de cliente tampoco cambia
    delete body.comision;
    delete body.codigo;
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
