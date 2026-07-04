// ══════════════════════════════════════
// AUTH — Login / 2FA / Sesión / Roles
// ══════════════════════════════════════

const ROL_LABELS = {
  admin:         'DIRECTORA GENERAL',
  ejecutivo:     'EJECUTIVO DE VENTAS',
  administracion:'ADMINISTRACIÓN',
};

let _pendingTwoFAToken = null;

function sesionActual() {
  try {
    const raw = localStorage.getItem('crm_user');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function iniciarApp() {
  const user = sesionActual();
  let token = localStorage.getItem('crm_token');
  // Descarta un token corrupto (caracteres no válidos rompen el header HTTP)
  if (token && !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
    localStorage.removeItem('crm_token');
    localStorage.removeItem('crm_user');
    token = null;
  }
  if (!user || !token) { mostrarLogin(); return; }
  aplicarSesion(user);
}

function mostrarLogin() { document.getElementById('login-screen').style.display = 'flex'; }
function ocultarLogin() { document.getElementById('login-screen').style.display = 'none'; }
function mostrar2FAScreen() { document.getElementById('twofa-screen').style.display = 'flex'; }
function ocultar2FAScreen() { document.getElementById('twofa-screen').style.display = 'none'; }
function mostrarForzarPassScreen() { document.getElementById('forzar-pass-screen').style.display = 'flex'; }
function ocultarForzarPassScreen() { document.getElementById('forzar-pass-screen').style.display = 'none'; }

function cancelar2FAScreen() {
  _pendingTwoFAToken = null;
  ocultar2FAScreen();
  mostrarLogin();
}

// ── Paso 1: usuario + contraseña ─────────
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

    if (data.requiresTwoFA) {
      _pendingTwoFAToken = data.tempToken;
      mostrarLogin(); // se queda detrás, oculto por la pantalla 2FA
      document.getElementById('login-screen').style.display = 'none';
      document.getElementById('twofa-error').style.display = 'none';
      document.getElementById('twofa-code').value = '';
      mostrar2FAScreen();
      return;
    }

    await _finalizarLogin(data);
  } catch (e) {
    errEl.textContent = 'Error de conexión con el servidor';
    errEl.style.display = 'block';
  }
}

// ── Paso 2: código de 2FA ────────────────
async function doVerify2FA() {
  const code  = document.getElementById('twofa-code').value.trim();
  const errEl = document.getElementById('twofa-error');
  errEl.style.display = 'none';

  if (!code) { errEl.textContent = 'Ingresa el código'; errEl.style.display = 'block'; return; }

  try {
    const r = await fetch('/api/auth/verify-2fa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tempToken: _pendingTwoFAToken, code }),
    });
    const data = await r.json();
    if (!r.ok) {
      errEl.textContent = data.error || 'Código incorrecto';
      errEl.style.display = 'block';
      return;
    }
    _pendingTwoFAToken = null;
    ocultar2FAScreen();
    await _finalizarLogin(data);
  } catch (e) {
    errEl.textContent = 'Error de conexión con el servidor';
    errEl.style.display = 'block';
  }
}

async function _finalizarLogin(data) {
  localStorage.setItem('crm_token', data.token);
  localStorage.setItem('crm_user', JSON.stringify({ id: data.id, nombre: data.nombre, role: data.role, ejec: data.ejec, mustChangePassword: !!data.mustChangePassword }));
  document.getElementById('login-pass').value = '';
  aplicarSesion(data);
  ocultarLogin();
  ocultar2FAScreen();

  if (data.mustChangePassword) {
    mostrarForzarPassScreen();
    return; // no cargar datos todavía — primero debe cambiar su contraseña
  }

  db.invalidate('prospectos','clientes','ops','cotizaciones','pagos','proveedores','deudas','casos','tickets');
  showSpinner();
  try { await db.prefetch(); } finally { hideSpinner(); }
  nav('dashboard');
}

