/**
 * Integration tests — Ramas restantes de cobertura
 * Cubre: filtro por ejecutivo en listados, aliases de campos,
 * JSON malformado guardado en Notion, y variantes de docs/historial.
 */
const request    = require('supertest');
const mockNotion = require('../helpers/mock-notion');

jest.mock('../../api/notion', () => require('../helpers/mock-notion'));
jest.mock('../../api/_audit', () => ({ logAudit: jest.fn(), clientIp: () => '127.0.0.1' }));

const { buildApp } = require('../helpers/test-app');
const jwt = require('jsonwebtoken');
const { SECRET } = require('../../middleware/auth');

const adminToken = () =>
  jwt.sign({ id: 'natalia', nombre: 'Natalia', role: 'admin', ejec: 'Natalia Gama' }, SECRET, { expiresIn: '1h' });
const ejecToken = () =>
  jwt.sign({ id: 'alexia', nombre: 'Alexia', role: 'ejecutivo', ejec: 'Alexia' }, SECRET, { expiresIn: '1h' });

let app;
beforeEach(() => {
  mockNotion.resetStore();
  app = buildApp();
});

async function crear(ruta, body, token = adminToken()) {
  const res = await request(app).post(ruta).set('Authorization', `Bearer ${token}`).send(body);
  expect(res.status).toBe(200);
  return res.body;
}

