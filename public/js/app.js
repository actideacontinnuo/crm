// ══════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════
const EJEC_LIST = ['Natalia Gama', 'Ximena', 'Alexia'];
const EJEC_COL = { 'Natalia Gama': '#CC2200', 'Ximena': '#1A6B3C', 'Alexia': '#A0620A' };


// ══════════════════════════════════════
// ÍCONOS SVG — set del diseño de referencia (+ extras del CRM)
// ══════════════════════════════════════
function icoHTML(n, s) {
  const I = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/>',
    building: '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M9 8h2M13 8h2M9 12h2M13 12h2M9 16h2M13 16h2"/>',
    box: '<path d="M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
    ticket: '<path d="M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2 2 2 0 0 0 0 4 2 2 0 0 1-2 2H5a2 2 0 0 1-2-2 2 2 0 0 0 0-4z"/><path d="M13 7v10"/>',
    wallet: '<path d="M3 7a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v2"/><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2z"/><circle cx="16" cy="13" r="1.3" fill="currentColor"/>',
    truck: '<path d="M3 6a1 1 0 0 1 1-1h10v11H3z"/><path d="M14 8h4l3 3v4h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/>',
    bell: '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    download: '<path d="M12 3v12M7 11l5 5 5-5M5 21h14"/>',
    cal: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.5 3-5.5 6.5-5.5s6.5 2 6.5 5.5"/><circle cx="17" cy="9" r="2.8"/><path d="M17.5 14.6c2.4.4 4 2 4 4.4"/>',
    arrowup: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    trend: '<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>',
    alert: '<path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
    edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7 12.8 12.8 0 0 0 .7 2.8 2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4 12.8 12.8 0 0 0 2.8.7 2 2 0 0 1 1.7 2z"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 7l10 6 10-6"/>',
    doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
    clip: '<path d="M21.4 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.2-9.19a4 4 0 0 1 5.65 5.66l-9.2 9.19a2 2 0 0 1-2.82-2.83l8.49-8.48"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
    key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.8 12.2 21 2M15 7l3 3M18 4l2 2"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    unlock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.7-1.5"/>',
    trash: '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    send: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
    save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
  };
  const size = s || 16;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-3px">${I[n] || ''}</svg>`;
}

const COT_SECS = [
  { id: 'audio',    label: 'AUDIO, VIDEO E ILUMINACIÓN' },
  { id: 'esceno',   label: 'ESCENOGRAFÍA Y MONTAJE' },
  { id: 'logistica',label: 'LOGÍSTICA Y COORDINACIÓN' },
  { id: 'catering', label: 'CATERING Y COFFEE BREAK' },
  { id: 'otros',    label: 'OTROS CONCEPTOS' },
];

const PROVS = [
  'SoundPro MX','Lumina Eventos','Decora Studio','EventFood MX',
  'AV Professionals','TransportesCorp','Otro / Sin asignar',
];

// ══════════════════════════════════════
// GLOBAL STATE
// ══════════════════════════════════════
const STATE = {
  // Selected record IDs for detail/edit modals
  selOP: null,
  selCot: null,
  selPago: null,
  selProsp: null,
  selCliente: null,
  selProv: null,
  selCaso: null,

  // View filters
  opTabFilter: 'todas',
  deudasFilter: 'todos',
  prospView: 'tabla',   // 'tabla' | 'kanban'
  opTab: 'activas',
  pagosTab: 'cobros',

  // Cotizador editor state
  cotEditor: {
    id: null,       // existing cot id when editing
    opId: null,
    clienteId: null,
    ejec: 'Natalia Gama',
    secciones: { audio: [], esceno: [], logistica: [], catering: [], otros: [] },
    fee: 15,
  },

  // Comercial / reportes period
  objVista: 'anual',
  rpPeriodo: 'mes',
};

// ══════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════
function fmx(n) {
  return '$' + Math.round(n || 0).toLocaleString('es-MX');
}

// Escapa HTML para que texto guardado por un usuario (nombres, notas, etc.)
// nunca se interprete como código al insertarse con innerHTML — previene XSS.
// Escapa también comillas: el código las usa dentro de atributos (value="...", onclick="...('...')")
// y textContent→innerHTML por sí solo NO escapa comillas, así que se hace a mano.
const _ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, ch => _ESC_MAP[ch]);
}