// ── Cambio obligatorio de contraseña (primer login / reseteo) ──
async function doForzarCambioPassword() {
  const actual   = document.getElementById('fp-actual').value;
  const nueva    = document.getElementById('fp-nueva').value;
  const confirma = document.getElementById('fp-confirma').value;
  const errEl    = document.getElementById('fp-error');
  errEl.style.display = 'none';

  if (!actual || !nueva || !confirma) { errEl.textContent = 'Completa todos los campos'; errEl.style.display = 'block'; return; }
  if (nueva !== confirma) { errEl.textContent = 'Las contraseñas nuevas no coinciden'; errEl.style.display = 'block'; return; }

  try {
    const r = await fetch('/api/auth/cambiar-password', {
      method: 'POST',
      headers: _authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ passwordActual: actual, passwordNuevo: nueva }),
    });
    const data = await r.json();
    if (!r.ok) { errEl.textContent = data.error || 'Error al cambiar contraseña'; errEl.style.display = 'block'; return; }

    localStorage.setItem('crm_token', data.token);
    const u = sesionActual();
    if (u) { u.mustChangePassword = false; localStorage.setItem('crm_user', JSON.stringify(u)); }
    ['fp-actual','fp-nueva','fp-confirma'].forEach(id => { document.getElementById(id).value = ''; });
    ocultarForzarPassScreen();
    toast('✓ Contraseña actualizada');

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
  const nombre  = document.getElementById('topbar-nombre');
  const rol     = document.getElementById('topbar-rol');
  const avatar  = document.getElementById('topbar-avatar');
  if (nombre) nombre.textContent = user.nombre;
  if (rol)    rol.textContent    = ROL_LABELS[user.role] || user.role.toUpperCase();
  if (avatar) avatar.textContent = user.nombre.split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase();
  _aplicarRolUI(user.role);
}

function _aplicarRolUI(role) {
  document.querySelectorAll('.role-admin').forEach(el => {
    el.style.display = role === 'admin' ? '' : 'none';
  });
  document.querySelectorAll('.role-administracion').forEach(el => {
    el.style.display = (role === 'admin' || role === 'administracion') ? '' : 'none';
  });
}

function cerrarSesion() {
  localStorage.removeItem('crm_token');
  localStorage.removeItem('crm_user');
  if (window.db) db.invalidate('prospectos','clientes','ops','cotizaciones','pagos','proveedores','deudas','casos','tickets');
  ocultar2FAScreen();
  ocultarForzarPassScreen();
  mostrarLogin();
  document.getElementById('login-user').value = '';
  document.getElementById('login-pass').value = '';
}

// ══════════════════════════════════════
// MI CUENTA — contraseña + 2FA
// ══════════════════════════════════════
async function abrirMiCuenta() {
  const user = sesionActual();
  document.getElementById('mc-titulo').textContent = user?.nombre || 'Mi Cuenta';
  ['cp-actual','cp-nueva','cp-confirma'].forEach(id => { document.getElementById(id).value = ''; });
  openM('mi-cuenta');
  await _refrescarEstado2FA();
}

async function _refrescarEstado2FA() {
  const statusEl = document.getElementById('mc-2fa-status');
  const setupEl  = document.getElementById('mc-2fa-setup');
  const actionsEl = document.getElementById('mc-2fa-actions');
  setupEl.style.display = 'none';
  statusEl.textContent = 'Cargando estado…';
  actionsEl.innerHTML = '';

  try {
    const { enabled } = await API.get('/auth/2fa/status');
    if (enabled) {
      statusEl.innerHTML = '<span style="color:var(--green)">✓ Activado</span> — tu cuenta está protegida con verificación en dos pasos.';
      actionsEl.innerHTML = `
        <div class="fg" style="margin-top:8px"><label class="fl">CONTRASEÑA (PARA DESACTIVAR)</label><input class="fi" id="mc-2fa-disable-pass" type="password" placeholder="••••••••"></div>
        <button class="btn btn-ghost btn-sm" style="margin-top:8px;color:var(--red)" onclick="desactivar2FA()">Desactivar 2FA</button>`;
    } else {
      statusEl.innerHTML = '<span style="color:var(--amber)">⚠ No activado</span> — te recomendamos activarlo.';
      actionsEl.innerHTML = `<button class="btn btn-primary btn-sm" onclick="iniciarSetup2FA()">Activar 2FA</button>`;
    }
  } catch (e) {
    statusEl.textContent = 'Error al consultar el estado de 2FA';
  }
}

