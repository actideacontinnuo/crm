// ══════════════════════════════════════
// PROSPECTOS VIEW
// ══════════════════════════════════════
const KANBAN_COLS = [
  { id: 'Nuevo',           label: 'NUEVO',            col: 'var(--gray200)', icon: '○' },
  { id: 'Contactado',      label: 'CONTACTADO',       col: '#0077CC',        icon: '◉' },
  { id: 'En conversación', label: 'EN CONVERSACIÓN',  col: 'var(--amber)',   icon: '◎' },
  { id: 'Listo p/ cotizar',label: 'LISTO P/ COTIZAR', col: 'var(--green)',   icon: '●' },
];

async function renderProspectos() {
  const q   = (document.getElementById('prosp-search')?.value || '').toLowerCase();
  const st  = document.getElementById('prosp-status')?.value || '';
  const ej  = document.getElementById('prosp-ejec')?.value || '';

  showSpinner();
  let list;
  try {
    list = await db.prospectos.list();
  } catch (e) {
    toast('Error al cargar prospectos', 'red');
    return;
  } finally {
    hideSpinner();
  }

  const filtered = list.filter(p =>
    (!q  || (p.empresa + p.contacto + p.evento).toLowerCase().includes(q)) &&
    (!st || p.status === st) &&
    (!ej || p.ejec === ej)
  );

  const today = new Date().toISOString().split('T')[0];
  const tbody = document.getElementById('prosp-tbody');
  tbody.innerHTML = filtered.length
    ? filtered.map(p => `<tr onclick="openDetalleProspecto('${p.id}')">
        <td><div style="font-weight:600">${esc(p.empresa)}</div><div style="font-size:11px;color:var(--gray400)">${esc(p.evento)}</div></td>
        <td><div style="display:flex;align-items:center;gap:7px">
          <div class="av">${esc((p.contacto||'?').split(' ').map(x=>x[0]).join('').slice(0,2))}</div>
          <div><div style="font-size:12px">${esc(p.contacto)}</div><div style="font-size:10px;color:var(--gray400)">${esc(p.cargo)}</div></div>
        </div></td>
        <td>${pillHTML(p.status)}</td>
        <td><div style="font-size:12px">${esc(p.ejec)}</div></td>
        <td class="mono">${fmx(p.estimado)}</td>
        <td class="mono" style="color:${p.seguimiento && p.seguimiento <= today ? 'var(--red)' : ''}">${esc(p.seguimiento) || '—'}</td>
        <td><span class="tag tag-gray">${esc(p.fuente) || '—'}</span></td>
        <td><button class="btn btn-ghost btn-xs" onclick="event.stopPropagation();openDetalleProspecto('${p.id}')">Ver</button></td>
      </tr>`).join('')
    : `<tr><td colspan="8"><div class="empty-state"><div>🔍</div><div>SIN RESULTADOS</div></div></td></tr>`;
}

const _LOCKED_FIELDS = ['np-empresa','np-contacto','np-tel','np-email'];

function _unlockProspFields() {
  _LOCKED_FIELDS.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.readOnly = false;
    el.style.background = '';
    el.style.color      = '';
    el.style.cursor     = '';
    el.title            = '';
    el.onclick          = null;
  });
}

