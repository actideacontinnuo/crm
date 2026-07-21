// ══════════════════════════════════════
// COTIZACIONES — SOLO ARCHIVOS (PDF + Excel en Notion)
// Cada cotización es un PDF y/o un Excel adjunto. Sin cotizador ni cálculos.
// ══════════════════════════════════════

async function renderCotizaciones() {
  showSpinner();
  let cots, clientes, ops;
  try {
    [cots, clientes, ops] = await Promise.all([
      db.cotizaciones.list(),
      db.clientes.list(),
      db.ops.list(),
    ]);
  } catch (e) {
    toast('Error al cargar cotizaciones', 'red');
    return;
  } finally {
    hideSpinner();
  }

  const cliMap = Object.fromEntries(clientes.map(c => [c.id, c]));
  const opMap  = Object.fromEntries(ops.map(o => [o.id, o]));

  const fileLink = (arr, label, icon) => {
    const f = (arr || [])[0];
    if (!f || !f.url) return `<span class="tag" style="opacity:.5">SIN ${label}</span>`;
    return `<a href="${esc(f.url)}" target="_blank" rel="noopener" class="tag tag-green" style="text-decoration:none" onclick="event.stopPropagation()">${icon} ${label} ↓</a>`;
  };

  const tbody = document.getElementById('cot-tbody');
  tbody.innerHTML = cots.length
    ? cots.map(c => {
        const cli = cliMap[c.clienteId] || {};
        const op  = opMap[c.opId] || {};
        const titulo = (c.opId && op.numero ? op.numero : (c.cotId || 'COT-' + c.id.slice(-4)));
        return `<tr onclick="openVerCotizacion('${c.id}')">
          <td class="mono" style="color:var(--red)">${esc(titulo)}</td>
          <td><div style="font-weight:600">${esc(cli.nombre) || '—'}</div><div style="font-size:11px;color:var(--gray400)">${esc(op.desc) || '—'}</div></td>
          <td class="mono">${esc(c.fecha) || '—'}</td>
          <td>${pillHTML(c.status)}</td>
          <td style="display:flex;gap:5px;flex-wrap:wrap">
            ${fileLink(c.pdf, 'PDF', icoHTML('file', 12))}
            ${fileLink(c.excel, 'EXCEL', icoHTML('grid', 12))}
          </td>
          <td><button class="btn btn-ghost btn-xs" onclick="event.stopPropagation();openVerCotizacion('${c.id}')">Ver</button></td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="6"><div class="empty-state"><div>${icoHTML('file',26)}</div><div>SIN COTIZACIONES</div></div></td></tr>`;
}

// ── Modal de subida ─────────────────────
async function openSubirCotizacion(opId) {
  const [clientes, ops] = await Promise.all([db.clientes.list(), db.ops.list()]);
  const cSel = document.getElementById('cot-cliente');
  const oSel = document.getElementById('cot-op');
  if (cSel) cSel.innerHTML = clientes.map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('');

  // Si viene desde una OP, precargar cliente + OP
  let preCli = '';
  if (opId) { const o = ops.find(x => x.id === opId); preCli = o?.clienteId || ''; }
  if (cSel && preCli) cSel.value = preCli;
  await cotUpdateOP();
  if (oSel && opId) oSel.value = opId;

  ['cot-pdf', 'cot-excel'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  openM('cotizador');
}

async function cotUpdateOP() {
  const cliId = document.getElementById('cot-cliente')?.value;
  const opSel = document.getElementById('cot-op');
  if (!opSel) return;
  const ops = await db.ops.list();
  const filtered = cliId ? ops.filter(o => o.clienteId === cliId) : ops;
  opSel.innerHTML = '<option value="">— Sin OP —</option>' +
    filtered.map(o => `<option value="${o.id}">${esc(o.numero)} — ${esc(o.desc)}</option>`).join('');
}

async function cotSave() {
  const cliId = document.getElementById('cot-cliente')?.value;
  const opId  = document.getElementById('cot-op')?.value || '';
  const pdf   = document.getElementById('cot-pdf')?.files?.[0] || null;
  const excel = document.getElementById('cot-excel')?.files?.[0] || null;

  if (!cliId) { toast('Selecciona un cliente', 'red'); return; }
  if (!pdf && !excel) { toast('Sube al menos un archivo (PDF o Excel)', 'red'); return; }

  // Versión automática por OP/cliente
  const allCots = await db.cotizaciones.list();
  const prevVers = allCots.filter(c => c.opId === opId && c.clienteId === cliId).length;
  const version = 'V' + (prevVers + 1);

  const data = {
    cotId:     (opId ? opId.slice(-6) : 'COT') + '-' + version,
    opId,
    clienteId: cliId,
    version,
    fecha:     new Date().toISOString().split('T')[0],
    status:    'Enviada',
  };
  if (pdf)   data.pdf = pdf;
  if (excel) data.excel = excel;

  showSpinner();
  try {
    await db.cotizaciones.create(data);
    // Marcar la OP como "Cotización" si aplica
    if (opId) { try { await db.ops.update(opId, { status: 'Cotización' }); } catch (_) {} }
    closeM('cotizador');
    ['cot-pdf', 'cot-excel'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    toast('✓ Cotización guardada — ' + version);
    renderCotizaciones();
    if (typeof renderOPs === 'function') renderOPs();
  } catch (e) {
    toast('Error al guardar cotización: ' + e.message, 'red');
  } finally {
    hideSpinner();
  }
}

async function openVerCotizacion(id) {
  showSpinner();
  let c, clientes, ops;
  try {
    [c, clientes, ops] = await Promise.all([db.cotizaciones.get(id), db.clientes.list(), db.ops.list()]);
  } catch (e) {
    toast('Error al cargar cotización', 'red');
    return;
  } finally {
    hideSpinner();
  }

  STATE.selCot = id;
  const cli = clientes.find(x => x.id === c.clienteId) || {};
  const op  = ops.find(x => x.id === c.opId) || {};

  document.getElementById('vc-num').textContent   = (op.numero || c.cotId || 'COT') + ' · ' + String(c.status || '').toUpperCase();
  document.getElementById('vc-title').textContent = (cli.nombre || '—') + ' — ' + (op.desc || 'Cotización');

  const fileCard = (arr, label, icon) => {
    const f = (arr || [])[0];
    return `<div class="info-cell" style="display:flex;align-items:center;justify-content:space-between;gap:10px">
      <div><div class="info-cell-label">${label}</div><div class="info-cell-val" style="font-size:12px">${f ? esc(f.name) : '— No adjunto —'}</div></div>
      ${f && f.url
        ? `<a href="${esc(f.url)}" target="_blank" rel="noopener" class="btn btn-primary btn-sm" style="text-decoration:none">${icon} Descargar</a>`
        : ''}
    </div>`;
  };

  document.getElementById('vc-body').innerHTML = `
    <div class="info-grid" style="margin-bottom:14px">
      <div class="info-cell"><div class="info-cell-label">CLIENTE</div><div class="info-cell-val">${esc(cli.nombre) || '—'}</div></div>
      <div class="info-cell"><div class="info-cell-label">VERSIÓN / FECHA</div><div class="info-cell-val">${esc(c.version) || '—'} · ${esc(c.fecha) || '—'}</div></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      ${fileCard(c.pdf, 'ARCHIVO PDF', icoHTML('file', 13))}
      ${fileCard(c.excel, 'ARCHIVO EXCEL', icoHTML('grid', 13))}
    </div>`;

  openM('ver-cotizacion');
}

// Compat: entradas antiguas que abrían el cotizador desde una OP.
async function populateCotSelects() { /* obsoleto: openSubirCotizacion maneja los selects */ }
async function openCotForOP() {
  const id = STATE.selOP;
  closeM('detalle-op');
  setTimeout(() => openSubirCotizacion(id), 200);
}
