/**
 * Integration tests — Marketing y Prospección
 * Cubre: el gate de acceso exclusivo de Natalia (soloNatalia — no todo el rol
 * admin), y los endpoints síncronos de Apollo/Claude/Notion/Higgsfield/Meta
 * (red mockeada vía node-fetch).
 */
const request    = require('supertest');
const mockNotion = require('../helpers/mock-notion');

jest.mock('../../api/notion', () => require('../helpers/mock-notion'));
jest.mock('../../api/_audit', () => ({ logAudit: jest.fn(), clientIp: () => '127.0.0.1' }));
jest.mock('node-fetch');
const fetch = require('node-fetch');

const { buildApp } = require('../helpers/test-app');
const jwt = require('jsonwebtoken');
const { SECRET } = require('../../middleware/auth');

const natToken = () =>
  jwt.sign({ id: 'natalia', nombre: 'Natalia', role: 'admin', ejec: 'Natalia Gama' }, SECRET, { expiresIn: '1h' });
const otroAdminToken = () =>
  jwt.sign({ id: 'oscar', nombre: 'Oscar', role: 'admin', ejec: 'Otro Admin' }, SECRET, { expiresIn: '1h' });
const ejecToken = () =>
  jwt.sign({ id: 'alexia', nombre: 'Alexia', role: 'ejecutivo', ejec: 'Alexia' }, SECRET, { expiresIn: '1h' });
const administracionToken = () =>
  jwt.sign({ id: 'oscar2', nombre: 'Oscar', role: 'administracion', ejec: 'Oscar' }, SECRET, { expiresIn: '1h' });

function jsonResp(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

let app;
const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  mockNotion.resetStore();
  app = buildApp();
  fetch.mockReset();
  process.env = { ...ORIGINAL_ENV, APOLLO_API_KEY: 'apollo-test', ANTHROPIC_API_KEY: 'anthropic-test', HIGGSFIELD_API_KEY: 'hfid:hfsecret' };
});
afterAll(() => { process.env = ORIGINAL_ENV; });

describe('Acceso exclusivo de Natalia — no todo el rol admin', () => {
  test('otro admin (no Natalia) recibe 403 en Marketing', async () => {
    const res = await request(app).get('/api/marketing/meta/status').set('Authorization', `Bearer ${otroAdminToken()}`);
    expect(res.status).toBe(403);
  });

  test('otro admin (no Natalia) recibe 403 en Prospección', async () => {
    const res = await request(app).get('/api/prospeccion/config/status').set('Authorization', `Bearer ${otroAdminToken()}`);
    expect(res.status).toBe(403);
  });

  test('un ejecutivo recibe 403 en ambas secciones', async () => {
    const m = await request(app).get('/api/marketing/meta/status').set('Authorization', `Bearer ${ejecToken()}`);
    const p = await request(app).get('/api/prospeccion/config/status').set('Authorization', `Bearer ${ejecToken()}`);
    expect(m.status).toBe(403);
    expect(p.status).toBe(403);
  });

  test('administración (Oscar) recibe 403 — no es Natalia', async () => {
    const res = await request(app).get('/api/marketing/meta/status').set('Authorization', `Bearer ${administracionToken()}`);
    expect(res.status).toBe(403);
  });

  test('Natalia SÍ tiene acceso a ambas secciones', async () => {
    const m = await request(app).get('/api/marketing/meta/status').set('Authorization', `Bearer ${natToken()}`);
    const p = await request(app).get('/api/prospeccion/config/status').set('Authorization', `Bearer ${natToken()}`);
    expect(m.status).toBe(200);
    expect(p.status).toBe(200);
  });

  test('sin token, 401 antes de llegar al gate', async () => {
    const res = await request(app).get('/api/marketing/meta/status');
    expect(res.status).toBe(401);
  });
});

describe('Meta — callback de OAuth público (sin JWT, por diseño)', () => {
  test('GET /api/marketing/meta/callback sin código responde 400, sin pedir auth', async () => {
    const res = await request(app).get('/api/marketing/meta/callback');
    expect(res.status).toBe(400);
  });

  test('con código válido, intercambia tokens y lista las páginas para elegir', async () => {
    fetch
      .mockResolvedValueOnce(jsonResp(200, { access_token: 'short-tok' }))       // 1. token corto
      .mockResolvedValueOnce(jsonResp(200, { access_token: 'long-tok' }))        // 2. canje por token largo
      .mockResolvedValueOnce(jsonResp(200, { data: [{ id: 'page-1', name: 'Actidea Continnuo', access_token: 'page-tok' }] })); // 3. páginas
    const res = await request(app).get('/api/marketing/meta/callback?code=abc123');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/Actidea Continnuo/);
    expect(res.text).toMatch(/select-page\?page_id=page-1/);
  });

  test('si Facebook devuelve error en el intercambio de token, responde 400 con el detalle', async () => {
    fetch.mockResolvedValueOnce(jsonResp(200, { error: { message: 'code inválido o expirado' } }));
    const res = await request(app).get('/api/marketing/meta/callback?code=expirado');
    expect(res.status).toBe(400);
  });

  test('si el usuario no tiene páginas de Facebook, lo informa sin tronar', async () => {
    fetch
      .mockResolvedValueOnce(jsonResp(200, { access_token: 'short-tok' }))
      .mockResolvedValueOnce(jsonResp(200, { access_token: 'long-tok' }))
      .mockResolvedValueOnce(jsonResp(200, { data: [] }));
    const res = await request(app).get('/api/marketing/meta/callback?code=abc123');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/No se encontraron páginas/);
  });
});

