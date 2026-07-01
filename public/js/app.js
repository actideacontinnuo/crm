// ══════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════
const EJEC_LIST = ['Natalia Gama', 'Ximena', 'Alexia'];
const EJEC_COL = { 'Natalia Gama': '#CC2200', 'Ximena': '#1A6B3C', 'Alexia': '#A0620A' };

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

    // Cerrar si se hace click fuera
    setTimeout(() => {
      document.addEventListener('click', _cerrarAvatarMenu, { once: true });
    }, 0);
  }
}

function _cerrarAvatarMenu(e) {
  const menu   = document.getElementById('avatar-menu');
  const avatar = document.getElementById('topbar-avatar');
  if (!menu) return;
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