function pct(a, b) {
  return b ? Math.round((a / b) * 100) : 0;
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
}

function toast(msg, col = 'green') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (col === 'red' ? ' err' : '');
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}

function pillHTML(status) {
  const map = {
    'Nuevo': 'nuevo', 'Contactado': 'contactado', 'En conversación': 'contactado',
    'Listo p/ cotizar': 'listo', 'En Producción': 'produccion', 'Ejecutado': 'ejecutado',
    'Cotización': 'cotizacion', 'Pendiente': 'pendiente', 'Vencido': 'vencido',
    'Pagado': 'pagado', 'Parcial': 'parcial',
    'Activo': 'activo', 'Bloqueado': 'bloqueado',
    'Aceptada': 'aprobado', 'Enviada': 'pendiente', 'Rechazada': 'vencido',
    'Aprobado': 'aprobado', 'Pendiente aprobación': 'pendiente',
    'Abierto': 'vencido', 'En proceso': 'pendiente', 'Cerrado': 'cerrado',
    'Cancelado': 'cerrado',
  };
  return `<span class="pill ${map[status] || 'nuevo'}"><span class="pill-dot"></span>${status}</span>`;
}

function genCodigo(cliente) {
  // e.g. HTGNAT010426  — first 6 chars of código prefix + ddmmyy
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(2);
  // Use first 3 letters of nombre + first 3 of razon or 'XXX'
  const n = (cliente.nombre || 'XXX').replace(/\s/g, '').toUpperCase().substring(0, 3);
  const r = (cliente.razon || 'XXX').replace(/\s/g, '').toUpperCase().substring(0, 3);
  return n + r + dd + mm + yy;
}

// Build OP number from cliente codigo + date + sequence count
function buildOPNum(clienteId, allOps) {
  const cl = getClienteById(clienteId);
  const prefix = cl && cl.codigo ? cl.codigo.substring(0, 6) : 'XXXXXX';
  const d = new Date();
  const dateStr = String(d.getDate()).padStart(2, '0') + String(d.getMonth() + 1).padStart(2, '0') + String(d.getFullYear()).slice(2);
  const count = (allOps || []).filter(o => o.clienteId === clienteId).length + 1;
  return `${prefix}${dateStr}-${String(count).padStart(2, '0')}`;
}

// ══════════════════════════════════════
// DATA LOOKUP HELPERS (use cached lists)
// ══════════════════════════════════════
async function getClienteById(id) {
  const list = await db.clientes.list();
  return list.find(c => c.id === id) || null;
}

async function getOPById(id) {
  const list = await db.ops.list();
  return list.find(o => o.id === id) || null;
}

async function getProvById(id) {
  const list = await db.proveedores.list();
  return list.find(p => p.id === id) || null;
}

async function getCotById(id) {
  const list = await db.cotizaciones.list();
  return list.find(c => c.id === id) || null;
}

// ══════════════════════════════════════
// SPINNER
// ══════════════════════════════════════
function showSpinner() {
  document.getElementById('global-spinner').classList.add('show');
}
function hideSpinner() {
  document.getElementById('global-spinner').classList.remove('show');
}

// ══════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════
function nav(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const el = document.getElementById('view-' + view);
  if (el) {
    el.classList.add('active');
    const m = document.getElementById('mainArea');
    if (m) { m.style.animation = 'none'; m.offsetHeight; m.style.animation = 'fadeUp .3s ease'; }
  }

  document.querySelectorAll('.nav-item').forEach(n => {
    const oc = n.getAttribute('onclick') || '';
    if (oc.includes(`'${view}'`)) n.classList.add('active');
  });

  window.scrollTo({ top: 0, behavior: 'smooth' });

  const renders = {
    dashboard: renderDashboard,
    prospectos: renderProspectos,
    clientes: renderClientes,
    ops: renderOPs,
    cotizaciones: renderCotizaciones,
    pagos: renderPagos,
    proveedores: renderProveedores,
    comercial: renderComercial,
    reportes: renderReportes,
    casos: renderCasos,
  };
  if (renders[view]) renders[view]();
  updateBadges();
}