describe('Prospección — POST /buscar (Apollo)', () => {
  test('sin APOLLO_API_KEY responde 400', async () => {
    delete process.env.APOLLO_API_KEY;
    const res = await request(app).post('/api/prospeccion/buscar')
      .set('Authorization', `Bearer ${natToken()}`).send({ sectors: ['events-services'] });
    expect(res.status).toBe(400);
  });

  test('busca en Apollo, guarda TODOS los contactos con email de inmediato, y Claude los verifica DESPUÉS de guardar', async () => {
    fetch
      .mockResolvedValueOnce(jsonResp(200, { people: [
        { id: 'p1', first_name: 'Juan', last_name_obfuscated: 'P.', title: 'Director', organization: { name: 'Acme' }, has_email: true },
      ] }))
      .mockResolvedValueOnce(jsonResp(200, { matches: [
        { id: 'p1', last_name: 'Pérez', email: 'juan@acme.com', email_status: 'verified', organization: { name: 'Acme' } },
      ] }))
      .mockResolvedValueOnce(jsonResp(200, { content: [{ text: JSON.stringify([{ id: 'p1', verified: true, confidence: 9, notes: 'ok' }]) }] }));

    const res = await request(app).post('/api/prospeccion/buscar')
      .set('Authorization', `Bearer ${natToken()}`).send({ sectors: ['events-services'], total: 1 });
    expect(res.status).toBe(200);
    expect(res.body.guardados).toBe(1);
    expect(res.body.verificados).toBe(1);
    expect(res.body.noVerificados).toBe(0);
    expect(res.body.detalle[0].email).toBe('juan@acme.com');
    expect(res.body.detalle[0].company).toBe('Acme');
    expect(res.body.detalle[0].name).toBe('Juan Pérez'); // apellido COMPLETO, no el obfuscado
    expect(res.body.detalle[0].confidence).toBe(9);

    const store = mockNotion.getStore();
    const pagina = store.prospectos.find(p => p.properties['Email']?.email === 'juan@acme.com');
    expect(pagina.properties['VerificacionIA']?.select?.name).toBe('Verificado');
    expect(pagina.properties['ConfianzaIA']?.number).toBe(9);
  });

  test('arquitectura confirmada: un contacto con email pero SIN "verified" de Apollo se guarda igual — Claude lo marca DESPUÉS, no se descarta antes', async () => {
    fetch
      .mockResolvedValueOnce(jsonResp(200, { people: [
        { id: 'p1', first_name: 'Juan', last_name_obfuscated: 'P.', title: 'Director', organization: { name: 'Acme' }, has_email: true },
        { id: 'p2', first_name: 'Ana', last_name_obfuscated: 'G.', title: 'Gerente', organization: { name: 'Beta' }, has_email: true },
      ] }))
      .mockResolvedValueOnce(jsonResp(200, { matches: [
        { id: 'p1', last_name: 'Pérez', email: 'juan@acme.com', email_status: 'likely to engage', organization: { name: 'Acme' } },
        // p2 no aparece en 'matches' — el enriquecimiento falló, sin correo que ofrecer — ese SÍ se descarta (email obligatorio).
      ] }))
      .mockResolvedValueOnce(jsonResp(200, { content: [{ text: JSON.stringify([{ id: 'p1', verified: false, confidence: 4, notes: 'dominio no coincide' }]) }] }));

    const res = await request(app).post('/api/prospeccion/buscar')
      .set('Authorization', `Bearer ${natToken()}`).send({ sectors: ['events-services'], total: 2 });
    expect(res.status).toBe(200);
    expect(res.body.guardados).toBe(1);       // p1 se guarda (tiene email), p2 no (sin email)
    expect(res.body.noVerificados).toBe(1);    // Claude lo marcó "No verificado" DESPUÉS de guardarlo
    expect(res.body.verificados).toBe(0);
  });

  test('sin filtros de por medio, siempre usa los defaults (títulos fijos + industria oficial del sector) — los filtros avanzados se retiraron', async () => {
    fetch.mockResolvedValueOnce(jsonResp(200, { people: [] }));
    await request(app).post('/api/prospeccion/buscar')
      .set('Authorization', `Bearer ${natToken()}`).send({ sectors: ['events-services'], total: 1 });
    const sentBody = JSON.parse(fetch.mock.calls[0][1].body);
    expect(sentBody.person_titles).toContain('Director de Eventos');
    expect(sentBody.person_locations).toEqual(['Mexico']);
    // Industria oficial de Apollo (q_organization_keyword_tags), no palabra libre.
    expect(sentBody.q_organization_keyword_tags).toEqual(['events services']);
    expect(sentBody.q_keywords).toBeUndefined();
    expect(sentBody.person_seniorities).toBeUndefined();
  });

  test('"total" se reparte entre los sectores elegidos (1-100 en una sola corrida)', async () => {
    fetch.mockResolvedValue(jsonResp(200, { people: [] }));
    await request(app).post('/api/prospeccion/buscar')
      .set('Authorization', `Bearer ${natToken()}`).send({ sectors: ['events-services', 'hospitality', 'retail'], total: 10 });
    // 10 entre 3 sectores → 4,3,3 (el resto se reparte en los primeros)
    const perPage = fetch.mock.calls.filter(c => c[0].includes('mixed_people')).map(c => JSON.parse(c[1].body).per_page);
    expect(perPage).toEqual([12, 9, 9]); // per_page = cantidad*3, ver _construirBusquedaApollo
  });

  test('"total" nunca pasa de 100 aunque se pida más', async () => {
    fetch.mockResolvedValue(jsonResp(200, { people: [] }));
    await request(app).post('/api/prospeccion/buscar')
      .set('Authorization', `Bearer ${natToken()}`).send({ sectors: ['events-services'], total: 9999 });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.per_page).toBe(300); // 100 * 3
  });
});

