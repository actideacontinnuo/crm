const express = require('express');
const router = express.Router();
const multer = require('multer');
const {
  notion, queryDB, createPage, updatePage,
  prop_title, prop_text, prop_select, prop_date, prop_files,
  read_title, read_text, read_select, read_date, read_files,
  uploadFileToNotion,
} = require('./notion');
const { assertOwnership, forceOwnerOnCreate } = require('./_guard');

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
    ejec:      read_select(p['Ejecutivo']),
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
  if (data.ejec      !== undefined) props['Ejecutivo']  = prop_select(data.ejec);
  if (data.pdfFiles   !== undefined) props['PDF']   = prop_files(data.pdfFiles);
  if (data.excelFiles !== undefined) props['Excel'] = prop_files(data.excelFiles);
  return props;
}

router.get('/', async (req, res) => {
  try {
    const filter = req.ejecFilter
      ? { property: 'Ejecutivo', select: { equals: req.ejecFilter } }
      : null;
    const pages = await queryDB('cotizaciones', filter, [{ property: 'Fecha', direction: 'descending' }]);
    res.json(pages.map(toObj));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const page = await notion.pages.retrieve({ page_id: req.params.id });
    const obj = toObj(page);
    if (!assertOwnership(req, res, obj.ejec)) return;
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

    // Subir cada archivo a Notion en paralelo
    const [pdfId, excelId] = await Promise.all([
      pdfFile   ? uploadFileToNotion(pdfFile.buffer, pdfFile.originalname, pdfFile.mimetype)     : null,
      excelFile ? uploadFileToNotion(excelFile.buffer, excelFile.originalname, excelFile.mimetype) : null,
    ]);

    const data = forceOwnerOnCreate(req, {
      cotId:     req.body.cotId || '',
      opId:      req.body.opId || '',
      clienteId: req.body.clienteId || '',
      version:   req.body.version || '',
      fecha:     req.body.fecha || new Date().toISOString().split('T')[0],
      status:    req.body.status || 'Enviada',
      ejec:      req.body.ejec,
      pdfFiles:   pdfId   ? [{ id: pdfId,   name: pdfFile.originalname }]   : [],
      excelFiles: excelId ? [{ id: excelId, name: excelFile.originalname }] : [],
    });

    const page = await createPage('cotizaciones', toProps(data));
    res.json(toObj(page));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Editar metadatos (status, versión). Los archivos se reemplazan re-subiendo.
router.patch('/:id', upload.fields([{ name: 'pdf', maxCount: 1 }, { name: 'excel', maxCount: 1 }]), async (req, res) => {
  try {
    const existing = await notion.pages.retrieve({ page_id: req.params.id });
    if (!assertOwnership(req, res, toObj(existing).ejec)) return;

    const body = { ...req.body };
    if (req.ejecFilter) delete body.ejec;

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
