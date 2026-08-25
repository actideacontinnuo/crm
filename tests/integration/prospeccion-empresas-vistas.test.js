/**
 * Integration test — Prospección: una empresa YA MOSTRADA en una búsqueda
 * anterior no debe volver a aparecer, aunque nunca se haya subido como
 * Prospecto. Se monta una app mínima propia (en vez de usar
 * tests/helpers/test-app.js) porque ese helper mockea api/_audit como no-op
 * para TODAS las suites — aquí necesitamos el logAudit real (respaldado por
 * el mock de Notion) porque el propio historial de "empresas vistas" se
 * apoya en logAudit + queryDB('auditoria').
 */
const request    = require('supertest');
const mockNotion = require('../helpers/mock-notion');

jest.mock('../../api/notion', () => mockNotion);
jest.mock('node-fetch');
const fetch = require('node-fetch');

const express = require('express');
const { authMiddleware } = require('../../middleware/auth');
const { soloNatalia } = require('../../api/_guard');
const jwt = require('jsonwebtoken');
const { SECRET } = require('../../middleware/auth');

function buildAppConAuditoriaReal() {
  const app = express();
  app.use(express.json());
  app.use('/api', authMiddleware);
  app.use('/api/prospectos', require('../../api/prospectos'));
  app.use('/api/prospeccion', soloNatalia, require('../../api/prospeccion'));
  return app;
}

const natToken = () =>
  jwt.sign({ id: 'natalia', nombre: 'Natalia', role: 'admin', ejec: 'Natalia Gama' }, SECRET, { expiresIn: '1h' });

function jsonResp(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

let app;
const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  mockNotion.resetStore();
  app = buildAppConAuditoriaReal();
  fetch.mockReset();
  process.env = { ...ORIGINAL_ENV, APOLLO_API_KEY: 'apollo-test' };
});
afterAll(() => { process.env = ORIGINAL_ENV; });

function mockApolloLead(id, company) {
  fetch
    .mockResolvedValueOnce(jsonResp(200, { people: [
      { id, first_name: 'Juan', last_name_obfuscated: 'P.', title: 'Director', organization: { name: company }, has_email: true },
    ] }))
    .mockResolvedValueOnce(jsonResp(200, { matches: [
      { id, last_name: 'Pérez', email: `${id}@${company.toLowerCase().replace(/\s+/g, '')}.com`, email_status: 'verified', organization: { name: company } },
    ] }));
}

test('una empresa mostrada en una búsqueda anterior NO se vuelve a mostrar, aunque nunca se haya subido a Prospectos', async () => {
  // Primera búsqueda: Apollo trae "Globex" — se muestra y queda registrada como "vista".
  mockApolloLead('p1', 'Globex');
  const r1 = await request(app).post('/api/prospeccion/buscar')
    .set('Authorization', `Bearer ${natToken()}`).send({ sectors: ['events-services'], perSector: 1 });
  expect(r1.body.leads).toHaveLength(1);
  expect(r1.body.leads[0].company).toBe('Globex');

  // Natalia NUNCA la sube a Prospectos (no hay ningún registro Notion de Globex).
  const prospectos = await request(app).get('/api/prospectos').set('Authorization', `Bearer ${natToken()}`);
  expect(prospectos.body.find(p => p.empresa === 'Globex')).toBeUndefined();

  // Segunda búsqueda: Apollo vuelve a traer la MISMA empresa (otro contacto,
  // otro email) — antes del fix, esto se colaba porque no había ningún
  // registro real de Prospecto contra el cual comparar.
  mockApolloLead('p2', 'Globex');
  const r2 = await request(app).post('/api/prospeccion/buscar')
    .set('Authorization', `Bearer ${natToken()}`).send({ sectors: ['events-services'], perSector: 1 });

  expect(r2.body.leads).toHaveLength(0); // ya se había mostrado — no debe reaparecer
  expect(r2.body.errors.some(e => /Globex/.test(e.error || ''))).toBe(true);
});