describe('Prospección — POST /buscar, ramas de error', () => {
  test('si Apollo responde error en la búsqueda, lo reporta por sector sin tronar', async () => {
    fetch.mockResolvedValueOnce(jsonResp(429, {})); // texto vacío simulando rate limit
    const res = await request(app).post('/api/prospeccion/buscar')
      .set('Authorization', `Bearer ${natToken()}`).send({ sectors: ['events-services'], total: 1 });
    expect(res.status).toBe(200);
    expect(res.body.errors[0].sector).toBe('events-services');
    expect(res.body.guardados).toBe(0);
    expect(res.body.totalEncontrados).toBe(0);
  });

  test('si ningún candidato tiene email, reporta el sector sin resultados', async () => {
    fetch.mockResolvedValueOnce(jsonResp(200, { people: [{ id: 'p1', has_email: false }] }));
    const res = await request(app).post('/api/prospeccion/buscar')
      .set('Authorization', `Bearer ${natToken()}`).send({ sectors: ['events-services'], total: 1 });
    expect(res.status).toBe(200);
    expect(res.body.errors[0].error).toMatch(/No se encontraron contactos/);
  });

  test('sin ningún sector válido responde 400', async () => {
    const res = await request(app).post('/api/prospeccion/buscar')
      .set('Authorization', `Bearer ${natToken()}`).send({ sectors: ['sector-inventado'], total: 5 });
    expect(res.status).toBe(400);
  });

  test('si la red truena buscando en Apollo, reporta el error del sector sin tronar el endpoint', async () => {
    fetch.mockRejectedValueOnce(new Error('timeout de red'));
    const res = await request(app).post('/api/prospeccion/buscar')
      .set('Authorization', `Bearer ${natToken()}`).send({ sectors: ['events-services'], perSector: 1 });
    expect(res.status).toBe(200);
    expect(res.body.errors[0].error).toBe('timeout de red');
  });
});

describe('Prospección — POST /verificar (Claude)', () => {
  test('sin ANTHROPIC_API_KEY hace passthrough con los datos de Apollo', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await request(app).post('/api/prospeccion/verificar')
      .set('Authorization', `Bearer ${natToken()}`)
      .send({ leads: [{ id: 'p1', emailStatus: 'verified' }] });
    expect(res.status).toBe(200);
    expect(res.body.leads[0].verified).toBe(true);
    expect(res.body.warning).toMatch(/Claude no disponible/);
  });

  test('con Claude disponible, aplica el score de confianza devuelto', async () => {
    fetch.mockResolvedValueOnce(jsonResp(200, {
      content: [{ text: JSON.stringify([{ id: 'p1', verified: true, confidence: 9, notes: 'ok' }]) }],
    }));
    const res = await request(app).post('/api/prospeccion/verificar')
      .set('Authorization', `Bearer ${natToken()}`)
      .send({ leads: [{ id: 'p1', name: 'Juan', title: 'Director', company: 'Acme', sectorTitle: 'Corporativo' }] });
    expect(res.status).toBe(200);
    expect(res.body.leads[0].confidence).toBe(9);
  });

  test('si Claude falla, pasa los leads sin verificar en vez de tronar el endpoint', async () => {
    fetch.mockRejectedValueOnce(new Error('timeout de red'));
    const res = await request(app).post('/api/prospeccion/verificar')
      .set('Authorization', `Bearer ${natToken()}`)
      .send({ leads: [{ id: 'p1', name: 'Juan' }] });
    expect(res.status).toBe(200);
    expect(res.body.leads[0].verificationNotes).toMatch(/no disponible/);
  });
});

describe('Prospección — POST /notion/upload crea Prospectos reales con roles correctos', () => {
  test('el lead sube como Prospecto con Fuente=Apollo y notas en JSON válido (no texto plano)', async () => {
    const res = await request(app).post('/api/prospeccion/notion/upload')
      .set('Authorization', `Bearer ${natToken()}`)
      .send({ leads: [{ id: 'p1', company: 'Acme', name: 'Juan Pérez', title: 'Director', email: 'juan@acme.com', phone: '5500000000', sectorTitle: 'Corporativo', confidence: 8, verified: true }] });
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(1);
    expect(res.body.errors).toHaveLength(0);

    // Verifica que el Prospecto quedó bien formado del lado de Notion/CRM
    const lista = await request(app).get('/api/prospectos').set('Authorization', `Bearer ${natToken()}`);
    expect(lista.status).toBe(200);
    const creado = lista.body.find(p => p.empresa === 'Acme');
    expect(creado).toBeDefined();
    expect(creado.fuente).toBe('Apollo');
    expect(creado.contacto).toBe('Juan Pérez');
    // Las notas deben ser JSON parseable — el bug original guardaba texto plano
    // y el parser de prospectos.js lo hubiera descartado como [].
    expect(Array.isArray(creado.notas)).toBe(true);
    expect(creado.notas.length).toBeGreaterThan(0);
    // Reglas de comisión de Apollo (esApollo:true) deben haberse aplicado — el
    // registro no debe quedar sin propietario/ejecCuenta.
    expect(creado.propietario).toBeTruthy();
    expect(creado.ejecCuenta).toBeTruthy();
  });
});

