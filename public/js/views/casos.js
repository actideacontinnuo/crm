// ══════════════════════════════════════
// CASOS VIEW
// ══════════════════════════════════════
const CASO_PRIO_ICON = { Alta: '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--red);vertical-align:1px"></span>', Media: '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--amber);vertical-align:1px"></span>', Baja: '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--green);vertical-align:1px"></span>' };

async function renderCasos() {
  const cliF = document.getElementById('cas-filter-cli')?.value || '';
  const stF  = document.getElementById('cas-filter-status')?.value || '';

  showSpinner();
  let casos, clientes, ops;
  try {
    [casos, clientes, ops] = await Promise.all([
      db.casos.list(),
      db.clientes.list(),
      db.ops.list(),
    ]);
  } catch (e) {
    toast('Error al cargar casos', 'red');
    return;
  } finally {
    hideSpinner();
  }

  // Populate client filter select
  const casCliFilter = document.getElementById('cas-filter-cli');
  if (casCliFilter && casCliFilter.options.length <= 1) {
    casCliFilter.innerHTML = '<option value="">TODOS LOS CLIENTES</option>' + clientes.map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('');
  }

  const cliMap = Object.fromEntries(clientes.map(c => [c.id, c]));
  const opMap  = Object.fromEntries(ops.map(o => [o.id, o]));

  const list = casos.filter(c => (!cliF || c.clienteId === cliF) && (!stF || c.status === stF));

  const abiertos   = casos.filter(c => c.status === 'Abierto').length;
  const enProceso  = casos.filter(c => c.status === 'En proceso').length;
  const cerrados   = casos.filter(c => c.status === 'Cerrado').length;

  document.getElementById('casos-kpis').innerHTML = `
    <div class="kpi"><div class="kpi-label">CASOS ABIERTOS</div><div class="kpi-value kv-red">${abiertos}</div><div class="kpi-delta down">Requieren acción</div></div>
    <div class="kpi"><div class="kpi-label">EN PROCESO</div><div class="kpi-value">${enProceso}</div><div class="kpi-delta">En seguimiento</div></div>
    <div class="kpi"><div class="kpi-label">CERRADOS</div><div class="kpi-value kv-green">${cerrados}</div><div class="kpi-delta up">Resueltos</div></div>
    <div class="kpi"><div class="kpi-label">TOTAL</div><div class="kpi-value">${casos.length}</div></div>`;

  document.getElementById('casos-tbody').innerHTML = list.length
    ? list.map(c => {
        const cli = cliMap[c.clienteId] || {};
        const op  = opMap[c.opId] || {};
        return `<tr onclick="openDetalleCaso('${c.id}')">
          <td>
            <div style="font-size:11px;font-family:'JetBrains Mono',monospace;color:var(--red)">CASO-${c.id.slice(-4).toUpperCase()}</div>
            <div style="font-size:13px;font-weight:600">${esc(c.titulo)}</div>
          </td>
          <td><div style="font-size:12px">${esc(cli.nombre) || '—'}</div></td>
          <td class="mono" style="font-size:10px">${esc(op.numero) || '—'}</td>
          <td><span class="tag tag-gray">${esc(c.tipo) || '—'}</span></td>
          <td class="prio-${(c.prio||'').toLowerCase()}">${CASO_PRIO_ICON[c.prio] || ''} ${esc(c.prio) || '—'}</td>
          <td>${pillHTML(c.status)}</td>
          <td class="mono">${esc(c.fecha) || '—'}</td>
          <td><button class="btn btn-ghost btn-xs" onclick="event.stopPropagation();openDetalleCaso('${c.id}')">Ver</button></td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="8"><div class="empty-state"><div>${icoHTML('ticket',26)}</div><div>SIN CASOS REGISTRADOS</div></div></td></tr>`;
}

async function saveCaso() {
  const titulo = document.getElementById('cas-titulo')?.value.trim();
  if (!titulo) { toast('El título del caso es requerido', 'red'); return; }

  const cliId = document.getElementById('cas-cliente')?.value;
  const quien = document.getElementById('cas-quien')?.value || 'Sistema';
  const data = {
    clienteId: cliId || '',
    opId:      document.getElementById('cas-op')?.value || '',
    tipo:      document.getElementById('cas-tipo')?.value,
    prio:      document.getElementById('cas-prio')?.value || 'Media',
    titulo,
    quien,
    desc:      document.getElementById('cas-desc')?.value || '',
    accion:    document.getElementById('cas-accion')?.value || '',
    status:    'Abierto',
    fecha:     new Date().toISOString().split('T')[0],
    historial: ['Caso abierto por ' + quien + ' · ' + new Date().toLocaleDateString('es-MX')],
  };

  showSpinner();
  try {
    await db.casos.create(data);
    closeM('nuevo-caso');
    ['cas-titulo','cas-desc','cas-accion'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    toast('✓ Caso abierto: ' + titulo.slice(0, 40));
    renderCasos();
    updateBadges();
  } catch (e) {
    toast('Error al guardar caso: ' + e.message, 'red');
  } finally {
    hideSpinner();
  }
}

async function openDetalleCaso(id) {
  showSpinner();
  let c, clientes, ops;
  try {
    [c, clientes, ops] = await Promise.all([
      db.casos.get(id),
      db.clientes.list(),
      db.ops.list(),
    ]);
  } catch (e) {
    toast('Error al cargar caso', 'red');
    return;
  } finally {
    hideSpinner();
  }

  STATE.selCaso = id;
  const cliMap = Object.fromEntries(clientes.map(x => [x.id, x]));
  const opMap  = Object.fromEntries(ops.map(x => [x.id, x]));
  const cli = cliMap[c.clienteId] || {};
  const op  = opMap[c.opId] || {};

  document.getElementById('dcas-num').textContent    = 'CASO-' + c.id.slice(-4).toUpperCase() + ' · ' + c.status.toUpperCase();
  document.getElementById('dcas-titulo').textContent = c.titulo;

  document.getElementById('dcas-info').innerHTML = `
    <div class="info-cell"><div class="info-cell-label">CLIENTE</div><div class="info-cell-val">${esc(cli.nombre) || '—'}</div></div>
    <div class="info-cell"><div class="info-cell-label">OP RELACIONADA</div><div class="info-cell-val" style="font-family:'JetBrains Mono',monospace;font-size:12px">${esc(op.numero) || '—'}</div></div>
    <div class="info-cell"><div class="info-cell-label">TIPO · PRIORIDAD</div><div class="info-cell-val">${esc(c.tipo)}</div><div style="font-size:11px;color:var(--gray400)">${CASO_PRIO_ICON[c.prio] || ''} ${esc(c.prio)}</div></div>
    <div class="info-cell"><div class="info-cell-label">LEVANTÓ</div><div class="info-cell-val">${esc(c.quien)}</div><div style="font-size:11px;color:var(--gray400)">${esc(c.fecha)}</div></div>
    <div class="info-cell col-span2" style="border:1px solid var(--amber-bdr);background:var(--amber-dim)"><div class="info-cell-label" style="color:var(--amber)">ACCIÓN REQUERIDA</div><div class="info-cell-val">${esc(c.accion) || '—'}</div></div>`;

  _renderHistorialCaso(c.historial || []);
  document.getElementById('dcas-nota').value = '';

  const btn = document.getElementById('dcas-cerrar-btn');
  if (c.status === 'Cerrado') {
    btn.textContent = 'Caso cerrado ✓'; btn.disabled = true; btn.style.opacity = '.5';
  } else {
    btn.textContent = '✓ Cerrar Caso'; btn.disabled = false; btn.style.opacity = '1';
  }

  openM('detalle-caso');
}

function _renderHistorialCaso(historial) {
  document.getElementById('dcas-historial').innerHTML = (historial || []).map(h =>
    `<div class="seg-row"><div class="seg-dot"></div><div style="font-size:12.5px">${esc(h)}</div></div>`
  ).join('') || '<div style="color:var(--gray400);font-size:12px;padding:8px 0">Sin historial</div>';
}

async function addNotaCaso() {
  const nota = document.getElementById('dcas-nota')?.value.trim();
  if (!nota) return;

  const c = await db.casos.get(STATE.selCaso);
  const historial = [...(c.historial || []), nota + ' · ' + new Date().toLocaleDateString('es-MX')];

  showSpinner();
  try {
    await db.casos.update(STATE.selCaso, { historial });
    _renderHistorialCaso(historial);
    document.getElementById('dcas-nota').value = '';
    toast('✓ Nota guardada en el caso');
  } catch (e) {
    toast('Error al guardar nota', 'red');
  } finally {
    hideSpinner();
  }
}

async function cerrarCaso() {
  const c = await db.casos.get(STATE.selCaso);
  const historial = [...(c.historial || []), 'Caso cerrado · ' + new Date().toLocaleDateString('es-MX')];
  showSpinner();
  try {
    await db.casos.update(STATE.selCaso, { status: 'Cerrado', historial });
    closeM('detalle-caso');
    toast('✓ Caso cerrado');
    renderCasos();
    updateBadges();
  } catch (e) {
    toast('Error al cerrar caso', 'red');
  } finally {
    hideSpinner();
  }
}
