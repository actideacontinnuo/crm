const express = require('express');
const router = express.Router();
const { queryDB, getRow, createRow, updateRow, archiveRow } = require('./db');
const { assertRolAccess, perteneceAlRegistro } = require('./_guard');
const { aplicarReglasComision, obtenerRosterEjecutivos } = require('./_roles');
const { logAudit, clientIp } = require('./_audit');

// Motivos válidos para cerrar un prospecto como perdido — lista cerrada para
// poder medir después por qué se pierden (Reportes/Comercial).
const MOTIVOS_PERDIDA = [
  'Precio',
  'Eligió a la competencia',
  'No tiene presupuesto',
  'Dejó de responder',
  'Evento cancelado o pospuesto',
  'No era el perfil adecuado',
  'Otro',
];

function toObj(row) {
  let notas = row.notas;
  if (typeof notas === 'string') { try { notas = JSON.parse(notas); } catch { notas = []; } }
  if (!Array.isArray(notas)) notas = [];
  return {
    id: row.id,
    creado:       row.createdAt ? new Date(row.createdAt).toISOString() : null,
    empresa:      row.empresa || '',
    contacto:     row.contacto || '',
    cargo:        row.cargo || '',
    tel:          row.telefono || '',
    email:        row.email || '',
    evento:       row.evento || '',
    estimado:     Number(row.estimado) || 0,
    ejec:         row.ejec || '',      // legado (compatibilidad)
    propietario:  row.propietario || '',
    ejecCuenta:   row.ejecCuenta || '',
    ejecAsignado: row.ejecAsignado || '',
    comision:     row.comision ?? null,    // % fijo; null = no gestionada
    fuente:       row.fuente || '',
    status:       row.status || '',
    seguimiento:  row.seguimiento ?? null,
    notas,
    // Metadata de Prospección por Apollo (api/prospeccion.js) — solo lectura
    // aquí, nunca se escriben desde este router; null en registros que no
    // vienen de Apollo o son de antes de que existieran estas columnas.
    sector:         row.sector || null,
    confianzaIA:    row.confianzaIa ?? null,
    verificacionIA: row.verificacionIa || null,
    numEmpleados:   row.numEmpleados ?? null,
    tamanoEmpresa:  row.tamanoEmpresa || null,
    origenCarga:    row.origenCarga || null,
    correoGenerado: !!row.correoGenerado,
    // Cierre como perdido (null mientras el prospecto siga abierto)
    motivoPerdida:  row.motivoPerdida || null,
    detallePerdida: row.detallePerdida || null,
    fechaCierre:    row.fechaCierre ?? null,
  };
}

function toRow(data) {
  const row = {};
  if (data.empresa      !== undefined) row.empresa         = data.empresa;
  if (data.contacto     !== undefined) row.contacto        = data.contacto;
  if (data.cargo        !== undefined) row.cargo           = data.cargo;
  if (data.tel          !== undefined) row.telefono        = data.tel;
  if (data.email        !== undefined) row.email           = data.email;
  if (data.evento       !== undefined) row.evento          = data.evento;
  if (data.estimado     !== undefined) row.estimado        = data.estimado;
  if (data.ejec         !== undefined) row.ejec            = data.ejec;
  if (data.propietario  !== undefined) row.propietario     = data.propietario;
  if (data.ejecCuenta   !== undefined) row.ejecCuenta      = data.ejecCuenta;
  if (data.ejecAsignado !== undefined) row.ejecAsignado    = data.ejecAsignado;
  if (data.comision     !== undefined) row.comision        = data.comision;
  if (data.fuente       !== undefined) row.fuente          = data.fuente;
  if (data.status       !== undefined) row.status          = data.status;
  if (data.seguimiento  !== undefined) row.seguimiento     = data.seguimiento || null;
  if (data.notas        !== undefined) row.notas           = JSON.stringify(Array.isArray(data.notas) ? data.notas : []);
  return row;
}