describe('Prospección — Panel Semanal: sector, confianza y origen de carga', () => {
  test('el lead guarda Sector, ConfianzaIA y OrigenCarga en Notion', async () => {
    const res = await request(app).post('/api/prospeccion/notion/upload')
      .set('Authorization', `Bearer ${natToken()}`)
      .send({ origen: 'Automático', leads: [{ id: 'p2', company: 'Acme2', name: 'Ana Ruiz', email: 'ana@acme2.com', sectorTitle: 'Automotriz', confidence: 9 }] });
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(1);
    const store = mockNotion.getStore();
    const pagina = store.prospectos.find(p => p.properties['Email']?.email === 'ana@acme2.com');
    expect(pagina.properties['Sector']?.select?.name).toBe('Automotriz');
    expect(pagina.properties['ConfianzaIA']?.number).toBe(9);
    expect(pagina.properties['OrigenCarga']?.select?.name).toBe('Automático');
  });

  test('evitarDuplicados=true NO crea un prospecto con email ya existente', async () => {
    await request(app).post('/api/prospeccion/notion/upload')
      .set('Authorization', `Bearer ${natToken()}`)
      .send({ leads: [{ id: 'd1', company: 'Dup SA', name: 'Primero', email: 'dup@x.com' }] });
    const res = await request(app).post('/api/prospeccion/notion/upload')
      .set('Authorization', `Bearer ${natToken()}`)
      .send({ evitarDuplicados: true, leads: [{ id: 'd2', company: 'Dup SA', name: 'Segundo', email: 'dup@x.com' }] });
    expect(res.body.created).toBe(0);
    expect(res.body.omitidos).toHaveLength(1);
    expect(res.body.omitidos[0].motivo).toMatch(/ya existe/i);
  });

  test('regla dura: misma EMPRESA con contacto y email DISTINTOS también se bloquea (antes solo se comparaba por email)', async () => {
    await request(app).post('/api/prospeccion/notion/upload')
      .set('Authorization', `Bearer ${natToken()}`)
      .send({ leads: [{ id: 'h1', company: 'Asdeporte', name: 'Mariana Hijar', email: 'mhijar@asdeporte.com' }] });
    const res = await request(app).post('/api/prospeccion/notion/upload')
      .set('Authorization', `Bearer ${natToken()}`)
      .send({ evitarDuplicados: true, leads: [{ id: 'h2', company: 'Asdeporte', name: 'Gonzalo Garces', email: 'ggarces@asdeporte.com' }] });
    expect(res.body.created).toBe(0);
    expect(res.body.omitidos).toHaveLength(1);
    expect(res.body.omitidos[0].motivo).toMatch(/empresa ya existe/i);
  });

  test('la misma empresa con razón social/acentos distintos también se detecta (normalización)', async () => {
    await request(app).post('/api/prospeccion/notion/upload')
      .set('Authorization', `Bearer ${natToken()}`)
      .send({ leads: [{ id: 'h3', company: 'Mondelēz International México', name: 'A', email: 'a@mondelez.com' }] });
    const res = await request(app).post('/api/prospeccion/notion/upload')
      .set('Authorization', `Bearer ${natToken()}`)
      .send({ evitarDuplicados: true, leads: [{ id: 'h4', company: 'MONDELEZ INTERNATIONAL MEXICO, S.A. DE C.V.', name: 'B', email: 'b@mondelez.com' }] });
    expect(res.body.created).toBe(0);
    expect(res.body.omitidos[0].motivo).toMatch(/empresa ya existe/i);
  });

  test('arquitectura confirmada: un lead con emailStatus distinto de "verified" SÍ se sube — Claude verifica DESPUÉS, no antes', async () => {
    const res = await request(app).post('/api/prospeccion/notion/upload')
      .set('Authorization', `Bearer ${natToken()}`)
      .send({ leads: [{ id: 'i1', company: 'Alguna SA', name: 'X', email: 'x@algunasa.com', emailStatus: 'likely to engage' }] });
    expect(res.body.created).toBe(1);
    expect(res.body.omitidos).toHaveLength(0);
  });

  test('un lead con emailStatus="verified" (el flujo real de Apollo) se sube normal', async () => {
    const res = await request(app).post('/api/prospeccion/notion/upload')
      .set('Authorization', `Bearer ${natToken()}`)
      .send({ leads: [{ id: 'i2', company: 'Legitima SA', name: 'Y', email: 'y@legitima.com', emailStatus: 'verified' }] });
    expect(res.body.created).toBe(1);
  });

  test('un lead sin email nunca se sube — obligatorio para todo prospecto de Apollo', async () => {
    const res = await request(app).post('/api/prospeccion/notion/upload')
      .set('Authorization', `Bearer ${natToken()}`)
      .send({ leads: [{ id: 'i3', company: 'Sin Correo SA', name: 'Z', email: '' }] });
    expect(res.body.created).toBe(0);
    expect(res.body.omitidos).toHaveLength(1);
    expect(res.body.omitidos[0].motivo).toMatch(/sin email/i);
  });

  test('todo prospecto de Apollo guarda Ejecutivo = Natalia Gama siempre', async () => {
    const res = await request(app).post('/api/prospeccion/notion/upload')
      .set('Authorization', `Bearer ${natToken()}`)
      .send({ leads: [{ id: 'i4', company: 'Cualquier Empresa SA', name: 'W', email: 'w@cualquierempresa.com' }] });
    expect(res.body.created).toBe(1);
    const store = mockNotion.getStore();
    const pagina = store.prospectos.find(p => p.properties['Email']?.email === 'w@cualquierempresa.com');
    expect(pagina.properties['Ejecutivo']?.select?.name).toBe('Natalia Gama');
  });

  test('evitarDuplicados=false SÍ crea aunque el email ya exista', async () => {
    await request(app).post('/api/prospeccion/notion/upload')
      .set('Authorization', `Bearer ${natToken()}`)
      .send({ leads: [{ id: 'd3', company: 'Dup SA 2', name: 'Primero', email: 'dup2@x.com' }] });
    const res = await request(app).post('/api/prospeccion/notion/upload')
      .set('Authorization', `Bearer ${natToken()}`)
      .send({ evitarDuplicados: false, leads: [{ id: 'd4', company: 'Dup SA 2', name: 'Segundo', email: 'dup2@x.com' }] });
    expect(res.body.created).toBe(1);
  });

  test('duplicados DENTRO del mismo lote también se filtran (no solo contra Notion)', async () => {
    const res = await request(app).post('/api/prospeccion/notion/upload')
      .set('Authorization', `Bearer ${natToken()}`)
      .send({ leads: [
        { id: 'e1', company: 'Mismo Lote', name: 'A', email: 'mismolote@x.com' },
        { id: 'e2', company: 'Mismo Lote', name: 'B', email: 'mismolote@x.com' },
      ] });
    expect(res.body.created).toBe(1);
    expect(res.body.omitidos).toHaveLength(1);
  });

  test('PATCH /marcar-correo-generado marca CorreoGenerado=true', async () => {
    const creado = await request(app).post('/api/prospeccion/notion/upload')
      .set('Authorization', `Bearer ${natToken()}`)
      .send({ leads: [{ id: 'f1', company: 'Flag SA', name: 'X', email: 'flag@x.com' }] });
    const pageId = creado.body.errors.length ? null : (await request(app).get('/api/prospectos').set('Authorization', `Bearer ${natToken()}`)).body.find(p => p.empresa === 'Flag SA').id;
    const res = await request(app).patch(`/api/prospeccion/marcar-correo-generado/${pageId}`)
      .set('Authorization', `Bearer ${natToken()}`);
    expect(res.status).toBe(200);
    const lista = await request(app).get('/api/prospectos').set('Authorization', `Bearer ${natToken()}`);
    const pagina = lista.body.find(p => p.id === pageId);
    // read_checkbox no está expuesto en toObj de prospectos.js — se verifica
    // directo contra el store mock, que es la fuente de verdad del PATCH.
    const store = mockNotion.getStore();
    const raw = store.prospectos.find(p => p.id === pageId);
    expect(raw.properties['CorreoGenerado']?.checkbox).toBe(true);
  });

  test('GET /semanal agrupa por sector y calcula tasa de respuesta', async () => {
    await request(app).post('/api/prospeccion/notion/upload')
      .set('Authorization', `Bearer ${natToken()}`)
      .send({ origen: 'Automático', leads: [
        { id: 'g1', company: 'Sem1', name: 'A', email: 'sem1@x.com', sectorTitle: 'Tecnología', confidence: 8 },
        { id: 'g2', company: 'Sem2', name: 'B', email: 'sem2@x.com', sectorTitle: 'Tecnología', confidence: 9 },
      ] });
    // Uno de los dos "respondió" — su Status pasa de Nuevo a otro valor.
    const lista = await request(app).get('/api/prospectos').set('Authorization', `Bearer ${natToken()}`);
    const p1 = lista.body.find(p => p.empresa === 'Sem1');
    await request(app).patch(`/api/prospectos/${p1.id}`).set('Authorization', `Bearer ${natToken()}`).send({ status: 'Contactado' });

    const res = await request(app).get('/api/prospeccion/semanal').set('Authorization', `Bearer ${natToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.totalSemana).toBeGreaterThanOrEqual(2);
    expect(res.body.auto).toBeGreaterThanOrEqual(2);
    const tech = res.body.sectores.find(s => s.sector === 'Tecnología');
    expect(tech.total).toBe(2);
    expect(tech.respondieron).toBe(1);
    expect(tech.tasaRespuesta).toBe(50);
  });
});

describe('Prospección — cron semanal automático (ejecutarProspeccionAutomatica)', () => {
  test('rota 4 sectores, guarda TODOS los contactos con email, y deja auditoría del run', async () => {
    const { ejecutarProspeccionAutomatica } = require('../../api/prospeccion');

    // Un lead DISTINTO (empresa Y email distintos) por cada llamada — si no,
    // el dedupe real por EMPRESA (regla dura: nunca prospectar dos veces la
    // misma empresa, aunque el contacto/email cambie) descartaría los
    // repetidos entre sectores y el total no reflejaría "un lead nuevo por
    // sector", que es lo que este test mide.
    let n = 0;
    fetch.mockImplementation((url) => {
      if (url.includes('mixed_people/api_search')) {
        n++;
        return Promise.resolve(jsonResp(200, { people: [
          { id: `lead-${n}`, first_name: 'Ana', last_name_obfuscated: 'X.', title: 'Directora', organization: { name: `Acme ${n}` }, has_email: true },
        ] }));
      }
      if (url.includes('bulk_match')) {
        return Promise.resolve(jsonResp(200, { matches: [
          { id: `lead-${n}`, last_name: 'Ximénez', email: `ana${n}@acme.com`, email_status: 'verified', organization: { name: `Acme ${n}` } },
        ] }));
      }
      if (url.includes('anthropic.com')) {
        // Confianza alta siempre — así se puede afirmar cuántos se crearon.
        return Promise.resolve(jsonResp(200, { content: [{ text: JSON.stringify([{ id: `lead-${n}`, verified: true, confidence: 9, notes: 'ok' }]) }] }));
      }
      return Promise.resolve(jsonResp(404, {}));
    });

    const r = await ejecutarProspeccionAutomatica();

    expect(r.sectoresElegidos).toHaveLength(4); // rota 1-4 sectores, confirmado con el usuario
    expect(r.totalGuardados).toBe(4); // 1 lead por cada uno de los 4 sectores, todos con email
    expect(r.totalVerificados).toBe(4); // Claude los marcó verified:true a todos

    // Quedó registrado en Auditoría para que el Dashboard lo pueda mostrar.
    const { logAudit } = require('../../api/_audit');
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      accion: 'prospeccion_automatica_semanal',
      entidad: '4',
    }));
  });

  test('confianza baja o "no verificado" YA NO bloquea el guardado — Claude solo lo marca, no lo descarta', async () => {
    const { ejecutarProspeccionAutomatica } = require('../../api/prospeccion');
    fetch.mockImplementation((url) => {
      if (url.includes('mixed_people/api_search')) {
        return Promise.resolve(jsonResp(200, { people: [
          { id: 'lead-1', first_name: 'Ana', last_name_obfuscated: 'X.', title: 'Directora', organization: { name: 'Acme' }, has_email: true },
        ] }));
      }
      if (url.includes('bulk_match')) {
        return Promise.resolve(jsonResp(200, { matches: [
          { id: 'lead-1', last_name: 'Ximénez', email: 'ana@acme.com', email_status: 'verified', organization: { name: 'Acme' } },
        ] }));
      }
      if (url.includes('anthropic.com')) {
        return Promise.resolve(jsonResp(200, { content: [{ text: JSON.stringify([{ id: 'lead-1', verified: false, confidence: 4, notes: 'dudoso' }]) }] }));
      }
      return Promise.resolve(jsonResp(404, {}));
    });

    const r = await ejecutarProspeccionAutomatica();
    expect(r.totalGuardados).toBe(1);     // se guarda igual, sin importar la confianza
    expect(r.totalNoVerificados).toBe(1); // pero queda marcado "No verificado"
    expect(r.totalVerificados).toBe(0);
  });
});

describe('Prospección — POST /generar-email (reemplaza la llamada rota desde el navegador)', () => {
  test('sin ANTHROPIC_API_KEY responde 400', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await request(app).post('/api/prospeccion/generar-email')
      .set('Authorization', `Bearer ${natToken()}`).send({ empresa: 'Acme' });
    expect(res.status).toBe(400);
  });

  test('devuelve asunto y cuerpo generados por Claude', async () => {
    fetch.mockResolvedValueOnce(jsonResp(200, {
      content: [{ text: JSON.stringify({ asunto: 'Asunto de prueba', cuerpo: 'Cuerpo de prueba' }) }],
    }));
    const res = await request(app).post('/api/prospeccion/generar-email')
      .set('Authorization', `Bearer ${natToken()}`).send({ empresa: 'Acme', sectorName: 'Corporativo' });
    expect(res.status).toBe(200);
    expect(res.body.asunto).toBe('Asunto de prueba');
  });

  test('si Claude falla, responde 500 sin colgarse', async () => {
    fetch.mockRejectedValueOnce(new Error('timeout de red'));
    const res = await request(app).post('/api/prospeccion/generar-email')
      .set('Authorization', `Bearer ${natToken()}`).send({ empresa: 'Acme' });
    expect(res.status).toBe(500);
  });
});

describe('Marketing — POST /higgsfield/generate', () => {
  test('sin HIGGSFIELD_API_KEY responde 400', async () => {
    delete process.env.HIGGSFIELD_API_KEY;
    const res = await request(app).post('/api/marketing/higgsfield/generate')
      .set('Authorization', `Bearer ${natToken()}`).send({ prompt: 'test', type: 'post' });
    expect(res.status).toBe(400);
  });

  test('sin prompt responde 400', async () => {
    const res = await request(app).post('/api/marketing/higgsfield/generate')
      .set('Authorization', `Bearer ${natToken()}`).send({ type: 'post' });
    expect(res.status).toBe(400);
  });

  test('propaga el error de negocio de Higgsfield (ej. sin créditos) sin reventar', async () => {
    fetch.mockResolvedValueOnce(jsonResp(403, { detail: 'Not enough credits' }));
    const res = await request(app).post('/api/marketing/higgsfield/generate')
      .set('Authorization', `Bearer ${natToken()}`).send({ prompt: 'test', type: 'post' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Not enough credits');
  });

  test('responde completed cuando Higgsfield da la URL directa', async () => {
    fetch.mockResolvedValueOnce(jsonResp(200, { url: 'https://cdn.higgsfield.ai/imagen.png' }));
    const res = await request(app).post('/api/marketing/higgsfield/generate')
      .set('Authorization', `Bearer ${natToken()}`).send({ prompt: 'test', type: 'post' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
    expect(res.body.url).toBe('https://cdn.higgsfield.ai/imagen.png');
  });

  test('responde processing con jobId cuando Higgsfield no da la URL de inmediato', async () => {
    fetch.mockResolvedValueOnce(jsonResp(200, { job_id: 'job-123' }));
    const res = await request(app).post('/api/marketing/higgsfield/generate')
      .set('Authorization', `Bearer ${natToken()}`).send({ prompt: 'test', type: 'reel' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('processing');
    expect(res.body.jobId).toBe('job-123');
  });
});

describe('Marketing — GET /meta/auth (protegido: solo Natalia puede iniciar la conexión)', () => {
  test('devuelve la URL de login de Facebook (el frontend navega ahí después)', async () => {
    const res = await request(app).get('/api/marketing/meta/auth').set('Authorization', `Bearer ${natToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/facebook\.com\/v20\.0\/dialog\/oauth/);
  });
});

describe('Marketing — POST /higgsfield/generate, red caída', () => {
  test('si el fetch a Higgsfield truena, responde 500 sin colgarse', async () => {
    fetch.mockRejectedValueOnce(new Error('timeout de red'));
    const res = await request(app).post('/api/marketing/higgsfield/generate')
      .set('Authorization', `Bearer ${natToken()}`).send({ prompt: 'test', type: 'post' });
    expect(res.status).toBe(500);
  });
});

describe('Marketing — GET /higgsfield/status/:jobId', () => {
  test('devuelve completed cuando el job ya terminó', async () => {
    fetch.mockResolvedValueOnce(jsonResp(200, { url: 'https://cdn.higgsfield.ai/listo.png' }));
    const res = await request(app).get('/api/marketing/higgsfield/status/job-123').set('Authorization', `Bearer ${natToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
    expect(res.body.url).toBe('https://cdn.higgsfield.ai/listo.png');
  });

  test('propaga error de Higgsfield si el status responde con error', async () => {
    fetch.mockResolvedValueOnce(jsonResp(404, { detail: 'job no encontrado' }));
    const res = await request(app).get('/api/marketing/higgsfield/status/job-x').set('Authorization', `Bearer ${natToken()}`);
    expect(res.status).toBe(404);
  });

  test('formato de respuesta inesperado de Higgsfield responde 502 en vez de fallar en silencio', async () => {
    fetch.mockResolvedValueOnce(jsonResp(200, { algo_raro: true }));
    const res = await request(app).post('/api/marketing/higgsfield/generate')
      .set('Authorization', `Bearer ${natToken()}`).send({ prompt: 'test', type: 'post' });
    expect(res.status).toBe(502);
  });
});

describe('Marketing — GET /meta/select-page (público, viene de un link de Facebook)', () => {
  // updateEnv() escribe en el .env real en disco — se intercepta fs para que
  // el test NUNCA toque el .env de verdad del servidor.
  test('guarda el token/página elegidos y responde HTML de confirmación', async () => {
    const fs = require('fs');
    const readSpy  = jest.spyOn(fs, 'readFileSync').mockReturnValue('PORT=3000\n');
    const writeSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    try {
      fetch.mockResolvedValueOnce(jsonResp(200, { instagram_business_account: { id: 'ig-1' } }));
      const res = await request(app).get('/api/marketing/meta/select-page?page_id=page-1&page_token=tok-1');
      expect(res.status).toBe(200);
      expect(res.text).toMatch(/Página conectada correctamente/);
      expect(writeSpy).toHaveBeenCalled(); // confirma que sí "escribió", pero al mock, no al disco real
    } finally {
      readSpy.mockRestore();
      writeSpy.mockRestore();
    }
  });
});

describe('Marketing — POST /meta/publish', () => {
  test('sin Meta conectado responde 400', async () => {
    delete process.env.META_PAGE_ACCESS_TOKEN;
    delete process.env.META_PAGE_ID;
    const res = await request(app).post('/api/marketing/meta/publish')
      .set('Authorization', `Bearer ${natToken()}`).send({ copy: 'x', cta: 'y' });
    expect(res.status).toBe(400);
  });

  test('publica en Facebook cuando hay token y pageId (sin Instagram configurado)', async () => {
    process.env.META_PAGE_ACCESS_TOKEN = 'tok';
    process.env.META_PAGE_ID = 'page1';
    delete process.env.META_INSTAGRAM_ID;
    fetch.mockResolvedValueOnce(jsonResp(200, { id: 'fbpost1' }));
    const res = await request(app).post('/api/marketing/meta/publish')
      .set('Authorization', `Bearer ${natToken()}`).send({ copy: 'Copy', cta: 'CTA' });
    expect(res.status).toBe(200);
    expect(res.body.results.facebook.success).toBe(true);
    expect(res.body.results.facebook.post_id).toBe('fbpost1');
  });

  test('publica imagen en Instagram y Facebook cuando hay image_url', async () => {
    process.env.META_PAGE_ACCESS_TOKEN = 'tok';
    process.env.META_PAGE_ID = 'page1';
    process.env.META_INSTAGRAM_ID = 'ig1';
    fetch
      .mockResolvedValueOnce(jsonResp(200, { data: [{ quota_usage: 0, config: { quota_total: 25 } }] })) // rate limit check
      .mockResolvedValueOnce(jsonResp(200, { id: 'container1' }))   // crear media container (imagen, no video → no espera)
      .mockResolvedValueOnce(jsonResp(200, { id: 'igpost1' }))      // publicar
      .mockResolvedValueOnce(jsonResp(200, { id: 'fbpost1' }));     // Facebook photos
    const res = await request(app).post('/api/marketing/meta/publish')
      .set('Authorization', `Bearer ${natToken()}`)
      .send({ copy: 'Copy', cta: 'CTA', image_url: 'https://cdn.higgsfield.ai/x.png', type: 'post' });
    expect(res.status).toBe(200);
    expect(res.body.results.instagram.success).toBe(true);
    expect(res.body.results.instagram.post_id).toBe('igpost1');
    expect(res.body.results.facebook.success).toBe(true);
  });

  test('reel: espera a que el container de video termine antes de publicar', async () => {
    process.env.META_PAGE_ACCESS_TOKEN = 'tok';
    process.env.META_PAGE_ID = 'page1';
    process.env.META_INSTAGRAM_ID = 'ig1';
    fetch
      .mockResolvedValueOnce(jsonResp(200, { data: [{ quota_usage: 0, config: { quota_total: 25 } }] })) // rate limit
      .mockResolvedValueOnce(jsonResp(200, { id: 'container1' }))               // crear container de video
      .mockResolvedValueOnce(jsonResp(200, { status_code: 'FINISHED' }))        // poll: ya terminó
      .mockResolvedValueOnce(jsonResp(200, { id: 'igreel1' }))                  // publicar
      .mockResolvedValueOnce(jsonResp(200, { id: 'fbpost1' }));                 // Facebook
    const res = await request(app).post('/api/marketing/meta/publish')
      .set('Authorization', `Bearer ${natToken()}`)
      .send({ copy: 'Copy', cta: 'CTA', image_url: 'https://cdn.higgsfield.ai/x.mp4', type: 'reel' });
    expect(res.status).toBe(200);
    expect(res.body.results.instagram.success).toBe(true);
    expect(res.body.results.instagram.post_id).toBe('igreel1');
  });

  test('Instagram: si Meta rechaza la creación del media, reporta el error sin tronar', async () => {
    process.env.META_PAGE_ACCESS_TOKEN = 'tok';
    process.env.META_PAGE_ID = 'page1';
    process.env.META_INSTAGRAM_ID = 'ig1';
    fetch
      .mockResolvedValueOnce(jsonResp(200, { data: [{ quota_usage: 0, config: { quota_total: 25 } }] }))
      .mockResolvedValueOnce(jsonResp(400, { error: { message: 'Formato de imagen inválido' } }))
      .mockResolvedValueOnce(jsonResp(200, { id: 'fbpost1' }));
    const res = await request(app).post('/api/marketing/meta/publish')
      .set('Authorization', `Bearer ${natToken()}`)
      .send({ copy: 'Copy', cta: 'CTA', image_url: 'https://cdn.higgsfield.ai/x.png', type: 'post' });
    expect(res.status).toBe(200);
    expect(res.body.results.instagram.success).toBe(false);
    expect(res.body.results.instagram.error).toBe('Formato de imagen inválido');
  });

  test('Facebook: si la llamada de red falla, reporta el error sin tronar el endpoint', async () => {
    process.env.META_PAGE_ACCESS_TOKEN = 'tok';
    process.env.META_PAGE_ID = 'page1';
    delete process.env.META_INSTAGRAM_ID;
    fetch.mockRejectedValueOnce(new Error('network down'));
    const res = await request(app).post('/api/marketing/meta/publish')
      .set('Authorization', `Bearer ${natToken()}`).send({ copy: 'Copy', cta: 'CTA' });
    expect(res.status).toBe(200);
    expect(res.body.results.facebook.success).toBe(false);
    expect(res.body.results.facebook.error).toBe('network down');
  });

  test('respeta el límite de 25 publicaciones/24h de Instagram', async () => {
    process.env.META_PAGE_ACCESS_TOKEN = 'tok';
    process.env.META_PAGE_ID = 'page1';
    process.env.META_INSTAGRAM_ID = 'ig1';
    fetch
      .mockResolvedValueOnce(jsonResp(200, { data: [{ quota_usage: 25, config: { quota_total: 25 } }] })) // al tope
      .mockResolvedValueOnce(jsonResp(200, { id: 'fbpost1' })); // Facebook sigue publicando aparte
    const res = await request(app).post('/api/marketing/meta/publish')
      .set('Authorization', `Bearer ${natToken()}`)
      .send({ copy: 'Copy', cta: 'CTA', image_url: 'https://cdn.higgsfield.ai/x.png', type: 'post' });
    expect(res.status).toBe(200);
    expect(res.body.results.instagram.success).toBe(false);
    expect(res.body.results.instagram.error).toMatch(/Límite de 25/);
  });
});
