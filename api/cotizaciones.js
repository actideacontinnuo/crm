const express = require('express');
const router = express.Router();
const multer = require('multer');
const { queryDB, getRow, createRow, updateRow, subirArchivo, urlFirmada } = require('./db');
const { assertRolAccess, perteneceAlRegistro } = require('./_guard');
const BUCKET = 'cotizaciones';

// Cotizaciones: SOLO archivos. Cada cotización es un PDF + un Excel guardados en
// Supabase Storage (bucket privado). No hay cotizador, secciones ni cálculos: el documento es la fuente.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB por archivo (límite single_part de Notion)
  fileFilter(req, file, cb) {
    const ok = [
      'application/pdf',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
    ].includes(file.mimetype);
    cb(ok ? null : new Error('Solo se aceptan archivos PDF o Excel'), ok);
  },
});

async function toObj(row) {
  const [pdfUrl, excelUrl] = await Promise.all([urlFirmada(BUCKET, row.pdfUrl), urlFirmada(BUCKET, row.excelUrl)]);
  return {
    id:        row.id,
    cotId:     row.cotId || '',
    opId:      row.opId || '',
    clienteId: row.clienteId || '',
    version:   row.version || '',
    fecha:     row.fecha ?? null,
    status:    row.status || '',
    ejec:      row.ejec || '',          // legado (compatibilidad)
    propietario:  row.propietario || '', // heredados de la OP (o del cliente)
    ejecCuenta:   row.ejecCuenta || '',
    ejecAsignado: row.ejecAsignado || '',
    pdf:       pdfUrl   ? [{ name: row.pdfNombre || 'archivo',   url: pdfUrl }]   : [],
    excel:     excelUrl ? [{ name: row.excelNombre || 'archivo', url: excelUrl }] : [],
  };
}

function toRow(data) {
  const row = {};
  if (data.cotId     !== undefined) row.cotId     = data.cotId;
  if (data.opId      !== undefined) row.opId      = data.opId || null;
  if (data.clienteId !== undefined) row.clienteId = data.clienteId || null;
  if (data.version   !== undefined) row.version   = data.version;
  if (data.fecha     !== undefined) row.fecha     = data.fecha || null;
  if (data.status    !== undefined) row.status    = data.status;
  if (data.ejec         !== undefined) row.ejec         = data.ejec;
  if (data.propietario  !== undefined) row.propietario  = data.propietario;
  if (data.ejecCuenta   !== undefined) row.ejecCuenta   = data.ejecCuenta;
  if (data.ejecAsignado !== undefined) row.ejecAsignado = data.ejecAsignado;
  if (data.pdfArchivo)   { row.pdfUrl   = data.pdfArchivo.ruta;   row.pdfNombre   = data.pdfArchivo.name; }
  if (data.excelArchivo) { row.excelUrl = data.excelArchivo.ruta; row.excelNombre = data.excelArchivo.name; }
  return row;
}

// Los 3 roles de una cotización se HEREDAN — nunca se capturan a mano ni se
// confía en lo que mande el cliente. Si tiene OP, vienen de la OP (que a su
// vez los heredó del cliente); si no tiene OP pero sí cliente, vienen del
// cliente directo. Mismo criterio que "OP hereda de Cliente" — Propietario/
// Ejec. de cuenta/Ejec. asignado SIEMPRE reflejan al dueño real del proyecto,
// para que el acceso por fila (filtroRolesNotion) nunca deje una cotización
// invisible para quien sí debería verla.
async function _heredarRoles(opId, clienteId) {
  const vacio = { propietario: '', ejecCuenta: '', ejecAsignado: '', ejec: '' };
  try {
    if (opId) {
      const op = await getRow('ops', opId);
      return {
        propietario:  op.propietario || '',
        ejecCuenta:   op.ejecCuenta || '',
        ejecAsignado: op.ejecAsignado || '',
        ejec:         op.ejec || '',
      };
    }
    if (clienteId) {
      const cli = await getRow('clientes', clienteId);
      return {
        propietario:  cli.propietario || '',
        ejecCuenta:   cli.ejecCuenta || '',
        ejecAsignado: cli.ejecAsignado || '',
        ejec:         cli.ejecAsignado || '',
      };
    }
  } catch (_) { /* OP/cliente inválido — se deja vacío, no se puede heredar */ }
  return vacio;
}