async function openEditarProspecto() {
  const id = STATE.selProsp;
  if (!id) return;
  showSpinner();
  let p;
  try {
    p = await db.prospectos.get(id);
  } catch (e) {
    toast('Error al cargar prospecto', 'red');
    return;
  } finally {
    hideSpinner();
  }

  // Pre-fill the form
  document.getElementById('np-empresa').value   = p.empresa    || '';
  document.getElementById('np-contacto').value  = p.contacto   || '';
  document.getElementById('np-cargo').value     = p.cargo      || '';
  document.getElementById('np-tel').value       = p.tel        || '';
  document.getElementById('np-email').value     = p.email      || '';
  document.getElementById('np-evento').value    = p.evento     || '';
  document.getElementById('np-estimado').value  = p.estimado   || '';
  document.getElementById('np-fecha').value     = p.seguimiento || '';
  document.getElementById('np-notas').value     = '';

  // Lock fields that cannot be modified after creation
  const LOCKED = ['np-empresa','np-contacto','np-tel','np-email'];
  LOCKED.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.readOnly = true;
    el.style.background   = 'var(--cream)';
    el.style.color        = 'var(--gray400)';
    el.style.cursor       = 'not-allowed';
    el.title              = '🔒 Este campo no se puede modificar';
    el.onclick            = () => toast('🔒 Este campo está bloqueado y no puede modificarse', 'red');
  });

  const ejec = document.getElementById('np-ejec');
  if (ejec) { for (let i = 0; i < ejec.options.length; i++) if (ejec.options[i].value === p.ejec) ejec.selectedIndex = i; }
  const fuente = document.getElementById('np-fuente');
  if (fuente) { for (let i = 0; i < fuente.options.length; i++) if (fuente.options[i].value === p.fuente) fuente.selectedIndex = i; }
  const status = document.getElementById('np-status');
  if (status) { for (let i = 0; i < status.options.length; i++) if (status.options[i].value === p.status) status.selectedIndex = i; }

  // Mark as edit mode
  STATE.editingProspId = id;
  document.querySelector('#m-nuevo-prospecto .modal-eye').textContent  = 'EDITAR PROSPECTO';
  document.querySelector('#m-nuevo-prospecto .modal-title').textContent = p.empresa;

  closeM('detalle-prospecto');
  setTimeout(() => openM('nuevo-prospecto'), 200);
}

async function saveProspecto() {
  const emp = document.getElementById('np-empresa').value.trim();
  if (!emp) { toast('El nombre de empresa es requerido', 'red'); return; }

  const notaRaw = document.getElementById('np-notas').value.trim();

  const data = {
    empresa:    emp,
    contacto:   document.getElementById('np-contacto').value || 'Sin nombre',
    cargo:      document.getElementById('np-cargo').value || '',
    tel:        document.getElementById('np-tel').value || '',
    email:      document.getElementById('np-email').value || '',
    evento:     document.getElementById('np-evento').value || '',
    estimado:   String(parseFloat(document.getElementById('np-estimado').value) || 0),
    ejec:       document.getElementById('np-ejec').value,
    fuente:     document.getElementById('np-fuente').value,
    status:     document.getElementById('np-status').value,
    seguimiento: document.getElementById('np-fecha').value || new Date().toISOString().split('T')[0],
  };

  const editingId = STATE.editingProspId || null;

  if (editingId) {
    // Strip locked fields — they can never be changed after creation
    delete data.empresa;
    delete data.contacto;
    delete data.tel;
    delete data.email;
  } else {
    // New prospecto: attach the note
    if (notaRaw) data.notas = [notaRaw + ' · ' + new Date().toLocaleDateString('es-MX')];
  }

  showSpinner();
  try {
    if (editingId) {
      await db.prospectos.update(editingId, data);
      // Append new note if provided
      if (notaRaw) {
        const p = await db.prospectos.get(editingId);
        const notas = [...(p.notas || []), notaRaw + ' · ' + new Date().toLocaleDateString('es-MX')];
        await db.prospectos.update(editingId, { notas });
      }
      toast('✓ Prospecto actualizado');
    } else {
      await db.prospectos.create(data);
      toast('✓ Prospecto guardado');
    }

    // Reset form and state
    closeM('nuevo-prospecto');
    STATE.editingProspId = null;
    document.querySelector('#m-nuevo-prospecto .modal-eye').textContent   = 'NUEVO PROSPECTO';
    document.querySelector('#m-nuevo-prospecto .modal-title').textContent = 'Registrar Prospecto';
    ['np-empresa','np-contacto','np-cargo','np-tel','np-email','np-evento','np-estimado','np-notas','np-fecha']
      .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    _unlockProspFields();

    renderProspectos();
    updateBadges();
  } catch (e) {
    toast('Error al guardar: ' + e.message, 'red');
  } finally {
    hideSpinner();
  }
}

