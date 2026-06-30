// ══════════════════════════════════════
// AUTH — Login / Sesión / Roles
// ══════════════════════════════════════

const ROL_LABELS = {
  admin:         'DIRECTORA GENERAL',
  ejecutivo:     'EJECUTIVO DE VENTAS',
  administracion:'ADMINISTRACIÓN',
};

// Lee el usuario actual del localStorage
function sesionActual() {
  try {
    const raw = localStorage.getItem('crm_user');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// Al cargar la página: si hay token válido, mostrar CRM; si no, mostrar login
function iniciarApp() {
  const user = sesionActual();
  const token = localStorage.getItem('crm_token');
  if (!user || !token) {
    mostrarLogin();
    return;
  }
  aplicarSesion(user);
}

function mostrarLogin() {
  document.getElementById('login-screen').style.display = 'flex';
}

function ocultarLogin() {
  document.getElementById('login-screen').style.display = 'none';
}

async function doLogin() {
  const usuario  = document.getElementById('login-user').value.trim();
  const password = document.getElementById('login-pass').value;
  const errEl    = document.getElementById('login-error');
  errEl.style.display = 'none';

  if (!usuario || !password) {
    errEl.textContent = 'Ingresa usuario y contraseña';
    errEl.style.display = 'block';
    return;
  }

  try {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario, password }),
    });
    const data = await r.json();
    if (!r.ok) {
      errEl.textContent = data.error || 'Error al iniciar sesión';
      errEl.style.display = 'block';
      return;
    }
    localStorage.setItem('crm_token', data.token);
    localStorage.setItem('crm_user', JSON.stringify({ id: data.id, nombre: data.nombre, role: data.role, ejec: data.ejec }));
    document.getElementById('login-pass').value = '';
    aplicarSesion(data);
    ocultarLogin();

    // Refrescar todos los datos con los permisos del usuario que acaba de entrar
    db.invalidate('prospectos','clientes','ops','cotizaciones','pagos','proveedores','deudas','casos','tickets');
    showSpinner();
    try { await db.prefetch(); } finally { hideSpinner(); }
    nav('dashboard');
  } catch (e) {
    errEl.textContent = 'Error de conexión con el servidor';
    errEl.style.display = 'block';
  }
}

function aplicarSesion(user) {
  // Topbar
  const nombre  = document.getElementById('topbar-nombre');
  const rol     = document.getElementById('topbar-rol');
  const avatar  = document.getElementById('topbar-avatar');
  if (nombre) nombre.textContent = user.nombre;
  if (rol)    rol.textContent    = ROL_LABELS[user.role] || user.role.toUpperCase();
  if (avatar) avatar.textContent = user.nombre.split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase();

  // Mostrar/ocultar elementos según rol
  _aplicarRolUI(user.role);
}

function _aplicarRolUI(role) {
  // Elementos con clase role-admin: solo visibles para admin
  document.querySelectorAll('.role-admin').forEach(el => {
    el.style.display = role === 'admin' ? '' : 'none';
  });
  // Elementos con clase role-administracion: visibles para admin y administración
  document.querySelectorAll('.role-administracion').forEach(el => {
    el.style.display = (role === 'admin' || role === 'administracion') ? '' : 'none';
  });
}

function cerrarSesion() {
  localStorage.removeItem('crm_token');
  localStorage.removeItem('crm_user');
  // Limpiar caché
  if (window.db) db.invalidate('prospectos','clientes','ops','cotizaciones','pagos','proveedores','deudas','casos','tickets');
  mostrarLogin();
  document.getElementById('login-user').value = '';
  document.getElementById('login-pass').value = '';
}

// ── Objetivos ────────────────────────────
async function abrirObjetivos() {
  const hoy = new Date();
  const mes = `${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,'0')}`;
  document.getElementById('obj-mes-label').textContent =
    `MES: ${hoy.toLocaleDateString('es-MX',{month:'long',year:'numeric'}).toUpperCase()}`;

  try {
    const token = localStorage.getItem('crm_token');
    const r = await fetch(`/api/objetivos/${mes}`, { headers: { 'Authorization': 'Bearer ' + token } });
    const obj = await r.json();
    ['opsActivas','cotizado','cobros','pipeline','cliActivos','comisiones'].forEach(k => {
      const el = document.getElementById('obj-' + k);
      if (el) el.value = obj[k] || '';
    });
  } catch {}

  openM('objetivos');
}

