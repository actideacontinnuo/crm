/**
 * Integration tests — Vision AI (análisis de documentos)
 * El SDK de Anthropic se mockea: nunca se llama a la API real.
 */
const request = require('supertest');
const express = require('express');

const mockCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  }));
});

function buildVisionApp() {
  const app = express();
  app.use('/api/vision', require('../../api/vision'));
  return app;
}

const PNG_FAKE = Buffer.from('89504e470d0a1a0a', 'hex'); // cabecera PNG mínima
const PDF_FAKE = Buffer.from('%PDF-1.4 fake');

let app;
beforeEach(() => {
  jest.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-falso';
  app = buildVisionApp();
});

describe('Validación de entrada', () => {
  test('tipo inválido → 400', async () => {
    const res = await request(app).post('/api/vision/pasaporte')
      .attach('file', PNG_FAKE, { filename: 'doc.png', contentType: 'image/png' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Tipo inválido/);
  });

  test('sin archivo → 400', async () => {
    const res = await request(app).post('/api/vision/csf');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No se recibió/);
  });

  test('mimetype no permitido (ej. .exe) es rechazado por el filtro → 400', async () => {
    const res = await request(app).post('/api/vision/csf')
      .attach('file', Buffer.from('MZ...'), { filename: 'virus.exe', contentType: 'application/x-msdownload' });
    expect(res.status).toBe(400);
  });

  test('sin ANTHROPIC_API_KEY → 503', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await request(app).post('/api/vision/csf')
      .attach('file', PNG_FAKE, { filename: 'csf.png', contentType: 'image/png' });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/ANTHROPIC_API_KEY/);
  });
});

describe('Análisis de documentos (SDK mockeado)', () => {
  test('CSF como imagen: extrae RFC y razón social', async () => {
    mockCreate.mockResolvedValue({
      content: [{ text: '{"rfc":"GMO123456AB1","razonSocial":"Grupo Modelo SA","valido":true}' }],
    });
    const res = await request(app).post('/api/vision/csf')
      .attach('file', PNG_FAKE, { filename: 'csf.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.rfc).toBe('GMO123456AB1');

    // La imagen debe enviarse como bloque tipo "image"
    const call = mockCreate.mock.calls[0][0];
    expect(call.messages[0].content[0].type).toBe('image');
  });

  test('Opinión de Cumplimiento como PDF: usa bloque tipo "document"', async () => {
    mockCreate.mockResolvedValue({
      content: [{ text: '{"sentido":"POSITIVO","valido":true}' }],
    });
    const res = await request(app).post('/api/vision/oc')
      .attach('file', PDF_FAKE, { filename: 'oc.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(200);
    expect(res.body.data.sentido).toBe('POSITIVO');

    const call = mockCreate.mock.calls[0][0];
    expect(call.messages[0].content[0].type).toBe('document');
    expect(call.messages[0].content[0].source.media_type).toBe('application/pdf');
  });

  test('Estado de cuenta: extrae banco y CLABE', async () => {
    mockCreate.mockResolvedValue({
      content: [{ text: 'Aquí está el JSON: {"banco":"BBVA","clabe":"012180001234567895","valido":true}' }],
    });
    const res = await request(app).post('/api/vision/ec')
      .attach('file', PNG_FAKE, { filename: 'edo.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
    expect(res.body.data.banco).toBe('BBVA'); // extrae el JSON aunque venga con texto extra
  });

  test('respuesta sin JSON devuelve el texto crudo en data.raw', async () => {
    mockCreate.mockResolvedValue({ content: [{ text: 'No pude leer el documento' }] });
    const res = await request(app).post('/api/vision/csf')
      .attach('file', PNG_FAKE, { filename: 'csf.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
    expect(res.body.data.raw).toBe('No pude leer el documento');
  });

  test('error del SDK → 500 controlado', async () => {
    mockCreate.mockRejectedValue(new Error('API caída'));
    const res = await request(app).post('/api/vision/csf')
      .attach('file', PNG_FAKE, { filename: 'csf.png', contentType: 'image/png' });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('API caída');
  });
});