async function openDetalleProspecto(id) {
  showSpinner();
  let p;
  try {
    p = await db.prospectos.get(id);
  } catch (e) {
    toast('Error al cargar prospecto', 'red');
    return;
  } finally {
    hideSpinner();
  }

  STATE.selProsp = id;
  document.getElementById('dp-eye').textContent = p.status.toUpperCase();
  document.getElementById('dp-empresa').textContent = p.empresa;
  document.getElementById('dp-info').innerHTML = `
    <div class="info-cell"><div class="info-cell-label">CONTACTO</div><div class="info-cell-val">${esc(p.contacto)}</div><div style="font-size:11px;color:var(--gray400)">${esc(p.cargo)}</div></div>
    <div class="info-cell"><div class="info-cell-label">EVENTO</div><div class="info-cell-val">${esc(p.evento)}</div></div>
    <div class="info-cell"><div class="info-cell-label">TELÉFONO</div><div class="info-cell-val" style="font-family:'JetBrains Mono',monospace;font-size:12px">${esc(p.tel) || '—'}</div></div>
    <div class="info-cell"><div class="info-cell-label">EMAIL</div><div class="info-cell-val" style="font-size:12px">${esc(p.email) || '—'}</div></div>
    <div class="info-cell"><div class="info-cell-label">ESTIMADO</div><div class="info-cell-val" style="color:var(--red)">${fmx(p.estimado)}</div></div>
    <div class="info-cell"><div class="info-cell-label">EJECUTIVO</div><div class="info-cell-val">${esc(p.ejec)}</div></div>
    <div class="info-cell"><div class="info-cell-label">FUENTE</div><div class="info-cell-val">${esc(p.fuente) || '—'}</div></div>
    <div class="info-cell"><div class="info-cell-label">SEGUIMIENTO</div><div class="info-cell-val">${esc(p.seguimiento) || '—'}</div></div>`;

  _renderNotasProsp(p.notas || []);
  document.getElementById('dp-nueva-nota').value = '';

  // Populate status select
  const sel = document.getElementById('dp-status');
  if (sel) sel.value = p.status;

  openM('detalle-prospecto');
}

function _renderNotasProsp(notas) {
  document.getElementById('dp-notas').innerHTML = notas.length
    ? notas.map(n => `<div class="seg-row"><div class="seg-dot"></div><div style="font-size:12.5px">${esc(n)}</div></div>`).join('')
    : '<div style="color:var(--gray400);font-size:12px;padding:8px 0">Sin notas registradas</div>';
}

async function addNotaProspecto() {
  const n = document.getElementById('dp-nueva-nota').value.trim();
  if (!n) return;

  const p = await db.prospectos.get(STATE.selProsp);
  const notas = [...(p.notas || []), n + ' · ' + new Date().toLocaleDateString('es-MX')];

  showSpinner();
  try {
    await db.prospectos.update(STATE.selProsp, { notas });
    _renderNotasProsp(notas);
    document.getElementById('dp-nueva-nota').value = '';
    toast('✓ Nota guardada');
  } catch (e) {
    toast('Error al guardar nota', 'red');
  } finally {
    hideSpinner();
  }
}

async function updateProspectoStatus() {
  const status = document.getElementById('dp-status')?.value;
  if (!status) return;
  showSpinner();
  try {
    await db.prospectos.update(STATE.selProsp, { status });
    toast('✓ Status actualizado');
    renderProspectos();
    updateBadges();
  } catch (e) {
    toast('Error al actualizar', 'red');
  } finally {
    hideSpinner();
  }
}

async function convertirACliente() {
  const p = await db.prospectos.get(STATE.selProsp);
  closeM('detalle-prospecto');
  setTimeout(() => {
    document.getElementById('nc-nombre').value  = p.empresa;
    document.getElementById('nc-contacto').value = p.contacto;
    document.getElementById('nc-cargo').value   = p.cargo;
    document.getElementById('nc-tel').value     = p.tel;
    document.getElementById('nc-email').value   = p.email;
    const sel = document.getElementById('nc-ejec');
    if (sel) { for (let i = 0; i < sel.options.length; i++) if (sel.options[i].value === p.ejec) sel.selectedIndex = i; }
    openM('nuevo-cliente');
  }, 200);
}

