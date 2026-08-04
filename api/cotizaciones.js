const express = require('express');
const router = express.Router();
const multer = require('multer');
const {
  notion, queryDB, createPage, updatePage,
  prop_title, prop_text, prop_select, prop_date, prop_files,
  read_title, read_text, read_select, read_date, read_files,
  uploadFileToNotion,
} = require('./notion');
const { filtroRolesNotion, assertRolAccess } = require('./_guard');

// Cotizaciones: SOLO archivos. Cada cotización es un PDF + un Excel guardados en
// Notion. No hay cotizador, secciones ni cálculos: el documento es la fuente.
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

function toObj(page) {
  const p = page.properties;
  return {
    id:        page.id,
    cotId:     read_title(p['ID Cot']),
    opId:      read_text(p['OP ID']),
    clienteId: read_text(p['Cliente ID']),
    version:   read_text(p['Versión']),
    fecha:     read_date(p['Fecha']),
    status:    read_select(p['Status']),
    ejec:      read_select(p['Ejecutivo']),          // legado (compatibilidad)
    propietario:  read_select(p['Propietario']),      // heredados de la OP (o del cliente)
    ejecCuenta:   read_select(p['EjecutivoCuenta']),
    ejecAsignado: read_select(p['EjecutivoAsignado']),
    pdf:       read_files(p['PDF']),   // [{ name, url }]
    excel:     read_files(p['Excel']),
  };
}

function toProps(data) {
  const props = {};
  if (data.cotId     !== undefined) props['ID Cot']     = prop_title(data.cotId);
  if (data.opId      !== undefined) props['OP ID']      = prop_text(data.opId);
  if (data.clienteId !== undefined) props['Cliente ID'] = prop_text(data.clienteId);
  if (data.version   !== undefined) props['Versión']    = prop_text(data.version);
  if (data.fecha     !== undefined) props['Fecha']      = prop_date(data.fecha);
  if (data.status    !== undefined) props['Status']     = prop_select(data.status);
  if (data.ejec         !== undefined) props['Ejecutivo']         = prop_select(data.ejec);
  if (data.propietario  !== undefined) props['Propietario']       = prop_select(data.propietario);
  if (data.ejecCuenta   !== undefined) props['EjecutivoCuenta']   = prop_select(data.ejecCuenta);
  if (data.ejecAsignado !== undefined) props['EjecutivoAsignado'] = prop_select(data.ejecAsignado);
  if (data.pdfFiles   !== undefined) props['PDF']   = prop_files(data.pdfFiles);
  if (data.excelFiles !== undefined) props['Excel'] = prop_files(data.excelFiles);
  return props;
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
      const op = await notion.pages.retrieve({ page_id: opId });
      const p = op.properties;
      return {
        propietario:  read_select(p['Propietario']),
        ejecCuenta:   read_select(p['EjecutivoCuenta']),
        ejecAsignado: read_select(p['EjecutivoAsignado']),
        ejec:         read_select(p['Ejecutivo']),
      };
    }
    if (clienteId) {
      const cli = await notion.pages.retrieve({ page_id: clienteId });
      const p = cli.properties;
      const ejecAsignado = read_select(p['EjecutivoAsignado']);
      return {
        propietario:  read_select(p['Propietario']),
        ejecCuenta:   read_select(p['EjecutivoCuenta']),
        ejecAsignado,
        ejec:         ejecAsignado,
      };
    }
  } catch (_) { /* OP/cliente inválido — se deja vacío, no se puede heredar */ }
  return vacio;
}

router.get('/', async (req, res) => {
  try {
    const filter = req.rolFilter ? filtroRolesNotion(req.rolFilter) : null;
    const pages = await queryDB('cotizaciones', filter, [{ property: 'Fecha', direction: 'descending' }]);
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

    // Subir cada archivo a Notion en paralelo
    const [pdfId, excelId] = await Promise.all([
      pdfFile   ? uploadFileToNotion(pdfFile.buffer, pdfFile.originalname, pdfFile.mimetype)     : null,
      excelFile ? uploadFileToNotion(excelFile.buffer, excelFile.originalname, excelFile.mimetype) : null,
    ]);

    const data = {
      cotId:     req.body.cotId || '',
      opId,
      clienteId,
      version:   req.body.version || '',
      fecha:     req.body.fecha || new Date().toISOString().split('T')[0],
      status:    req.body.status || 'Enviada',
      ...roles,
      pdfFiles:   pdfId   ? [{ id: pdfId,   name: pdfFile.originalname }]   : [],
      excelFiles: excelId ? [{ id: excelId, name: excelFile.originalname }] : [],
    };

    const page = await createPage('cotizaciones', toProps(data));
    res.json(toObj(page));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Editar metadatos (status, versión). Los archivos se reemplazan re-subiendo.
// Los 3 roles NUNCA se tocan aquí — se heredaron al crear y son fijos, igual
// que en la OP de la que vienen.
router.patch('/:id', upload.fields([{ name: 'pdf', maxCount: 1 }, { name: 'excel', maxCount: 1 }]), async (req, res) => {
  try {
    const existing = await notion.pages.retrieve({ page_id: req.params.id });
    const obj = toObj(existing);
    if (!assertRolAccess(req, res, obj)) return;

    const body = { ...req.body };
    delete body.propietario; delete body.ejecCuenta; delete body.ejecAsignado; delete body.ejec;

    const pdfFile   = req.files?.pdf?.[0];
    const excelFile = req.files?.excel?.[0];
    if (pdfFile) {
      const id = await uploadFileToNotion(pdfFile.buffer, pdfFile.originalname, pdfFile.mimetype);
      body.pdfFiles = [{ id, name: pdfFile.originalname }];
    }
    if (excelFile) {
      const id = await uploadFileToNotion(excelFile.buffer, excelFile.originalname, excelFile.mimetype);
      body.excelFiles = [{ id, name: excelFile.originalname }];
    }

    const page = await updatePage(req.params.id, toProps(body));
    res.json(toObj(page));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Errores de multer (tipo no permitido, archivo > 20 MB) → 400 legible.
router.use((err, _req, res, _next) => {
  const msg = err?.code === 'LIMIT_FILE_SIZE'
    ? 'El archivo supera el límite de 20 MB'
    : (err?.message || 'Error al procesar el archivo');
  res.status(400).json({ error: msg });
});

module.exports = router;
