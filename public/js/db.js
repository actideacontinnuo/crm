// Un JWT válido son 3 segmentos base64url separados por puntos (solo ASCII).
// Un token corrupto (p. ej. con caracteres raros) rompería el header HTTP, así
// que lo validamos y lo descartamos si no tiene forma de JWT.
function _tokenValido(t) {
  return typeof t === 'string' && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(t);
}

// API fetch wrapper — incluye token JWT en cada petición
function _authHeaders(extra = {}) {
  let token = localStorage.getItem('crm_token');
  if (token && !_tokenValido(token)) {
    // Token corrupto en el navegador: se limpia y se trata como sesión cerrada
    localStorage.removeItem('crm_token');
    localStorage.removeItem('crm_user');
    token = null;
  }
  return token
    ? { 'Authorization': 'Bearer ' + token, ...extra }
    : { ...extra };
}

// Maneja respuestas no-OK de forma centralizada: sesión expirada y contraseña obligatoria
async function _handleErrorResponse(r) {
  if (r.status === 401) { cerrarSesion(); throw new Error('Sesión expirada'); }
  if (r.status === 403) {
    try {
      const body = await r.clone().json();
      if (body.error === 'PASSWORD_CHANGE_REQUIRED') {
        if (typeof mostrarForzarPassScreen === 'function') mostrarForzarPassScreen();
        throw new Error('Debes cambiar tu contraseña');
      }
    } catch (_) { /* no era JSON con ese formato, sigue al manejo genérico */ }
  }
  throw new Error(await r.text());
}

const API = {
  async get(path) {
    const r = await fetch('/api' + path, { headers: _authHeaders() });
    if (!r.ok) return _handleErrorResponse(r);
    return r.json();
  },
  async post(path, body) {
    const r = await fetch('/api' + path, {
      method: 'POST',
      headers: _authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
    if (!r.ok) return _handleErrorResponse(r);
    return r.json();
  },
  async patch(path, body) {
    const r = await fetch('/api' + path, {
      method: 'PATCH',
      headers: _authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
    if (!r.ok) return _handleErrorResponse(r);
    return r.json();
  },
  async delete(path) {
    const r = await fetch('/api' + path, {
      method: 'DELETE',
      headers: _authHeaders(),
    });
    if (!r.ok) return _handleErrorResponse(r);
    return r.json();
  },
  // Envío multipart (archivos + campos de texto). NO fijamos Content-Type: el
  // navegador añade el boundary automáticamente al pasar un FormData.
  async upload(path, method, data) {
    const fd = new FormData();
    Object.entries(data || {}).forEach(([k, v]) => {
      if (v === undefined || v === null) return;
      if (v instanceof File) fd.append(k, v, v.name);
      else fd.append(k, v);
    });
    const r = await fetch('/api' + path, { method, headers: _authHeaders(), body: fd });
    if (!r.ok) return _handleErrorResponse(r);
    return r.json();
  },
};

// Entity data access with simple lazy cache
const _cache = {};

function _invalidate(...keys) {
  keys.forEach(k => delete _cache[k]);
}

// Wrap a fetch promise so rejected results don't stay in the cache
function _cached(key, fetchFn) {
  if (_cache[key]) return _cache[key];
  _cache[key] = fetchFn().catch(err => { delete _cache[key]; throw err; });
  return _cache[key];
}

const db = {
  prospectos: {
    list: () => _cached('prospectos', () => API.get('/prospectos')),
    get: (id) => API.get('/prospectos/' + id),
    create: async (data) => { const r = await API.post('/prospectos', data); _invalidate('prospectos'); return r; },
    update: async (id, data) => { const r = await API.patch('/prospectos/' + id, data); _invalidate('prospectos'); return r; },
    delete: async (id) => { const r = await API.delete('/prospectos/' + id); _invalidate('prospectos'); return r; },
  },
  clientes: {
    list: () => _cached('clientes', () => API.get('/clientes')),
    get: (id) => API.get('/clientes/' + id),
    create: async (data) => { const r = await API.post('/clientes', data); _invalidate('clientes'); return r; },
    update: async (id, data) => { const r = await API.patch('/clientes/' + id, data); _invalidate('clientes'); return r; },
    delete: async (id) => { const r = await API.delete('/clientes/' + id); _invalidate('clientes'); return r; },
  },
  ops: {
    list: () => _cached('ops', () => API.get('/ops')),
    get: (id) => API.get('/ops/' + id),
    create: async (data) => { const r = await API.post('/ops', data); _invalidate('ops'); return r; },
    update: async (id, data) => { const r = await API.patch('/ops/' + id, data); _invalidate('ops'); return r; },
  },
  cotizaciones: {
    list: () => _cached('cotizaciones', () => API.get('/cotizaciones')),
    get: (id) => API.get('/cotizaciones/' + id),
    create: async (data) => { const r = await API.upload('/cotizaciones', 'POST', data); _invalidate('cotizaciones'); return r; },
    update: async (id, data) => { const r = await API.upload('/cotizaciones/' + id, 'PATCH', data); _invalidate('cotizaciones'); return r; },
  },
  pagos: {
    list: () => _cached('pagos', () => API.get('/pagos')),
    get: (id) => API.get('/pagos/' + id),
    create: async (data) => { const r = await API.post('/pagos', data); _invalidate('pagos'); return r; },
    update: async (id, data) => { const r = await API.patch('/pagos/' + id, data); _invalidate('pagos'); return r; },
  },
  proveedores: {
    list: () => _cached('proveedores', () => API.get('/proveedores')),
    get: (id) => API.get('/proveedores/' + id),
    create: async (data) => { const r = await API.post('/proveedores', data); _invalidate('proveedores'); return r; },
    update: async (id, data) => { const r = await API.patch('/proveedores/' + id, data); _invalidate('proveedores'); return r; },
    delete: async (id) => { const r = await API.delete('/proveedores/' + id); _invalidate('proveedores'); return r; },
  },
  deudas: {
    list: () => _cached('deudas', () => API.get('/deudas')),
    create: async (data) => { const r = await API.post('/deudas', data); _invalidate('deudas'); return r; },
    update: async (id, data) => { const r = await API.patch('/deudas/' + id, data); _invalidate('deudas'); return r; },
  },
  casos: {
    list: () => _cached('casos', () => API.get('/casos')),
    get: (id) => API.get('/casos/' + id),
    create: async (data) => { const r = await API.post('/casos', data); _invalidate('casos'); return r; },
    update: async (id, data) => { const r = await API.patch('/casos/' + id, data); _invalidate('casos'); return r; },
  },
  tickets: {
    list: () => _cached('tickets', () => API.get('/tickets')),
    create: async (data) => { const r = await API.post('/tickets', data); _invalidate('tickets'); return r; },
    update: async (id, data) => { const r = await API.patch('/tickets/' + id, data); _invalidate('tickets'); return r; },
  },

  // Invalidate one or more entity caches by name
  invalidate(...keys) { _invalidate(...keys); },

  // Prefetch all entities (used on init)
  // Uses allSettled so one failing API doesn't block the rest
  async prefetch() {
    await Promise.allSettled([
      db.prospectos.list(),
      db.clientes.list(),
      db.ops.list(),
      db.cotizaciones.list(),
      db.pagos.list(),
      db.proveedores.list(),
      db.deudas.list(),
      db.casos.list(),
      db.tickets.list(),
    ]);
  },
};