// ── Kanban ──────────────────────────────
function setProspView(v, el) {
  STATE.prospView = v;
  document.querySelectorAll('#view-prospectos .vsel-btn').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  const lista  = document.getElementById('prosp-lista-wrap');
  const kanban = document.getElementById('prosp-kanban-wrap');
  const bar    = document.getElementById('prosp-search-bar');
  if (lista)  lista.style.display  = v === 'lista'  ? '' : 'none';
  if (kanban) kanban.style.display = v === 'kanban' ? '' : 'none';
  if (bar)    bar.style.display    = v === 'lista'  ? '' : 'none';
  if (v === 'kanban') renderKanban(); else renderProspectos();
}

async function renderKanban() {
  const board = document.getElementById('kanban-board');
  if (!board) return;
  const list = await db.prospectos.list();
  board.innerHTML = KANBAN_COLS.map(col => {
    const cards = list.filter(p => p.status === col.id);
    const total = cards.reduce((a, p) => a + (parseFloat(p.estimado) || 0), 0);
    return `<div style="background:var(--white);border:1px solid var(--border);border-radius:10px;overflow:hidden;flex:0 0 230px">
      <div style="padding:11px 14px;border-bottom:1px solid var(--border);background:var(--cream)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:2px">
          <div style="font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:.14em;color:${col.col};font-weight:700">${col.icon} ${col.label}</div>
          <div style="background:${col.col};color:var(--white);font-family:'JetBrains Mono',monospace;font-size:9px;padding:2px 7px;border-radius:10px">${cards.length}</div>
        </div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--gray400)">${fmx(total)} est.</div>
      </div>
      <div style="padding:10px;display:flex;flex-direction:column;gap:8px;min-height:80px">
        ${cards.map(p => `
          <div onclick="openDetalleProspecto('${p.id}')" style="background:var(--cream);border:1px solid var(--border);border-left:3px solid ${col.col};border-radius:7px;padding:10px 12px;cursor:pointer;transition:box-shadow .12s" onmouseover="this.style.boxShadow='0 2px 8px rgba(0,0,0,.08)'" onmouseout="this.style.boxShadow='none'">
            <div style="font-size:13px;font-weight:600;margin-bottom:2px">${esc(p.empresa)}</div>
            <div style="font-size:11px;color:var(--gray400);margin-bottom:7px">${esc(p.evento)}</div>
            <div style="display:flex;align-items:center;justify-content:space-between">
              <div style="display:flex;align-items:center;gap:5px">
                <div class="av" style="width:20px;height:20px;font-size:7px">${esc(p.ejec.split(' ').map(x=>x[0]).join('').slice(0,2))}</div>
                <span style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--gray400)">${esc(p.ejec.split(' ')[0])}</span>
              </div>
              <span style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;color:var(--red)">${fmx(p.estimado)}</span>
            </div>
            <div style="display:flex;justify-content:space-between;margin-top:6px;border-top:1px solid var(--border);padding-top:6px">
              <span style="font-family:'JetBrains Mono',monospace;font-size:8px;color:var(--gray400)">📅 ${esc(p.seguimiento) || '—'}</span>
              <select onclick="event.stopPropagation()" onchange="moveKanbanCard('${p.id}',this.value)" style="font-family:'JetBrains Mono',monospace;font-size:8px;border:none;background:none;color:var(--gray400);cursor:pointer">
                <option value="">Mover a...</option>
                ${KANBAN_COLS.filter(c => c.id !== p.status).map(c => `<option value="${c.id}">${c.label}</option>`).join('')}
              </select>
            </div>
          </div>`).join('')}
        <div onclick="openM('nuevo-prospecto')" style="border:1.5px dashed var(--border-d);border-radius:7px;padding:9px;text-align:center;cursor:pointer;color:var(--gray400);font-size:11px;transition:all .12s" onmouseover="this.style.borderColor='${col.col}';this.style.color='${col.col}'" onmouseout="this.style.borderColor='var(--border-d)';this.style.color='var(--gray400)'">+ Agregar</div>
      </div>
    </div>`;
  }).join('');
}

async function moveKanbanCard(id, newStatus) {
  if (!newStatus) return;
  showSpinner();
  try {
    await db.prospectos.update(id, { status: newStatus });
    toast('✓ Movido a: ' + newStatus);
    renderKanban();
    updateBadges();
  } catch (e) {
    toast('Error al mover tarjeta', 'red');
  } finally {
    hideSpinner();
  }
}