async function iniciarSetup2FA() {
  try {
    const { qr } = await API.get('/auth/2fa/setup');
    document.getElementById('mc-2fa-qr').src = qr;
    document.getElementById('mc-2fa-codigo').value = '';
    document.getElementById('mc-2fa-setup').style.display = 'block';
  } catch (e) {
    toast('Error al generar el código QR', 'red');
  }
}

async function confirmar2FA() {
  const code = document.getElementById('mc-2fa-codigo').value.trim();
  if (!code) { toast('Ingresa el código de tu app de autenticación', 'red'); return; }
  try {
    await API.post('/auth/2fa/confirm', { code });
    toast('✓ 2FA activado correctamente');
    await _refrescarEstado2FA();
  } catch (e) {
    toast(e.message || 'Código incorrecto', 'red');
  }
}

async function desactivar2FA() {
  const password = document.getElementById('mc-2fa-disable-pass')?.value;
  if (!password) { toast('Ingresa tu contraseña para confirmar', 'red'); return; }
  if (!confirm('¿Seguro que quieres desactivar la verificación en dos pasos?')) return;
  try {
    await API.post('/auth/2fa/disable', { password });
    toast('2FA desactivado');
    await _refrescarEstado2FA();
  } catch (e) {
    toast(e.message || 'Error al desactivar 2FA', 'red');
  }
}

// ── Cambiar contraseña (desde Mi Cuenta) ──
async function cambiarPassword() {
  const actual   = document.getElementById('cp-actual').value;
  const nueva    = document.getElementById('cp-nueva').value;
  const confirma = document.getElementById('cp-confirma').value;

  if (nueva !== confirma) { toast('Las contraseñas no coinciden', 'red'); return; }

  try {
    await API.post('/auth/cambiar-password', { passwordActual: actual, passwordNuevo: nueva });
    toast('✓ Contraseña actualizada');
    ['cp-actual','cp-nueva','cp-confirma'].forEach(id => { const el = document.getElementById(id); if (el) el.value=''; });
  } catch (e) {
    toast(e.message || 'Error al cambiar contraseña', 'red');
  }
}