async function guardarObjetivos() {
  const hoy = new Date();
  const mes = `${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,'0')}`;
  const body = {};
  ['opsActivas','cotizado','cobros','pipeline','cliActivos','comisiones'].forEach(k => {
    const v = parseFloat(document.getElementById('obj-' + k)?.value);
    if (!isNaN(v)) body[k] = v;
  });

  try {
    const token = localStorage.getItem('crm_token');
    const r = await fetch(`/api/objetivos/${mes}`, {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error();
    toast('✓ Objetivos guardados');
    closeM('objetivos');
    renderDashboard();
  } catch {
    toast('Error al guardar objetivos', 'red');
  }
}

// ── Gestión de usuarios (solo admin) ─────
const ROL_LABEL_CORTO = { admin: 'Admin', ejecutivo: 'Ejecutivo', administracion: 'Administración' };

async function abrirGestionUsuarios() {
  document.getElementById('gu-resultado').style.display = 'none';
  document.getElementById('gu-lista').innerHTML = '<div style="padding:12px;color:var(--gray400);font-size:12px">Cargando…</div>';
  openM('gestion-usuarios');

  try {
    const usuarios = await API.get('/auth/usuarios');
    document.getElementById('gu-lista').innerHTML = usuarios.map(u => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border:1px solid var(--border);border-radius:8px">
        <div>
          <div style="font-size:13px;font-weight:600">${u.nombre}</div>
          <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--gray400)">@${u.id} · ${ROL_LABEL_CORTO[u.role] || u.role}</div>
        </div>
        <button class="btn btn-ghost btn-xs" onclick="resetearPassword('${u.id}','${u.nombre}')">🔑 Resetear contraseña</button>
      </div>`).join('');
  } catch (e) {
    document.getElementById('gu-lista').innerHTML = '<div style="padding:12px;color:var(--red);font-size:12px">Error al cargar usuarios</div>';
  }
}

async function resetearPassword(usuarioId, nombre) {
  if (!confirm(`¿Generar una nueva contraseña temporal para ${nombre}?\n\nSu contraseña actual dejará de funcionar.`)) return;

  try {
    const r = await API.post(`/auth/usuarios/${usuarioId}/resetear-password`, {});
    const el = document.getElementById('gu-resultado');
    el.style.display = 'block';
    el.innerHTML = `
      <div style="font-size:11px;color:var(--gray400);margin-bottom:4px;font-family:'JetBrains Mono',monospace">CONTRASEÑA TEMPORAL PARA ${nombre.toUpperCase()}</div>
      <div style="font-family:'JetBrains Mono',monospace;font-size:18px;font-weight:700;color:var(--red)">${r.passwordTemporal}</div>
      <div style="font-size:11px;color:var(--gray400);margin-top:6px">Compártesela directamente — no se volverá a mostrar.</div>`;
    toast('✓ Contraseña reseteada');
  } catch (e) {
    toast(e.message || 'Error al resetear contraseña', 'red');
  }
}

// ── Cambiar contraseña ───────────────────
async function cambiarPassword() {
  const actual   = document.getElementById('cp-actual').value;
  const nueva    = document.getElementById('cp-nueva').value;
  const confirma = document.getElementById('cp-confirma').value;

  if (nueva !== confirma) { toast('Las contraseñas no coinciden', 'red'); return; }
  if (nueva.length < 8)   { toast('Mínimo 8 caracteres', 'red'); return; }

  try {
    await API.post('/auth/cambiar-password', { passwordActual: actual, passwordNuevo: nueva });
    toast('✓ Contraseña actualizada');
    closeM('cambiar-pass');
    ['cp-actual','cp-nueva','cp-confirma'].forEach(id => { const el = document.getElementById(id); if (el) el.value=''; });
  } catch (e) {
    toast(e.message || 'Error al cambiar contraseña', 'red');
  }
}