describe('Listados filtrados por ejecutivo', () => {
  test('prospectos: el ejecutivo solo ve los suyos', async () => {
    await crear('/api/prospectos', { empresa: 'DeNatalia', ejec: 'Natalia Gama' });
    await crear('/api/prospectos', { empresa: 'DeAlexia', ejec: 'Alexia' });
    const res = await request(app).get('/api/prospectos').set('Authorization', `Bearer ${ejecToken()}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].empresa).toBe('DeAlexia');
  });

  test('clientes: el ejecutivo solo ve los suyos', async () => {
    await crear('/api/clientes', { nombre: 'ClienteNatalia', ejec: 'Natalia Gama' });
    await crear('/api/clientes', { nombre: 'ClienteAlexia', ejec: 'Alexia' });
    const res = await request(app).get('/api/clientes').set('Authorization', `Bearer ${ejecToken()}`);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].nombre).toBe('ClienteAlexia');
  });

  test('ops y cotizaciones: el ejecutivo solo ve las suyas', async () => {
    await crear('/api/ops', { numero: 'OP-N', ejec: 'Natalia Gama' });
    await crear('/api/ops', { numero: 'OP-A', ejec: 'Alexia' });
    await crear('/api/cotizaciones', { cotId: 'COT-N', ejec: 'Natalia Gama' });
    await crear('/api/cotizaciones', { cotId: 'COT-A', ejec: 'Alexia' });
    const ops = await request(app).get('/api/ops').set('Authorization', `Bearer ${ejecToken()}`);
    expect(ops.body.map(o => o.numero)).toEqual(['OP-A']);
    const cots = await request(app).get('/api/cotizaciones').set('Authorization', `Bearer ${ejecToken()}`);
    expect(cots.body.map(c => c.cotId)).toEqual(['COT-A']);
  });
});

describe('Propiedad del ejecutivo sobre sus registros', () => {
  test('clientes: el ejecutivo ve y edita el suyo; su campo ejec se ignora al editar', async () => {
    const cli = await crear('/api/clientes', { nombre: 'Mío' }, ejecToken());
    expect(cli.ejec).toBe('Alexia'); // dueño forzado al crear

    const get = await request(app).get(`/api/clientes/${cli.id}`).set('Authorization', `Bearer ${ejecToken()}`);
    expect(get.status).toBe(200);

    const patch = await request(app).patch(`/api/clientes/${cli.id}`)
      .set('Authorization', `Bearer ${ejecToken()}`).send({ status: 'Activo', ejec: 'Otro' });
    expect(patch.status).toBe(200);
    expect(patch.body.ejec).toBe('Alexia');
  });

  test('clientes: el ejecutivo NO ve ni edita clientes ajenos (403)', async () => {
    const cli = await crear('/api/clientes', { nombre: 'Ajeno', ejec: 'Natalia Gama' });
    const get = await request(app).get(`/api/clientes/${cli.id}`).set('Authorization', `Bearer ${ejecToken()}`);
    expect(get.status).toBe(403);
    const patch = await request(app).patch(`/api/clientes/${cli.id}`)
      .set('Authorization', `Bearer ${ejecToken()}`).send({ status: 'X' });
    expect(patch.status).toBe(403);
  });

  test('clientes: DELETE como admin funciona', async () => {
    const cli = await crear('/api/clientes', { nombre: 'Borrar' });
    const del = await request(app).delete(`/api/clientes/${cli.id}`).set('Authorization', `Bearer ${adminToken()}`);
    expect(del.status).toBe(200);
  });

  test('prospectos: el ejecutivo edita el suyo (sin poder reasignar dueño)', async () => {
    const pr = await crear('/api/prospectos', { empresa: 'Mía' }, ejecToken());
    expect(pr.ejec).toBe('Alexia');
    const patch = await request(app).patch(`/api/prospectos/${pr.id}`)
      .set('Authorization', `Bearer ${ejecToken()}`).send({ status: 'Calificado', ejec: 'Otro' });
    expect(patch.status).toBe(200);
    expect(patch.body.ejec).toBe('Alexia');
  });
});

describe('Aliases y variantes de campos', () => {
  test('ops: acepta num como alias de numero', async () => {
    const op = await crear('/api/ops', { num: 'OP-NUM' });
    expect(op.numero).toBe('OP-NUM');
  });

  test('clientes: docs como string se guarda tal cual', async () => {
    const cli = await crear('/api/clientes', { nombre: 'DocsTexto', docs: 'csf-pendiente' });
    expect(cli.docs).toBe('csf-pendiente');
  });

  test('clientes: docs como objeto se serializa a JSON', async () => {
    const cli = await crear('/api/clientes', { nombre: 'DocsObj', docs: { csf: true, oc: { sentido: 'POSITIVO' } } });
    expect(JSON.parse(cli.docs)).toEqual({ csf: true, oc: { sentido: 'POSITIVO' } });
  });
});

describe('JSON malformado guardado en Notion (no debe romper la lectura)', () => {
  function paginaConTexto(campoTitulo, titulo, campoTexto, texto) {
    return {
      id: 'seed-' + campoTexto.toLowerCase().replace(/\s/g, '-'),
      properties: {
        [campoTitulo]: { title: [{ plain_text: titulo }] },
        [campoTexto]:  { rich_text: [{ plain_text: texto }] },
      },
    };
  }

  test('prospecto con Notas corruptas devuelve notas []', async () => {
    mockNotion.getStore().prospectos.push(paginaConTexto('Empresa', 'Corrupta', 'Notas', '{esto-no-es-json'));
    mockNotion.getStore().prospectos.push(paginaConTexto('Empresa', 'NoArray', 'Notas', '{"a":1}'));
    const res = await request(app).get('/api/prospectos').set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    for (const p of res.body) expect(p.notas).toEqual([]);
  });

  test('caso con Historial corrupto devuelve historial []', async () => {
    mockNotion.getStore().casos.push(paginaConTexto('Título', 'Corrupto', 'Historial', 'no-json'));
    mockNotion.getStore().casos.push(paginaConTexto('Título', 'NoArray', 'Historial', '"texto"'));
    const res = await request(app).get('/api/casos').set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    for (const c of res.body) expect(c.historial).toEqual([]);
  });

  test('cotización con Secciones corruptas devuelve las secciones por defecto', async () => {
    mockNotion.getStore().cotizaciones.push(paginaConTexto('ID Cot', 'COT-X', 'Secciones', '{rota'));
    const res = await request(app).get('/api/cotizaciones').set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body[0].secciones).toEqual({ audio: [], esceno: [], logistica: [], catering: [], otros: [] });
  });
});
