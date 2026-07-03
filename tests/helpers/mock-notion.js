/**
 * Mock de Notion para tests de integración.
 * Reemplaza queryDB / createPage / updatePage con una base de datos en memoria.
 * Cada suite de tests recibe un store limpio a través de `resetStore()`.
 */
const bcrypt = require('bcryptjs');

// ── Store en memoria ──────────────────────────────────────
let _store = {};

function resetStore(seed = {}) {
  _failNext = null;
  _store = {
    usuarios:     seed.usuarios     || [_defaultAdmin()],
    prospectos:   seed.prospectos   || [],
    clientes:     seed.clientes     || [],
    ops:          seed.ops          || [],
    cotizaciones: seed.cotizaciones || [],
    pagos:        seed.pagos        || [],
    proveedores:  seed.proveedores  || [],
    deudas:       seed.deudas       || [],
    casos:        seed.casos        || [],
    tickets:      seed.tickets      || [],
    auditoria:    seed.auditoria    || [],
    objetivos:    seed.objetivos    || [],
  };
}

function _id() {
  return 'test-' + Math.random().toString(36).slice(2, 10);
}

function _defaultAdmin() {
  return {
    id: 'admin-page-id',
    properties: {
      'Usuario':             { title: [{ plain_text: 'natalia' }] },
      'Nombre':              { rich_text: [{ plain_text: 'Natalia Gama' }] },
      'Email':               { email: 'natalia@actideacontinnuo.com' },
      'Rol':                 { select: { name: 'admin' } },
      'Ejecutivo':           { rich_text: [{ plain_text: 'Natalia Gama' }] },
      'PasswordHash':        { rich_text: [{ plain_text: bcrypt.hashSync('AdminTest123!', 4) }] },
      'Activo':              { checkbox: true },
      'DebeCambiarPassword': { checkbox: false },
      'TwoFASecret':         { rich_text: [] },
      'TwoFAEnabled':        { checkbox: false },
      'IntentosFallidos':    { number: 0 },
      'BloqueadoHasta':      { date: null },
      'ResetToken':          { rich_text: [] },
      'ResetExpira':         { date: null },
    },
  };
}

function _ejecutivoUser() {
  return {
    id: 'ejec-page-id',
    properties: {
      'Usuario':             { title: [{ plain_text: 'alexia' }] },
      'Nombre':              { rich_text: [{ plain_text: 'Alexia' }] },
      'Email':               { email: 'alexia@actideacontinnuo.com' },
      'Rol':                 { select: { name: 'ejecutivo' } },
      'Ejecutivo':           { rich_text: [{ plain_text: 'Alexia' }] },
      'PasswordHash':        { rich_text: [{ plain_text: bcrypt.hashSync('EjecTest123!', 4) }] },
      'Activo':              { checkbox: true },
      'DebeCambiarPassword': { checkbox: false },
      'TwoFASecret':         { rich_text: [] },
      'TwoFAEnabled':        { checkbox: false },
      'IntentosFallidos':    { number: 0 },
      'BloqueadoHasta':      { date: null },
      'ResetToken':          { rich_text: [] },
      'ResetExpira':         { date: null },
    },
  };
}

// ── Helpers de lectura de props (los mismos que notion.js) ─
function _readTitle(prop)    { return prop?.title?.[0]?.plain_text    ?? ''; }
function _readText(prop)     { return prop?.rich_text?.map(r => r.plain_text).join('') ?? ''; }
function _readSelect(prop)   { return prop?.select?.name              ?? ''; }
function _readEmail(prop)    { return prop?.email                     ?? ''; }

// ── Simulación de fallos (para cubrir los catch de error 500) ──
let _failNext = null;
function setFailNext(message = 'Notion caído (simulado)') { _failNext = message; }
function _maybeFail() {
  if (_failNext) {
    const msg = _failNext;
    _failNext = null;
    throw new Error(msg);
  }
}

// ── Implementaciones mock ─────────────────────────────────
async function queryDB(dbKey, filter = null) {
  _maybeFail();
  const rows = _store[dbKey] || [];
  if (!filter) return rows;

  // Soportar filtros de título y select (los que usan auth.js y los routers con roleFilter)
  if (filter.property && filter.title?.equals) {
    const val = filter.title.equals;
    return rows.filter(r => _readTitle(r.properties[filter.property]) === val);
  }
  if (filter.property && filter.select?.equals) {
    const val = filter.select.equals;
    return rows.filter(r => (r.properties[filter.property]?.select?.name ?? '') === val);
  }
  return rows;
}