// ══════════════════════════════════════
// MODALS
// ══════════════════════════════════════
function openM(name) {
  const el = document.getElementById('m-' + name);
  if (el) { el.classList.add('open'); document.body.style.overflow = 'hidden'; }

  if (name === 'nueva-op') { _populateClienteSelectNuevaOP(); _previewOPNum(); }
  if (name === 'cotizador') { populateCotSelects(); }
  if (name === 'deudas') { renderDeudasModal(); }
  if (name === 'nuevo-pago') { _refreshPagoOPSelect(); }
  if (name === 'nueva-deuda') { _refreshDeudaSelects(); }
  if (name === 'nuevo-caso') { _refreshCasoSelects(); }
  if (name === 'nuevo-ticket') { _refreshTicketCotSelect(); }
}

function closeM(name) {
  const el = document.getElementById('m-' + name);
  if (el) { el.classList.remove('open'); document.body.style.overflow = ''; }
}

// Close modal when clicking overlay background
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('open');
    document.body.style.overflow = '';
  }
});

// ══════════════════════════════════════
// SELECT POPULATION HELPERS
// ══════════════════════════════════════
async function _populateClienteSelectNuevaOP() {
  const list = await db.clientes.list();
  const s = document.getElementById('op-cliente');
  if (s) s.innerHTML = list.map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('');
  _previewOPNum();
}

async function _previewOPNum() {
  const s = document.getElementById('op-cliente');
  if (!s) return;
  const ops = await db.ops.list();
  const num = buildOPNum(s.value, ops);
  const el = document.getElementById('op-num-prev');
  if (el) el.value = num;
}

async function _refreshPagoOPSelect() {
  const list = await db.ops.list();
  const s = document.getElementById('pg-op');
  if (s) s.innerHTML = '<option value="">— Ninguna —</option>' + list.map(o => `<option value="${o.id}">${esc(o.numero)} — ${esc(o.desc)}</option>`).join('');
}

async function _refreshDeudaSelects() {
  const [provs, ops] = await Promise.all([db.proveedores.list(), db.ops.list()]);
  const sp = document.getElementById('nd-prov');
  if (sp) sp.innerHTML = provs.map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('');
  const so = document.getElementById('nd-op');
  if (so) so.innerHTML = '<option value="">— Sin OP —</option>' + ops.map(o => `<option value="${o.id}">${esc(o.numero)} — ${esc(o.desc)}</option>`).join('');
}

async function _refreshCasoSelects() {
  const [clientes, ops] = await Promise.all([db.clientes.list(), db.ops.list()]);
  const sc = document.getElementById('cas-cliente');
  if (sc) sc.innerHTML = clientes.map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('');
  const so = document.getElementById('cas-op');
  if (so) so.innerHTML = '<option value="">— Sin OP —</option>' + ops.map(o => `<option value="${o.id}">${esc(o.numero)} — ${esc(o.desc)}</option>`).join('');
}

async function _refreshTicketCotSelect() {
  const list = await db.cotizaciones.list();
  const s = document.getElementById('tk-cot');
  if (s) s.innerHTML = list.map(c => `<option value="${c.id}">${esc(c.idCot)} · ${esc(c.status)}</option>`).join('');
}

// Refresh OP select used in cotizador
async function refreshCotOPSelect() {
  const list = await db.ops.list();
  const s = document.getElementById('cot-op');
  if (s) s.innerHTML = '<option value="">— Sin OP —</option>' + list.map(o => `<option value="${o.id}">${esc(o.numero)} — ${esc(o.desc)}</option>`).join('');
}

// Change listener for op-cliente
document.addEventListener('change', e => {
  if (e.target.id === 'op-cliente') _previewOPNum();
});

