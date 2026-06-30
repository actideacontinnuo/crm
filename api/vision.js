const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const fs      = require('fs');
const path    = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const upload = multer({
  dest: path.join(__dirname, '../uploads/'),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter(req, file, cb) {
    const ok = ['image/jpeg','image/png','image/webp','application/pdf'].includes(file.mimetype);
    cb(null, ok);
  },
});

const PROMPTS = {
  csf: `Eres un asistente experto en documentos fiscales mexicanos.
Analiza esta Constancia de Situación Fiscal (CSF) del SAT y extrae los siguientes campos.
Responde SOLO con JSON válido, sin texto extra:
{
  "rfc": "RFC de 12 o 13 caracteres",
  "razonSocial": "Nombre o Razón Social exacta",
  "direccion": "Domicilio fiscal completo (calle, número, colonia, ciudad, CP)",
  "regimenFiscal": "Nombre del régimen fiscal",
  "fechaAlta": "Fecha de alta en el SAT (YYYY-MM-DD o la que aparezca)",
  "valido": true,
  "observaciones": "Cualquier advertencia o dato relevante"
}
Si el documento NO es una CSF del SAT, pon valido:false y explica en observaciones.`,

  oc: `Eres un asistente experto en documentos fiscales mexicanos.
Analiza esta Opinión de Cumplimiento del SAT y extrae la información.
Responde SOLO con JSON válido, sin texto extra:
{
  "rfc": "RFC del contribuyente",
  "nombre": "Nombre o Razón Social",
  "sentido": "POSITIVO o NEGATIVO",
  "fechaConsulta": "Fecha de la consulta (YYYY-MM-DD)",
  "mesVigente": true/false (¿es del mes en curso o muy reciente?),
  "valido": true/false,
  "observaciones": "Advertencias: si está vencida, si es negativa, etc."
}
Si el documento NO es una Opinión de Cumplimiento, pon valido:false.`,

  ec: `Eres un asistente experto en documentos bancarios mexicanos.
Analiza esta carátula de estado de cuenta bancario y extrae la información.
Responde SOLO con JSON válido, sin texto extra:
{
  "banco": "Nombre del banco (BBVA, Santander, Banorte, HSBC, Banamex, etc.)",
  "titular": "Nombre del titular de la cuenta",
  "clabe": "CLABE interbancaria de 18 dígitos (si aparece)",
  "numeroCuenta": "Número de cuenta (si aparece)",
  "periodo": "Período del estado de cuenta",
  "valido": true/false,
  "observaciones": "Datos faltantes o advertencias"
}
Si el documento NO es un estado de cuenta, pon valido:false.`,
};

router.post('/:tipo', upload.single('file'), async (req, res) => {
  const tipo = req.params.tipo;
  if (!PROMPTS[tipo]) return res.status(400).json({ error: 'Tipo inválido. Usa: csf, oc, ec' });
  if (!req.file)      return res.status(400).json({ error: 'No se recibió ningún archivo' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    fs.unlinkSync(req.file.path);
    return res.status(503).json({ error: 'ANTHROPIC_API_KEY no configurada en .env' });
  }

  try {
    const fileBuffer = fs.readFileSync(req.file.path);
    const base64     = fileBuffer.toString('base64');
    const mimeType   = req.file.mimetype;

    const client = new Anthropic({ apiKey });

    // PDF → send as document, image → send as image
    let contentBlock;
    if (mimeType === 'application/pdf') {
      contentBlock = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } };
    } else {
      contentBlock = { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } };
    }

    const message = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1024,
      messages: [{ role: 'user', content: [contentBlock, { type: 'text', text: PROMPTS[tipo] }] }],
    });

    const text = message.content[0].text.trim();
    // Extract JSON even if model adds markdown fences
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw: text };

    res.json({ ok: true, tipo, data: parsed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
  }
});

module.exports = router;