// ══════════════════════════════════════
// OBJETIVOS (solo admin)
// ══════════════════════════════════════
async function abrirObjetivos() {
  const hoy = new Date();
  const mes = `${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,'0')}`;
  document.getElementById('obj-mes-label').textContent =
    `MES: ${hoy.toLocaleDateString('es-MX',{month:'long',year:'numeric'}).toUpperCase()}`;

  try {
    const obj = await API.get(`/objetivos/${mes}`);
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
      headers: _authHeaders({ 'Content-Type': 'application/json' }),
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

// ══════════════════════════════════════
// GESTIÓN DE USUARIOS (solo admin)
// ══════════════════════════════════════
const ROL_LABEL_CORTO = { admin: 'Admin', ejecutivo: 'Ejecutivo', administracion: 'Administración' };

async function abrirGestionUsuarios() {
  document.getElementById('gu-resultado').style.display = 'none';
  document.getElementById('gu-lista').innerHTML = '<div style="padding:12px;color:var(--gray400);font-size:12px">Cargando…</div>';
  openM('gestion-usuarios');

  try {
    const usuarios = await API.get('/auth/usuarios');
    document.getElementById('gu-lista').innerHTML = usuarios.map(u => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border:1px solid var(--border);border-radius:8px;${u.activo === false ? 'opacity:.55' : ''}">
        <div>
          <div style="font-size:13px;font-weight:600">${esc(u.nombre)} ${u.twoFAEnabled ? `<span style="color:var(--green);font-size:10px">${icoHTML('shield',10)} 2FA</span>` : ''} ${u.bloqueado ? `<span style="color:var(--red);font-size:10px">${icoHTML('lock',10)} BLOQUEADO</span>` : ''} ${u.activo === false ? '<span style="color:var(--gray400);font-size:10px">✕ DESACTIVADO</span>' : ''}</div>
          <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--gray400)">@${esc(u.id)} · ${esc(ROL_LABEL_CORTO[u.role] || u.role)}</div>
        </div>
        <div style="display:flex;gap:6px">
          ${u.bloqueado ? `<button class="btn btn-ghost btn-xs" onclick="desbloquearUsuario('${esc(u.id)}')">Desbloquear</button>` : ''}
          <button class="btn btn-ghost btn-xs" onclick="resetearPassword('${esc(u.id)}','${esc(u.nombre)}')">${icoHTML('key',11)} Resetear contraseña</button>
          ${u.activo === false
            ? `<button class="btn btn-ghost btn-xs" onclick="toggleActivoUsuario('${esc(u.id)}', true)">Reactivar</button>`
            : `<button class="btn btn-ghost btn-xs" style="color:var(--red)" onclick="toggleActivoUsuario('${esc(u.id)}', false)">Desactivar</button>`}
        </div>
      </div>`).join('');
    mostrarDescripcionRol();
  } catch (e) {
    document.getElementById('gu-lista').innerHTML = '<div style="padding:12px;color:var(--red);font-size:12px">Error al cargar usuarios</div>';
  }
}

async function resetearPassword(usuarioId, nombre) {
  if (!confirm(`¿Generar una nueva contraseña temporal para ${nombre}?\n\nSu contraseña actual dejará de funcionar y deberá cambiarla en su próximo ingreso.`)) return;

  try {
    const r = await API.post(`/auth/usuarios/${usuarioId}/resetear-password`, {});
    const el = document.getElementById('gu-resultado');
    el.style.display = 'block';
    el.innerHTML = `
      <div style="font-size:11px;color:var(--gray400);margin-bottom:4px;font-family:'JetBrains Mono',monospace">CONTRASEÑA TEMPORAL PARA ${esc(nombre.toUpperCase())}</div>
      <div style="font-family:'JetBrains Mono',monospace;font-size:18px;font-weight:700;color:var(--red)">${esc(r.passwordTemporal)}</div>
      <div style="font-size:11px;color:var(--gray400);margin-top:6px">Compártesela directamente — no se volverá a mostrar. Deberá cambiarla al ingresar.</div>`;
    toast('✓ Contraseña reseteada');
    abrirGestionUsuarios();
  } catch (e) {
    toast(e.message || 'Error al resetear contraseña', 'red');
  }
}

async function desbloquearUsuario(usuarioId) {
  try {
    await API.post(`/auth/usuarios/${usuarioId}/desbloquear`, {});
    toast('✓ Cuenta desbloqueada');
    abrirGestionUsuarios();
  } catch (e) {
    toast(e.message || 'Error al desbloquear', 'red');
  }
}

// ══════════════════════════════════════
// AUDITORÍA (solo admin)
// ══════════════════════════════════════
const AUD_ACCION_LABEL = {
  login_exitoso: '✓ Login exitoso', login_fallido: '✗ Login fallido', cuenta_bloqueada: 'Cuenta bloqueada',
  password_cambiado: 'Contraseña cambiada', password_reseteado: 'Contraseña reseteada (admin)',
  '2fa_activado': '2FA activado', '2fa_desactivado': '2FA desactivado',
  crear: '+ Creó registro', editar: '✎ Editó registro', eliminar: '✕ Eliminó registro', backup_generado: 'Respaldo generado',
};

async function abrirAuditoria() {
  document.getElementById('aud-lista').innerHTML = '<div style="padding:12px;color:var(--gray400);font-size:12px">Cargando…</div>';
  openM('auditoria');

  try {
    const log = await API.get('/auditoria?limit=300');
    document.getElementById('aud-lista').innerHTML = log.length ? log.map(e => `
      <div style="display:flex;align-items:center;gap:10px;padding:9px 4px;border-bottom:1px solid var(--border);${e.fueraDeHorario ? 'background:rgba(204,34,0,.04)' : ''}">
        <div style="width:8px;height:8px;border-radius:50%;background:${e.exito ? 'var(--green)' : 'var(--red)'};flex-shrink:0"></div>
        <div style="flex:1;min-width:0">
          <div style="font-size:12.5px">${esc(AUD_ACCION_LABEL[e.accion] || e.accion)} ${e.entidad ? '· ' + esc(e.entidad) : ''}</div>
          <div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--gray400)">
            ${esc(e.usuario) || 'anónimo'} · ${e.fecha ? new Date(e.fecha).toLocaleString('es-MX') : '—'} · IP ${esc(e.ip) || '—'}
            ${e.fueraDeHorario ? ' · <span style="color:var(--red)">⚠ FUERA DE HORARIO</span>' : ''}
          </div>
          ${e.detalle ? `<div style="font-size:10px;color:var(--gray400);margin-top:2px">${esc(e.detalle)}</div>` : ''}
        </div>
      </div>`).join('') : '<div style="padding:12px;color:var(--gray400);font-size:12px">Sin eventos registrados</div>';
  } catch (e) {
    document.getElementById('aud-lista').innerHTML = '<div style="padding:12px;color:var(--red);font-size:12px">Error al cargar la auditoría</div>';
  }
}

// ══════════════════════════════════════
// RESET PASSWORD (enlace por email)
// ══════════════════════════════════════
function _checkResetToken() {
  const params = new URLSearchParams(window.location.search);
  const token  = params.get('token');
  if (!token) return;

  // Ocultar todas las pantallas de login, mostrar la de reset
  ['login-screen','twofa-screen','forzar-pass-screen','olvide-screen'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const screen = document.getElementById('reset-pass-screen');
  if (screen) screen.style.display = 'flex';

  // Guardar token en atributo del botón para usarlo al enviar
  window._resetToken = token;

  // Limpiar la URL para que no aparezca el token en la barra
  window.history.replaceState({}, '', '/');
}

async function doResetPassword() {
  const nueva    = document.getElementById('rp-nueva').value;
  const confirma = document.getElementById('rp-confirma').value;
  const errEl    = document.getElementById('rp-error');
  errEl.style.display = 'none';

  if (!nueva || nueva.length < 8) {
    errEl.textContent = 'La contraseña debe tener al menos 8 caracteres';
    errEl.style.display = 'block';
    return;
  }
  if (nueva !== confirma) {
    errEl.textContent = 'Las contraseñas no coinciden';
    errEl.style.display = 'block';
    return;
  }

  try {
    const r = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: window._resetToken, nueva }),
    });
    const data = await r.json();
    if (!r.ok) {
      errEl.textContent = data.error || 'Enlace inválido o expirado';
      errEl.style.display = 'block';
      return;
    }
    document.getElementById('reset-pass-form').style.display = 'none';
    document.getElementById('reset-pass-ok').style.display   = 'block';
  } catch (e) {
    errEl.textContent = 'Error de conexión. Intenta de nuevo.';
    errEl.style.display = 'block';
  }
}

function irAlLogin() {
  document.getElementById('reset-pass-screen').style.display = 'none';
  mostrarLogin();
}

// ══════════════════════════════════════
// OLVIDÉ MI CONTRASEÑA
// ══════════════════════════════════════
function mostrarOlvidePassword() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('olvide-screen').style.display = 'flex';
  document.getElementById('olvide-email').value = '';
  document.getElementById('olvide-msg').style.display = 'none';
}

function ocultarOlvidePassword() {
  document.getElementById('olvide-screen').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
}

async function enviarResetPassword() {
  const email = document.getElementById('olvide-email').value.trim();
  const errEl = document.getElementById('olvide-error');
  if (errEl) errEl.style.display = 'none';

  if (!email) {
    if (errEl) { errEl.textContent = 'Ingresa tu correo'; errEl.style.display = 'block'; }
    return;
  }

  try {
    await fetch('/api/auth/olvide-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    // Mostrar pantalla de "ok" ocultar formulario
    const formEl = document.getElementById('olvide-form');
    const okEl   = document.getElementById('olvide-ok');
    if (formEl) formEl.style.display = 'none';
    if (okEl)   okEl.style.display   = 'block';
  } catch (e) {
    if (errEl) { errEl.textContent = 'Error de conexión. Intenta de nuevo.'; errEl.style.display = 'block'; }
  }
}

// ══════════════════════════════════════
// RESPALDO (solo admin)
// ══════════════════════════════════════
function abrirRespaldo() {
  document.getElementById('resp-status').textContent = '';
  openM('respaldo');
}

async function generarRespaldoManual() {
  const btn = document.getElementById('resp-btn');
  const statusEl = document.getElementById('resp-status');
  btn.disabled = true;
  statusEl.textContent = 'Generando respaldo, puede tardar unos segundos…';

  try {
    const r = await API.post('/backup/export', {});
    const entidades = Object.keys(r.backup.entidades || {});
    statusEl.innerHTML = r.emailResult.sent
      ? `<span style="color:var(--green)">✓ Respaldo generado y enviado por correo.</span><br>${entidades.length} bases incluidas.`
      : `<span style="color:var(--amber)">⚠ Respaldo generado pero no se envió por correo (${esc(r.emailResult.reason)}).</span><br>Descárgalo manualmente abajo.`;

    // Ofrecer descarga directa del JSON generado
    const blob = new Blob([JSON.stringify(r.backup, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `actidea-backup-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast('✓ Respaldo generado');
  } catch (e) {
    statusEl.innerHTML = `<span style="color:var(--red)">Error al generar el respaldo: ${esc(e.message)}</span>`;
  } finally {
    btn.disabled = false;
  }
}

// ── Alta de usuario nuevo (solo admin) ─────────────────────
const ROL_DESCRIPCIONES = {
  ejecutivo: 'Ejecutivo: solo ve y edita SUS propios prospectos, clientes, OPs y cotizaciones. No ve pagos, comisiones ni reportes financieros. No puede eliminar registros.',
  administracion: 'Administración: ve todos los prospectos, clientes, OPs y cotizaciones del equipo, y gestiona proveedores. No ve pagos, comisiones, auditoría ni respaldos. No puede eliminar registros.',
  admin: 'Admin (Dirección): acceso total — pagos, comisiones, reportes financieros, auditoría, respaldos, y gestión de usuarios. Puede eliminar registros.',
};

function mostrarDescripcionRol() {
  const sel = document.getElementById('nu-rol');
  const desc = document.getElementById('nu-rol-desc');
  if (sel && desc) desc.textContent = ROL_DESCRIPCIONES[sel.value] || '';
}

async function crearUsuario() {
  const usuario = (document.getElementById('nu-usuario').value || '').trim();
  const nombre  = (document.getElementById('nu-nombre').value || '').trim();
  const email   = (document.getElementById('nu-email').value || '').trim();
  const rol     = document.getElementById('nu-rol').value;

  if (!usuario || !nombre || !email) { toast('Completa usuario, nombre y correo', 'red'); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast('El correo no es válido', 'red'); return; }

  if (!confirm(`¿Crear al usuario "${nombre}" (@${usuario.toLowerCase()}) con rol ${ROL_LABEL_CORTO[rol] || rol}?\n\nSe generará una contraseña temporal que deberá cambiar en su primer ingreso.`)) return;

  try {
    const r = await API.post('/auth/usuarios', { usuario, nombre, email, rol });
    const el = document.getElementById('gu-resultado');
    el.style.display = 'block';
    el.innerHTML = `
      <div style="font-size:11px;color:var(--gray400);margin-bottom:4px;font-family:'JetBrains Mono',monospace">USUARIO CREADO — CONTRASEÑA TEMPORAL PARA ${esc(nombre.toUpperCase())}</div>
      <div style="font-family:'JetBrains Mono',monospace;font-size:18px;font-weight:700;color:var(--red)">${esc(r.passwordTemporal)}</div>
      <div style="font-size:11px;color:var(--gray400);margin-top:6px">Compártesela directamente — no se volverá a mostrar. Deberá cambiarla al ingresar por primera vez.</div>`;
    document.getElementById('nu-usuario').value = '';
    document.getElementById('nu-nombre').value = '';
    document.getElementById('nu-email').value = '';
    toast('✓ Usuario creado');
    abrirGestionUsuarios();
    el.style.display = 'block'; // abrirGestionUsuarios lo oculta — volver a mostrar el password
  } catch (e) {
    toast(e.message || 'Error al crear el usuario', 'red');
  }
}

async function toggleActivoUsuario(usuarioId, activo) {
  const msg = activo
    ? `¿Reactivar el acceso de @${usuarioId}?`
    : `¿Desactivar a @${usuarioId}?\n\nNo podrá iniciar sesión hasta que lo reactives.`;
  if (!confirm(msg)) return;
  try {
    await API.post(`/auth/usuarios/${usuarioId}/activar`, { activo });
    toast(activo ? '✓ Usuario reactivado' : '✓ Usuario desactivado');
    abrirGestionUsuarios();
  } catch (e) {
    toast(e.message || 'Error al cambiar el estado', 'red');
  }
}