// ══════════════════════════════════════
// BADGES
// ══════════════════════════════════════
async function updateBadges() {
  try {
    const [prospectos, ops, pagos, casos] = await Promise.all([
      db.prospectos.list(),
      db.ops.list(),
      db.pagos.list(),
      db.casos.list(),
    ]);

    const urgentes = prospectos.filter(p => p.status === 'Listo p/ cotizar').length;
    const badgeProsp = document.getElementById('badge-prospectos');
    if (badgeProsp) badgeProsp.textContent = urgentes || prospectos.length;

    const opsActivas = ops.filter(o => o.status === 'En Producción').length;
    const badgeOps = document.getElementById('badge-ops');
    if (badgeOps) badgeOps.textContent = opsActivas;

    const pagosPend = pagos.filter(p => p.status === 'Pendiente' || p.status === 'Vencido').length;
    const badgePagos = document.getElementById('badge-pagos');
    if (badgePagos) badgePagos.textContent = pagosPend;

    const casosAb = casos.filter(c => c.status === 'Abierto' || c.status === 'En proceso').length;
    const badgeCasos = document.getElementById('badge-casos');
    if (badgeCasos) badgeCasos.textContent = casosAb;
  } catch (e) {
    // badges are non-critical; ignore errors
  }
}

// ══════════════════════════════════════
// INIT
// ══════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  // Si la URL trae ?token=xxx es un enlace de reset de contraseña — tiene prioridad total
  if (new URLSearchParams(window.location.search).has('token')) {
    _checkResetToken();
    return;
  }

  // Verificar sesión primero
  const user = sesionActual();
  if (!user || !localStorage.getItem('crm_token')) {
    mostrarLogin();
    return;
  }

  // Sesión válida: aplicar rol
  aplicarSesion(user);
  ocultarLogin();

  // Si quedó pendiente cambiar la contraseña (ej. recargó la página a medio flujo), bloquear aquí
  if (user.mustChangePassword) {
    mostrarForzarPassScreen();
    return;
  }

  showSpinner();
  try {
    await db.prefetch();
  } catch (e) {
    console.error(e);
  } finally {
    hideSpinner();
  }
  nav('dashboard');
});

// ══════════════════════════════════════
// AVATAR MENU
// ══════════════════════════════════════
function toggleAvatarMenu() {
  const menu = document.getElementById('avatar-menu');
  if (!menu) return;
  const open = menu.style.display === 'block';
  menu.style.display = open ? 'none' : 'block';

  if (!open) {
    const user = sesionActual();
    const adminWrap = document.getElementById('avatar-menu-admin');
    if (adminWrap) adminWrap.style.display = user?.role === 'admin' ? 'block' : 'none';

  }
}

// Cerrar el menú de avatar con cualquier clic fuera de él (listener permanente:
// uno de "una sola vez" se consume con clics dentro del menú y deja de funcionar)
document.addEventListener('click', _cerrarAvatarMenu);

function _cerrarAvatarMenu(e) {
  const menu   = document.getElementById('avatar-menu');
  const avatar = document.getElementById('topbar-avatar');
  if (!menu || menu.style.display !== 'block') return;
  if (menu.contains(e.target) || (avatar && avatar.contains(e.target))) return;
  menu.style.display = 'none';
}

// ══════════════════════════════════════
// NOTIFICACIONES (campanita)
// ══════════════════════════════════════
const _notifs = [];

function toggleNotifPanel() {
  const panel = document.getElementById('notif-panel');
  if (!panel) return;
  const open = panel.style.display === 'block';
  panel.style.display = open ? 'none' : 'block';

  if (!open) {
    _renderNotifPanel();
    // Cerrar si se hace click fuera
    setTimeout(() => {
      document.addEventListener('click', _cerrarNotifPanel, { once: true });
    }, 0);
  }
}

function _cerrarNotifPanel(e) {
  const panel = document.getElementById('notif-panel');
  const bell  = document.getElementById('notif-bell');
  if (!panel) return;
  if (panel.contains(e.target) || (bell && bell.contains(e.target))) return;
  panel.style.display = 'none';
}

function _renderNotifPanel() {
  const lista = document.getElementById('notif-list');
  if (!lista) return;
  if (_notifs.length === 0) {
    lista.innerHTML = '<div style="padding:20px;text-align:center;color:var(--gray400);font-size:12px">Sin notificaciones</div>';
    return;
  }
  lista.innerHTML = _notifs.map((n, i) => `
    <div style="padding:10px 12px;border-bottom:1px solid var(--border);${n.leida ? 'opacity:.6' : ''}">
      <div style="font-size:12px;font-weight:${n.leida ? '400' : '600'}">${esc(n.texto)}</div>
      <div style="font-size:10px;color:var(--gray400);margin-top:2px">${esc(n.fecha)}</div>
    </div>`).join('');
}