async function createPage(dbKey, properties) {
  _maybeFail();
  const page = { id: _id(), properties: _materializeProps(properties) };
  (_store[dbKey] = _store[dbKey] || []).push(page);
  return page;
}

async function updatePage(pageId, properties) {
  _maybeFail();
  for (const dbKey of Object.keys(_store)) {
    const idx = _store[dbKey].findIndex(r => r.id === pageId);
    if (idx !== -1) {
      _store[dbKey][idx] = {
        id: pageId,
        properties: { ..._store[dbKey][idx].properties, ..._materializeProps(properties) },
      };
      return _store[dbKey][idx];
    }
  }
  throw new Error(`Page ${pageId} not found`);
}

async function archivePage(pageId) {
  _maybeFail();
  for (const dbKey of Object.keys(_store)) {
    const idx = _store[dbKey].findIndex(r => r.id === pageId);
    if (idx !== -1) { _store[dbKey].splice(idx, 1); return {}; }
  }
  return {};
}

async function getPage(pageId) {
  _maybeFail();
  for (const dbKey of Object.keys(_store)) {
    const row = _store[dbKey].find(r => r.id === pageId);
    if (row) return row;
  }
  throw new Error(`Page ${pageId} not found`);
}

// Convierte los prop builders de Notion en el formato que devuelve el API
function _materializeProps(props) {
  const out = {};
  for (const [k, v] of Object.entries(props)) {
    if (v.title !== undefined) {
      // Notion real devuelve AMBOS: plain_text y text.content — el mock los replica
      out[k] = {
        title: (v.title || []).map(t => {
          const s = t.plain_text ?? t.text?.content ?? '';
          return { plain_text: s, text: { content: s } };
        }),
      };
    } else if (v.rich_text !== undefined) {
      out[k] = {
        rich_text: (v.rich_text || []).map(t => {
          const s = t.plain_text ?? t.text?.content ?? '';
          return { plain_text: s, text: { content: s } };
        }),
      };
    } else if (v.number !== undefined)    out[k] = { number: v.number };
    else if (v.select !== undefined)      out[k] = { select: v.select };
    else if (v.date !== undefined)        out[k] = { date: v.date };
    else if (v.checkbox !== undefined)    out[k] = { checkbox: v.checkbox };
    else if (v.email !== undefined)       out[k] = { email: v.email };
    else if (v.phone_number !== undefined) out[k] = { phone_number: v.phone_number };
    else out[k] = v;
  }
  return out;
}

// Notion client stub (solo para pages.retrieve, usado en algunas rutas)
const notion = {
  databases: { query: async () => ({ results: [], has_more: false }) },
  pages: {
    create:   async (p) => createPage('_raw', p.properties),
    update:   async (p) => updatePage(p.page_id, p.properties || {}),
    retrieve: async (p) => getPage(p.page_id),
  },
};

module.exports = {
  // Store
  resetStore,
  setFailNext,
  getStore: () => _store,
  addUser: (user) => { _store.usuarios.push(user); },
  addEjecUser: () => { _store.usuarios.push(_ejecutivoUser()); },
  // Mock functions
  notion,
  queryDB,
  createPage,
  updatePage,
  archivePage,
  getPage,
  DBS: {},
  // Prop builders — mismos que notion.js real
  prop_title:    (v) => ({ title: [{ text: { content: String(v ?? '') } }] }),
  prop_text:     (v) => ({ rich_text: v ? [{ text: { content: String(v) } }] : [] }),
  prop_number:   (v) => ({ number: isNaN(Number(v)) ? null : Number(v) }),
  prop_select:   (v) => (v ? { select: { name: String(v) } } : { select: null }),
  prop_date:     (v) => (v ? { date: { start: v } } : { date: null }),
  prop_checkbox: (v) => ({ checkbox: Boolean(v) }),
  prop_email:    (v) => ({ email: v || null }),
  prop_phone:    (v) => ({ phone_number: v || null }),
  // Prop readers
  read_title:    (p) => p?.title?.[0]?.plain_text   ?? '',
  read_text:     (p) => p?.rich_text?.map(r => r.plain_text).join('') ?? '',
  read_number:   (p) => p?.number   ?? 0,
  read_select:   (p) => p?.select?.name ?? '',
  read_date:     (p) => p?.date?.start  ?? null,
  read_checkbox: (p) => p?.checkbox     ?? false,
  read_email:    (p) => p?.email        ?? '',
  read_phone:    (p) => p?.phone_number ?? '',
};
