/**
 * Mock de Postgres (api/db.js) para tests de integración — reemplaza
 * queryDB/createRow/updateRow/archiveRow/transaccion con una base de datos
 * en memoria. A diferencia de mock-notion.js, no hace falta traducir
 * propiedades (Postgres ya devuelve objetos JS planos) — mucho más simple.
 * Cada suite recibe un store limpio a través de `resetStore()`.
 */
const bcrypt = require('bcryptjs');

let _store = {};
let _seq = 0;

function resetStore(seed = {}) {
  _failNext = null;
  _failCount = 0;
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

function _id() { return 'test-' + (++_seq) + '-' + Math.random().toString(36).slice(2, 8); }

function _defaultAdmin() {
  return {
    id: 'admin-page-id',
    usuario: 'natalia', nombre: 'Natalia Gama', email: 'natalia@actideacontinnuo.com',
    rol: 'admin', ejec: 'Natalia Gama', passwordHash: bcrypt.hashSync('AdminTest123!', 4),
    activo: true, mustChangePassword: false, twoFaSecret: '', twoFaEnabled: false,
    intentosFallidos: 0, bloqueadoHasta: null, resetToken: '', resetTokenExpira: null,
    deletedAt: null,
  };
}
function _ejecutivoUser() {
  return {
    id: 'ejec-page-id',
    usuario: 'alexia', nombre: 'Alexia', email: 'alexia@actideacontinnuo.com',
    rol: 'ejecutivo', ejec: 'Alexia', passwordHash: bcrypt.hashSync('EjecTest123!', 4),
    activo: true, mustChangePassword: false, twoFaSecret: '', twoFaEnabled: false,
    intentosFallidos: 0, bloqueadoHasta: null, resetToken: '', resetTokenExpira: null,
    deletedAt: null,
  };
}
function _ejecutivoGenerico(nombre, usuario) {
  const u = (usuario || nombre).toLowerCase().replace(/\s+/g, '');
  return {
    id: 'ejec-' + u,
    usuario: u, nombre, email: u + '@actideacontinnuo.com',
    rol: 'ejecutivo', ejec: nombre, passwordHash: bcrypt.hashSync('EjecTest123!', 4),
    activo: true, mustChangePassword: false, twoFaSecret: '', twoFaEnabled: false,
    intentosFallidos: 0, bloqueadoHasta: null, resetToken: '', resetTokenExpira: null,
    deletedAt: null,
  };
}

// ── Simulación de fallos (para cubrir los catch de error 500) ──
let _failNext = null;
let _failCount = 0;
function setFailNext(message = 'Postgres caído (simulado)', times = 1) {
  _failNext = message;
  _failCount = times;
}
function _maybeFail() {
  if (_failNext && _failCount > 0) {
    const msg = _failNext;
    _failCount -= 1;
    if (_failCount === 0) _failNext = null;
    throw new Error(msg);
  }
}

function _tabla(t) {
  if (!_store[t]) _store[t] = [];
  return _store[t];
}

async function queryDB(table, where = null, orderBy = null) {
  _maybeFail();
  let rows = _tabla(table).filter(r => !r.deletedAt);
  if (where) {
    for (const [k, v] of Object.entries(where)) rows = rows.filter(r => r[k] === v);
  }
  if (orderBy) {
    const { field, direction } = orderBy;
    rows = [...rows].sort((a, b) => {
      const av = a[field] ?? '', bv = b[field] ?? '';
      if (av < bv) return direction === 'descending' ? 1 : -1;
      if (av > bv) return direction === 'descending' ? -1 : 1;
      return 0;
    });
  }
  return rows.map(r => ({ ...r }));
}

async function getRow(table, id) {
  _maybeFail();
  const row = _tabla(table).find(r => r.id === id && !r.deletedAt);
  if (!row) { const e = new Error('Registro no encontrado'); e.status = 404; throw e; }
  return { ...row };
}

async function createRow(table, data) {
  _maybeFail();
  const row = { id: _id(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), deletedAt: null, ...data };
  _tabla(table).push(row);
  return { ...row };
}

async function updateRow(table, id, data) {
  _maybeFail();
  const rows = _tabla(table);
  const idx = rows.findIndex(r => r.id === id && !r.deletedAt);
  if (idx === -1) { const e = new Error('Registro no encontrado'); e.status = 404; throw e; }
  rows[idx] = { ...rows[idx], ...data, updatedAt: new Date().toISOString() };
  return { ...rows[idx] };
}

async function archiveRow(table, id) {
  _maybeFail();
  const rows = _tabla(table);
  const idx = rows.findIndex(r => r.id === id);
  if (idx === -1) return null;
  rows[idx] = { ...rows[idx], deletedAt: new Date().toISOString() };
  return { ...rows[idx] };
}

// La versión mock no necesita locking real (single-threaded, secuencial) —
// solo replica la forma de la API real para que las rutas no cambien.
async function transaccion(fn) {
  const helpers = {
    async getForUpdate(table, id) { return getRow(table, id); },
    async update(table, id, data) { return updateRow(table, id, data); },
  };
  return fn(helpers);
}

async function sumWhere(table, sumField, where = {}) {
  _maybeFail();
  let rows = _tabla(table).filter(r => !r.deletedAt);
  for (const [k, v] of Object.entries(where)) rows = rows.filter(r => r[k] === v);
  return rows.reduce((a, r) => a + (Number(r[sumField]) || 0), 0);
}

async function subirArchivo(_b, _buf, filename) { _maybeFail(); return 'mock-' + String(filename || 'f').replace(/\W/g, '').slice(0, 8); }
async function urlFirmada(_b, ruta) { return ruta ? 'https://mock.storage/' + ruta : null; }

module.exports = {
  subirArchivo, urlFirmada,
  resetStore,
  setFailNext,
  getStore: () => _store,
  addUser: (user) => { _store.usuarios.push(user); },
  addEjecUser: () => { _store.usuarios.push(_ejecutivoUser()); },
  addEjecutivo: (nombre, usuario) => { _store.usuarios.push(_ejecutivoGenerico(nombre, usuario)); },
  queryDB, getRow, createRow, updateRow, archiveRow, transaccion, sumWhere,
  pool: { query: async () => ({ rows: [] }) },
};