function _pushNotif(texto) {
  _notifs.unshift({ texto, fecha: new Date().toLocaleString('es-MX'), leida: false });
  if (_notifs.length > 50) _notifs.pop();
  const badge = document.getElementById('notif-badge');
  const noLeidas = _notifs.filter(n => !n.leida).length;
  if (badge) {
    badge.textContent = noLeidas;
    badge.style.display = noLeidas > 0 ? 'flex' : 'none';
  }
}

function marcarTodasLeidas() {
  _notifs.forEach(n => { n.leida = true; });
  const badge = document.getElementById('notif-badge');
  if (badge) badge.style.display = 'none';
  _renderNotifPanel();
}

// ══════════════════════════════════════
// BÚSQUEDA GLOBAL (topbar)
// ══════════════════════════════════════
async function globalSearch(q) {
  q = (q || '').trim().toLowerCase();
  const panel = _getSearchPanel();
  if (!q) { panel.style.display = 'none'; return; }

  panel.innerHTML = '<div style="padding:14px;font-size:12px;color:var(--gray400)">Buscando…</div>';
  panel.style.display = 'block';

  try {
    const [clientes, prospectos, ops] = await Promise.all([
      DB.clientes.list().catch(() => []),
      DB.prospectos.list().catch(() => []),
      DB.ops.list().catch(() => []),
    ]);

    const hits = [];
    clientes.forEach(c => {
      if (((c.nombre || '') + (c.razon || '') + (c.rfc || '') + (c.codigo || '')).toLowerCase().includes(q))
        hits.push({ tipo: 'Cliente', label: c.nombre, sub: c.rfc || c.razon || '', view: 'clientes' });
    });
    prospectos.forEach(p => {
      if (((p.empresa || '') + (p.contacto || '') + (p.evento || '')).toLowerCase().includes(q))
        hits.push({ tipo: 'Prospecto', label: p.empresa, sub: p.evento || p.contacto || '', view: 'prospectos' });
    });
    ops.forEach(o => {
      if (((o.numero || '') + (o.desc || '')).toLowerCase().includes(q))
        hits.push({ tipo: 'OP', label: o.numero || o.desc, sub: o.desc || '', view: 'ops' });
    });

    if (!hits.length) {
      panel.innerHTML = '<div style="padding:14px;font-size:12px;color:var(--gray400)">Sin resultados para “' + esc(q) + '”</div>';
      return;
    }
    panel.innerHTML = hits.slice(0, 12).map((h, i) => `
      <div class="gs-hit" data-view="${h.view}" style="padding:10px 14px;cursor:pointer;display:flex;gap:10px;align-items:center;border-bottom:1px solid var(--black3)">
        <span style="font-size:10px;letter-spacing:.08em;color:var(--red);min-width:70px">${h.tipo.toUpperCase()}</span>
        <span style="font-size:13px;color:#fff;font-weight:500">${esc(h.label)}</span>
        <span style="font-size:11px;color:var(--gray400);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(h.sub)}</span>
      </div>`).join('');
    panel.querySelectorAll('.gs-hit').forEach(el => {
      el.onclick = () => { panel.style.display = 'none'; nav(el.dataset.view); };
    });
  } catch (err) {
    panel.innerHTML = '<div style="padding:14px;font-size:12px;color:var(--gray400)">Error al buscar</div>';
  }
}

function _getSearchPanel() {
  let panel = document.getElementById('global-search-results');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'global-search-results';
    panel.style.cssText = 'display:none;position:fixed;top:60px;left:250px;width:420px;max-height:400px;overflow-y:auto;background:var(--black2,#161616);border:1px solid var(--black3,#222);border-radius:0 0 10px 10px;z-index:999;box-shadow:0 12px 32px rgba(0,0,0,.5)';
    document.body.appendChild(panel);
    document.addEventListener('click', e => {
      if (!panel.contains(e.target) && e.target.id !== 'global-search-input') panel.style.display = 'none';
    });
  }
  return panel;
}