router.get('/', async (req, res) => {
  try {
    let rows = await queryDB('cotizaciones', null, { field: 'fecha', direction: 'descending' });
    if (req.rolFilter) rows = rows.filter(r => perteneceAlRegistro(r, req.rolFilter));
    res.json(await Promise.all(rows.map(toObj)));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const row = await getRow('cotizaciones', req.params.id);
    if (!assertRolAccess(req, res, row)) return;
    res.json(await toObj(row));
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// Alta de cotización: multipart con campos de texto + los archivos "pdf" y "excel".
router.post('/', upload.fields([{ name: 'pdf', maxCount: 1 }, { name: 'excel', maxCount: 1 }]), async (req, res) => {
  try {
    const pdfFile   = req.files?.pdf?.[0];
    const excelFile = req.files?.excel?.[0];
    if (!pdfFile && !excelFile) {
      return res.status(400).json({ error: 'Sube al menos un archivo (PDF o Excel)' });
    }

    const opId      = req.body.opId || '';
    const clienteId = req.body.clienteId || '';
    const roles = await _heredarRoles(opId, clienteId);
    // Fuera de oficina total: si no participa en los 3 roles heredados, no
    // puede subir la cotización — mismo criterio de acceso que el resto.
    if (req.rolFilter) {
      const pertenece = [roles.propietario, roles.ejecCuenta, roles.ejecAsignado, roles.ejec].includes(req.rolFilter);
      if (!pertenece) return res.status(403).json({ error: 'No tienes permiso para subir cotizaciones a esta OP/cliente' });
    }

    const [pdfRuta, excelRuta] = await Promise.all([
      pdfFile   ? subirArchivo(BUCKET, pdfFile.buffer, pdfFile.originalname, pdfFile.mimetype)     : null,
      excelFile ? subirArchivo(BUCKET, excelFile.buffer, excelFile.originalname, excelFile.mimetype) : null,
    ]);

    const data = {
      cotId:     req.body.cotId || '',
      opId,
      clienteId,
      version:   req.body.version || '',
      fecha:     req.body.fecha || new Date().toISOString().split('T')[0],
      status:    req.body.status || 'Enviada',
      ...roles,
      pdfArchivo:   pdfRuta   ? { ruta: pdfRuta,   name: pdfFile.originalname }   : null,
      excelArchivo: excelRuta ? { ruta: excelRuta, name: excelFile.originalname } : null,
    };

    const created = await createRow('cotizaciones', toRow(data));
    res.json(await toObj(created));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Editar metadatos (status, versión). Los archivos se reemplazan re-subiendo.
// Los 3 roles NUNCA se tocan aquí — se heredaron al crear y son fijos, igual
// que en la OP de la que vienen.
router.patch('/:id', upload.fields([{ name: 'pdf', maxCount: 1 }, { name: 'excel', maxCount: 1 }]), async (req, res) => {
  try {
    const existing = await getRow('cotizaciones', req.params.id);
    if (!assertRolAccess(req, res, existing)) return;

    const body = { ...req.body };
    delete body.propietario; delete body.ejecCuenta; delete body.ejecAsignado; delete body.ejec;

    const pdfFile   = req.files?.pdf?.[0];
    const excelFile = req.files?.excel?.[0];
    if (pdfFile) {
      const ruta = await subirArchivo(BUCKET, pdfFile.buffer, pdfFile.originalname, pdfFile.mimetype);
      body.pdfArchivo = { ruta, name: pdfFile.originalname };
    }
    if (excelFile) {
      const ruta = await subirArchivo(BUCKET, excelFile.buffer, excelFile.originalname, excelFile.mimetype);
      body.excelArchivo = { ruta, name: excelFile.originalname };
    }

    const updated = await updateRow('cotizaciones', req.params.id, toRow(body));
    res.json(await toObj(updated));
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// Errores de multer (tipo no permitido, archivo > 20 MB) → 400 legible.
router.use((err, _req, res, _next) => {
  const msg = err?.code === 'LIMIT_FILE_SIZE'
    ? 'El archivo supera el límite de 20 MB'
    : (err?.message || 'Error al procesar el archivo');
  res.status(400).json({ error: msg });
});

module.exports = router;