router.get('/', async (req, res) => {
  try {
    const rows = await queryDB('prospectos', null, { field: 'empresa', direction: 'ascending' });
    let objs = rows.map(toObj);
    if (req.rolFilter) objs = objs.filter(o => perteneceAlRegistro(o, req.rolFilter));
    res.json(objs);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// Catálogo de motivos para que el frontend arme su lista sin duplicarla
// (va ANTES de '/:id' para que no se interprete como un id).
router.get('/motivos-perdida', (_req, res) => res.json(MOTIVOS_PERDIDA));

router.get('/:id', async (req, res) => {
  try {
    const obj = toObj(await getRow('prospectos', req.params.id));
    if (!assertRolAccess(req, res, obj)) return;
    res.json(obj);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const data = { ...req.body };
    // Aplicar reglas de comisión y asignaciones automáticas (comisión FIJA al alta)
    const esApollo = data.fuente === 'Apollo';
    const ejecutivosRoster = await obtenerRosterEjecutivos();
    const r = aplicarReglasComision(data, { esApollo, ejecutivosRoster });
    data.propietario  = r.propietario;
    data.ejecCuenta   = r.ejecCuenta;
    data.ejecAsignado = r.ejecAsignado;
    data.comision     = r.comision;
    // Un usuario no-admin que crea, se pone como propietario si no vino ninguno
    if (req.rolFilter && !data.propietario) {
      data.propietario = req.rolFilter;
      const r2 = aplicarReglasComision(data, { esApollo, ejecutivosRoster });
      data.ejecCuenta = r2.ejecCuenta; data.comision = r2.comision;
    }
    res.json(toObj(await createRow('prospectos', toRow(data))));
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.patch('/:id', async (req, res) => {
  try {
    const existingObj = toObj(await getRow('prospectos', req.params.id));
    if (!assertRolAccess(req, res, existingObj)) return;

    const body = { ...req.body };
    // El cierre como perdido (y su reapertura) solo se hace por sus rutas dedicadas
    // — así nunca queda un 'Perdido' sin motivo, ni se reabre sin querer al editar.
    delete body.motivoPerdida; delete body.detallePerdida; delete body.fechaCierre;
    if (body.status === 'Perdido' && existingObj.status !== 'Perdido') {
      return res.status(400).json({ error: 'Para marcar un prospecto como perdido usa "Cerrar como perdido" e indica el motivo.' });
    }
    if (existingObj.status === 'Perdido') delete body.status;
    // Datos de contacto: inmutables para ejecutivos/administración; el admin sí corrige
    if (req.rolFilter) {
      delete body.empresa; delete body.contacto; delete body.tel; delete body.email;
    }
    // §3.1 — la comisión NO se recalcula retroactivamente: se preserva la del alta.
    delete body.comision;
    // Propietario = Ejecutivo de cuenta SIEMPRE (excepto Eduardo/Alfredo, Regla 3)
    // — se re-deriva aquí para que editar nunca pueda dejar el registro
    // inconsistente (p. ej. cambiando ejecCuenta solo, o el propietario sin
    // arrastrar su ejecutivo de cuenta). No toca la comisión ya fijada.
    if (body.propietario !== undefined || body.ejecCuenta !== undefined) {
      const propietarioEfectivo = body.propietario !== undefined ? body.propietario : existingObj.propietario;
      const ejecutivosRoster = await obtenerRosterEjecutivos();
      const r = aplicarReglasComision({ propietario: propietarioEfectivo }, { ejecutivosRoster });
      body.propietario = r.propietario;
      body.ejecCuenta   = r.ejecCuenta;
    }
    res.json(toObj(await updateRow('prospectos', req.params.id, toRow(body))));
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.post('/:id/perder', async (req, res) => {
  try {
    const existingObj = toObj(await getRow('prospectos', req.params.id));
    if (!assertRolAccess(req, res, existingObj)) return;
    if (existingObj.status === 'Perdido') return res.status(400).json({ error: 'Este prospecto ya está cerrado como perdido.' });
    if (existingObj.status === 'Convertido') return res.status(400).json({ error: 'Este prospecto ya se convirtió en cliente; no puede cerrarse como perdido.' });

    const motivo  = String(req.body.motivo || '').trim();
    const detalle = String(req.body.detalle || '').trim();
    if (!MOTIVOS_PERDIDA.includes(motivo)) return res.status(400).json({ error: 'Selecciona un motivo de pérdida válido.' });
    if (motivo === 'Otro' && !detalle) return res.status(400).json({ error: 'Cuando el motivo es "Otro", explica brevemente qué pasó.' });

    const hoy = new Date().toISOString().slice(0, 10);
    const nota = `Cerrado como PERDIDO (${motivo})${detalle ? ': ' + detalle : ''} · ${new Date().toLocaleDateString('es-MX')}`;
    const updated = await updateRow('prospectos', req.params.id, {
      status: 'Perdido', motivoPerdida: motivo, detallePerdida: detalle || null, fechaCierre: hoy,
      notas: JSON.stringify([...existingObj.notas, nota]),
    });
    logAudit({ usuario: req.user?.ejec || req.user?.nombre || req.user?.id, accion: 'prospecto_perdido', entidad: existingObj.empresa, detalle: motivo, ip: clientIp(req), exito: true });
    res.json(toObj(updated));
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.post('/:id/reabrir', async (req, res) => {
  try {
    const existingObj = toObj(await getRow('prospectos', req.params.id));
    if (!assertRolAccess(req, res, existingObj)) return;
    if (existingObj.status !== 'Perdido') return res.status(400).json({ error: 'Solo se pueden reabrir prospectos cerrados como perdidos.' });
    const nota = `Reabierto (antes perdido por: ${existingObj.motivoPerdida || 's/m'}) · ${new Date().toLocaleDateString('es-MX')}`;
    const updated = await updateRow('prospectos', req.params.id, {
      status: 'Nuevo', motivoPerdida: null, detallePerdida: null, fechaCierre: null,
      notas: JSON.stringify([...existingObj.notas, nota]),
    });
    logAudit({ usuario: req.user?.ejec || req.user?.nombre || req.user?.id, accion: 'prospecto_reabierto', entidad: existingObj.empresa, ip: clientIp(req), exito: true });
    res.json(toObj(updated));
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    if (!assertRolAccess(req, res, toObj(await getRow('prospectos', req.params.id)))) return;
    await archiveRow('prospectos', req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

module.exports = router;
