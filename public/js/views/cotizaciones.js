// ══════════════════════════════════════
// COTIZACIONES VIEW + COTIZADOR
// ══════════════════════════════════════

// Local mutable state for the cotizador editor (mirrors STATE.cotEditor)
let _cotSections = { audio:[], esceno:[], logistica:[], catering:[], otros:[] };
let _cotFee = 15;

async function renderCotizaciones() {
  showSpinner();
  let cots, clientes, ops, tickets;
  try {
    [cots, clientes, ops, tickets] = await Promise.all([
      db.cotizaciones.list(),
      db.clientes.list(),
      db.ops.list(),
      db.tickets.list(),
    ]);
  } catch (e) {
    toast('Error al cargar cotizaciones', 'red');
    return;
  } finally {
    hideSpinner();
  }

  const cliMap = Object.fromEntries(clientes.map(c => [c.id, c]));
  const opMap  = Object.fromEntries(ops.map(o => [o.id, o]));

  // Tickets panel
  const tkPend = tickets.filter(t => t.status === 'Pendiente');
  document.getElementById('tickets-count').textContent = tkPend.length + ' PENDIENTES';
  document.getElementById('tickets-list').innerHTML = tickets.map(t => {
    const cot = cots.find(c => c.id === t.cotId) || {};
    const cli = cliMap[cot.clienteId] || {};
    return `<div style="display:flex;align-items:center;gap:12px;padding:11px 0;border-bottom:1px solid var(--border)">
      <div class="tag ${t.status==='Pendiente'?'tag-amber':'tag-green'}" style="white-space:nowrap">TKT-${t.id.slice(-4).toUpperCase()}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:500">${esc(t.tipo)} — ${esc(cli.nombre) || '—'}</div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--gray400)">Levantó: ${esc(t.quien)} · ${esc(t.fecha)} · ${esc(t.monto)}</div>
      </div>
      ${pillHTML(t.status)}
      <div style="display:flex;gap:5px">
        ${t.status==='Pendiente' ? `<button class="btn btn-green btn-xs" onclick="aprobarTicket('${t.id}')">Aprobar</button>` : ''}
        <button class="btn btn-ghost btn-xs" onclick="verTicket('${t.id}')">Ver</button>
      </div>
    </div>`;
  }).join('') || '<div style="padding:12px 0;color:var(--gray400);font-size:12px">Sin tickets activos</div>';

  // Table
  document.getElementById('cot-tbody').innerHTML = cots.map(c => {
    const cli = cliMap[c.clienteId] || {};
    const op  = opMap[c.opId] || {};
    const tks = tickets.filter(t => t.cotId === c.id);
    return `<tr onclick="openVerCotizacion('${c.id}')">
      <td class="mono" style="color:var(--red)">${esc(c.opId && op.numero ? op.numero + '-' + c.version : 'COT-' + c.id.slice(-4))}</td>
      <td><div style="font-weight:600">${esc(cli.nombre) || '—'} · ${esc(op.desc || c.clienteId) || '—'}</div></td>
      <td class="mono" style="text-align:center">${c.version}</td>
      <td class="monto">${fmx(c.totalConIva)}</td>
      <td class="mono">${c.fecha || '—'}</td>
      <td>${pillHTML(c.status)}</td>
      <td>${tks.length ? tks.map(t => `<span class="tag ${t.status==='Pendiente'?'tag-amber':'tag-green'}" style="margin-right:3px">TKT ⏳</span>`).join('') : '—'}</td>
      <td style="display:flex;gap:5px">
        <button class="btn btn-ghost btn-xs" onclick="event.stopPropagation();openVerCotizacion('${c.id}')">Ver</button>
        <button class="btn btn-ghost btn-xs" onclick="event.stopPropagation();openM('nuevo-caso')">Caso</button>
      </td>
    </tr>`;
  }).join('') || `<tr><td colspan="8"><div class="empty-state"><div>📝</div><div>SIN COTIZACIONES</div></div></td></tr>`;
}

// ── Cotizador populate selects ──────────
async function populateCotSelects() {
  const [clientes, ops] = await Promise.all([db.clientes.list(), db.ops.list()]);
  const cSel = document.getElementById('cot-cliente');
  if (cSel) cSel.innerHTML = clientes.map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('');
  await cotUpdateOP();
}

async function cotUpdateOP() {
  const cliId = document.getElementById('cot-cliente')?.value;
  const opSel = document.getElementById('cot-op');
  if (!opSel) return;
  const ops = await db.ops.list();
  const filtered = cliId ? ops.filter(o => o.clienteId === cliId) : ops;
  opSel.innerHTML = '<option value="">— Sin OP —</option>' + filtered.map(o => `<option value="${o.id}">${esc(o.numero)} — ${esc(o.desc)}</option>`).join('');
}

// ── Cotizador render ────────────────────
function renderCotizador() {
  const tbody = document.getElementById('cot-tbody-inner');
  if (!tbody) return null;
  tbody.innerHTML = '';
  let grand = 0;

  COT_SECS.forEach(sec => {
    const rows = _cotSections[sec.id] || [];
    tbody.innerHTML += `<tr class="cot-sec-hdr"><td colspan="9">${sec.label}<button onclick="cotAddRow('${sec.id}')" style="float:right;background:none;border:none;color:rgba(255,255,255,.35);cursor:pointer;font-size:11px;font-family:'JetBrains Mono',monospace">+ agregar</button></td></tr>`;
    let secTotal = 0;
    rows.forEach((r, i) => {
      const pv  = r.costo * (1 + r.util / 100);
      const imp = pv * r.qty * r.dias;
      secTotal += imp;
      const provOpts = PROVS.map(p => `<option${p === r.prov ? ' selected' : ''}>${esc(p)}</option>`).join('');
      tbody.innerHTML += `<tr>
        <td><input class="cot-inp" value="${esc(r.desc)}" onchange="_cotSections['${sec.id}'][${i}].desc=this.value" style="width:200px"></td>
        <td><input class="cot-inp" type="number" value="${r.qty}" onchange="_cotSections['${sec.id}'][${i}].qty=+this.value;renderCotizador()" style="width:48px;text-align:center"></td>
        <td><input class="cot-inp" type="number" value="${r.dias}" onchange="_cotSections['${sec.id}'][${i}].dias=+this.value;renderCotizador()" style="width:44px;text-align:center"></td>
        <td><input class="cot-inp" type="number" value="${r.costo}" onchange="_cotSections['${sec.id}'][${i}].costo=+this.value;renderCotizador()" style="width:90px"></td>
        <td style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--gray600)">${fmx(pv)}</td>
        <td><div style="display:flex;align-items:center;gap:3px"><input class="cot-inp" type="number" value="${r.util}" onchange="_cotSections['${sec.id}'][${i}].util=+this.value;renderCotizador()" style="width:44px;text-align:center"><span style="font-size:10px;color:var(--gray400)">%</span></div></td>
        <td style="font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700">${fmx(imp)}</td>
        <td><select class="cot-inp" onchange="_cotSections['${sec.id}'][${i}].prov=this.value" style="max-width:120px;font-size:9px">${provOpts}</select></td>
        <td><button onclick="_cotSections['${sec.id}'].splice(${i},1);renderCotizador()" style="border:none;background:none;cursor:pointer;color:var(--gray200);font-size:15px">×</button></td>
      </tr>`;
    });
    if (rows.length) {
      tbody.innerHTML += `<tr class="cot-sub"><td colspan="6" style="text-align:right;font-size:9px;color:var(--gray400)">SUBTOTAL ${sec.label}</td><td>${fmx(secTotal)}</td><td colspan="2"></td></tr>`;
    }
    grand += secTotal;
  });

  const fee   = grand * (_cotFee / 100);
  const tc    = grand + fee;
  const iva   = tc * 0.16;
  const total = tc + iva;

  const tf = document.getElementById('cot-tfoot');
  if (tf) tf.innerHTML = `
    <tr style="background:var(--cream)"><td colspan="6" style="padding:9px 10px;text-align:right;font-size:13px;color:var(--gray600);font-weight:500">SUBTOTAL SIN IVA</td><td style="padding:9px;font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:700">${fmx(grand)}</td><td colspan="3"></td></tr>
    <tr style="background:#FFF8F0;border-top:1px solid #F0DFC0"><td colspan="4" style="padding:9px 10px;text-align:right;font-size:13px;font-weight:600;color:var(--amber)">FEE DE AGENCIA</td><td colspan="2" style="padding:9px"><div style="display:flex;align-items:center;gap:5px;justify-content:flex-end"><input id="fee-agencia-inp" type="number" value="${_cotFee}" min="0" max="100" onchange="_cotFee=+this.value;renderCotizador()" style="width:52px;border:1px solid #F0DFC0;border-radius:4px;padding:3px 6px;font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:700;text-align:center"><span style="font-size:11px;color:var(--amber)">%</span></div></td><td style="padding:9px;font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:700;color:var(--amber)">${fmx(fee)}</td><td colspan="3"></td></tr>
    <tr style="background:var(--cream)"><td colspan="6" style="padding:9px 10px;text-align:right;font-size:13px;color:var(--gray600)">TOTAL</td><td style="padding:9px;font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:700">${fmx(tc)}</td><td colspan="3"></td></tr>
    <tr style="background:var(--gray50)"><td colspan="6" style="padding:9px 10px;text-align:right;font-size:13px;color:var(--gray600)">16% IVA</td><td style="padding:9px;font-family:'JetBrains Mono',monospace;font-size:13px">${fmx(iva)}</td><td colspan="3"></td></tr>
    <tr style="background:var(--black)"><td colspan="6" style="padding:12px 14px;text-align:right;font-family:'Bebas Neue',cursive;font-size:20px;color:var(--white);letter-spacing:.07em">TOTAL CON IVA</td><td style="padding:12px;font-family:'Bebas Neue',cursive;font-size:24px;color:var(--red)">${fmx(total)}</td><td colspan="3"></td></tr>`;

  return { grand, fee, tc, iva, total };
}

function cotAddRow(secId) {
  (_cotSections[secId || 'otros']).push({ desc: 'Nuevo concepto', qty: 1, dias: 1, costo: 0, util: 20, prov: 'Otro / Sin asignar' });
  renderCotizador();
}

async function cotSave() {
  const vals = renderCotizador();
  if (!vals) return;

  const cliId = document.getElementById('cot-cliente')?.value;
  const opId  = document.getElementById('cot-op')?.value || null;
  const ejec  = document.getElementById('cot-ejec')?.value || 'Natalia Gama';
  if (!cliId) { toast('Selecciona un cliente', 'red'); return; }

  // Calculate version
  const allCots = await db.cotizaciones.list();
  const prevVers = allCots.filter(c => c.opId === opId && c.clienteId === cliId).length;
  const version  = 'V' + (prevVers + 1);

  const data = {
    idCot:       (opId ? opId.slice(-6) : 'COT') + '-' + version,
    opId:        opId || '',
    clienteId:   cliId,
    version,
    fecha:       new Date().toISOString().split('T')[0],
    status:      'Enviada',
    subtotal:    Math.round(vals.grand),
    feePct:      _cotFee,
    iva:         Math.round(vals.iva),
    totalConIva: Math.round(vals.total),
    ejec,
    secciones:   JSON.parse(JSON.stringify(_cotSections)),
  };

  showSpinner();
  try {
    await db.cotizaciones.create(data);

    // Update OP.cotizado = subtotal + fee (sin IVA)
    if (opId) {
      await db.ops.update(opId, { cotizado: Math.round(vals.tc), status: 'Cotización' });
    }

    closeM('cotizador');
    // Reset cotizador state
    _cotSections = { audio:[], esceno:[], logistica:[], catering:[], otros:[] };
    _cotFee = 15;

    toast('✓ Cotización guardada — ' + version + ' · Subtotal+Fee: ' + fmx(vals.tc) + ' · c/IVA: ' + fmx(vals.total));
    renderCotizaciones();
    renderOPs();
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
  const cliMap = Object.fromEntries(clientes.map(x => [x.id, x]));
  const opMap  = Object.fromEntries(ops.map(x => [x.id, x]));
  const cli = cliMap[c.clienteId] || {};
  const op  = opMap[c.opId] || {};

  document.getElementById('vc-num').textContent   = (op.numero ? op.numero + '-' : 'COT-') + c.version + ' · ' + c.status.toUpperCase();
  document.getElementById('vc-title').textContent = (cli.nombre || '—') + ' — ' + (op.desc || 'Cotización');

  let html = `<div class="info-grid" style="margin-bottom:14px">
    <div class="info-cell"><div class="info-cell-label">CLIENTE</div><div class="info-cell-val">${esc(cli.nombre) || '—'}</div></div>
    <div class="info-cell"><div class="info-cell-label">VERSIÓN / FECHA</div><div class="info-cell-val">${esc(c.version)} · ${esc(c.fecha)}</div></div>
  </div>`;

  COT_SECS.forEach(sec => {
    const rows = (c.secciones && c.secciones[sec.id]) || [];
    if (!rows.length) return;
    html += `<div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--gray400);letter-spacing:.14em;margin-bottom:6px">${sec.label}</div>`;
    html += `<table class="tbl" style="margin-bottom:12px"><thead><tr><th>DESCRIPCIÓN</th><th>CANT.</th><th>DÍAS</th><th>PRECIO VENTA</th><th style="text-align:right">IMPORTE</th><th>PROVEEDOR</th></tr></thead><tbody>`;
    rows.forEach(r => {
      const pv  = r.costo * (1 + r.util / 100);
      const imp = pv * r.qty * r.dias;
      html += `<tr><td>${esc(r.desc)}</td><td class="mono" style="text-align:center">${esc(r.qty)}</td><td class="mono" style="text-align:center">${esc(r.dias)}</td><td class="mono">${fmx(pv)}</td><td class="mono" style="text-align:right;font-weight:700">${fmx(imp)}</td><td style="font-size:11px;color:var(--gray400)">${esc(r.prov)}</td></tr>`;
    });
    html += `</tbody></table>`;
  });

  const feeAmt = (c.subtotal || 0) * (c.feePct || 0) / 100;
  html += `<div style="background:var(--cream);border-radius:8px;padding:14px;margin-top:4px">
    <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border)"><span style="font-size:13px">Subtotal sin IVA</span><span style="font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:700">${fmx(c.subtotal)}</span></div>
    <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border)"><span style="font-size:13px;color:var(--amber);font-weight:500">Fee de Agencia (${c.feePct}%)</span><span style="font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:700;color:var(--amber)">${fmx(feeAmt)}</span></div>
    <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border)"><span style="font-size:13px">IVA 16%</span><span style="font-family:'JetBrains Mono',monospace;font-size:13px">${fmx(c.iva)}</span></div>
    <div style="display:flex;justify-content:space-between;padding:10px 12px;background:var(--black);border-radius:6px;margin-top:8px"><span style="font-family:'Bebas Neue',cursive;font-size:20px;color:var(--white);letter-spacing:.07em">TOTAL CON IVA</span><span style="font-family:'Bebas Neue',cursive;font-size:24px;color:var(--red)">${fmx(c.totalConIva)}</span></div>
  </div>`;

  document.getElementById('vc-body').innerHTML = html;
  openM('ver-cotizacion');
}

async function crearNuevaVersionCot() {
  const c = await db.cotizaciones.get(STATE.selCot);
  _cotSections = JSON.parse(JSON.stringify(c.secciones || { audio:[], esceno:[], logistica:[], catering:[], otros:[] }));
  _cotFee = c.feePct || 15;
  closeM('ver-cotizacion');
  setTimeout(async () => {
    await populateCotSelects();
    const cSel = document.getElementById('cot-cliente');
    if (cSel) cSel.value = c.clienteId;
    await cotUpdateOP();
    setTimeout(() => { const opSel = document.getElementById('cot-op'); if (opSel && c.opId) opSel.value = c.opId; }, 100);
    openM('cotizador');
    setTimeout(renderCotizador, 150);
  }, 200);
}

// ── Tickets ─────────────────────────────
async function saveTicket() {
  const cotId  = document.getElementById('tk-cot')?.value;
  const tipo   = document.getElementById('tk-tipo')?.value;
  const monto  = document.getElementById('tk-monto')?.value;
  const quien  = document.getElementById('tk-quien')?.value;
  const motivo = document.getElementById('tk-motivo')?.value?.trim();
  if (!motivo) { toast('El motivo es requerido', 'red'); return; }

  const data = {
    tipo,
    cotId: cotId || '',
    monto: monto || 'Por definir',
    quien,
    motivo,
    status: 'Pendiente',
    fecha:  new Date().toISOString().split('T')[0],
  };

  showSpinner();
  try {
    await db.tickets.create(data);
    closeM('nuevo-ticket');
    ['tk-monto','tk-motivo'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    toast('✓ Ticket levantado');
    renderCotizaciones();
  } catch (e) {
    toast('Error al guardar ticket: ' + e.message, 'red');
  } finally {
    hideSpinner();
  }
}

async function aprobarTicket(id) {
  showSpinner();
  try {
    await db.tickets.update(id, { status: 'Aprobado' });
    toast('✓ Ticket aprobado');
    renderCotizaciones();
  } catch (e) {
    toast('Error al aprobar', 'red');
  } finally {
    hideSpinner();
  }
}

async function verTicket(id) {
  const tickets = await db.tickets.list();
  const t = tickets.find(x => x.id === id);
  if (!t) return;
  const cots = await db.cotizaciones.list();
  const cot = cots.find(c => c.id === t.cotId) || {};
  const clientes = await db.clientes.list();
  const cli = clientes.find(c => c.id === cot.clienteId) || {};
  alert(`TICKET ${t.id.slice(-4).toUpperCase()}\n\nCotización: ${cli.nombre || '—'}\nTipo: ${t.tipo}\nMonto: ${t.monto}\nLevantó: ${t.quien}\nFecha: ${t.fecha}\nEstatus: ${t.status}\n\nMotivo:\n${t.motivo}`);
}

// ── Guardar cotización como Borrador (sin cambiar status de OP) ──
async function cotSaveAsDraft() {
  const vals = renderCotizador();
  if (!vals) return;

  const cliId = document.getElementById('cot-cliente')?.value;
  const opId  = document.getElementById('cot-op')?.value || null;
  const ejec  = document.getElementById('cot-ejec')?.value || 'Natalia Gama';
  if (!cliId) { toast('Selecciona un cliente', 'red'); return; }

  const allCots = await db.cotizaciones.list();
  const prevVers = allCots.filter(c => c.opId === opId && c.clienteId === cliId).length;
  const version  = 'V' + (prevVers + 1);

  const data = {
    idCot:       (opId ? opId.slice(-6) : 'COT') + '-' + version + '-BORR',
    opId:        opId || '',
    clienteId:   cliId,
    version:     version + ' (Borrador)',
    fecha:       new Date().toISOString().split('T')[0],
    status:      'Borrador',
    subtotal:    Math.round(vals.grand),
    feePct:      _cotFee,
    iva:         Math.round(vals.iva),
    totalConIva: Math.round(vals.total),
    ejec,
    secciones:   JSON.parse(JSON.stringify(_cotSections)),
  };

  showSpinner();
  try {
    await db.cotizaciones.create(data);
    closeM('cotizador');
    _cotSections = { audio:[], esceno:[], logistica:[], catering:[], otros:[] };
    _cotFee = 15;
    toast('✓ Borrador guardado');
    renderCotizaciones();
  } catch (e) {
    toast('Error al guardar borrador: ' + e.message, 'red');
  } finally {
    hideSpinner();
  }
}

// ── Exportar Estado de Resultados como PDF ──
async function exportEDR() {
  const opId = STATE.selOP;
  if (!opId) return;

  const ops      = await db.ops.list();
  const clientes = await db.clientes.list();
  const deudas   = await db.deudas.list();
  const pagos    = await db.pagos.list();
  const o    = ops.find(x => x.id === opId) || {};
  const cli  = clientes.find(x => x.id === o.clienteId) || {};
  const opDeudas = deudas.filter(d => d.opId === opId);
  const opPagos  = pagos.filter(p => p.opId === opId);

  const pagado  = opPagos.reduce((a, p) => a + (p.monto || 0), 0);
  const costos  = opDeudas.reduce((a, d) => a + (d.monto || 0), 0);
  const utilidad = (o.cotizado || 0) - costos;

  const filas = opDeudas.map(d => `
    <tr>
      <td>${esc(d.proveedor || '—')}</td>
      <td>${esc(d.concepto || '—')}</td>
      <td style="text-align:right">$${Math.round(d.monto || 0).toLocaleString('es-MX')}</td>
      <td style="text-align:right">${d.status === 'Pagado' ? '✓ Pagado' : (d.status || 'Pendiente')}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html><html lang="es"><head>
    <meta charset="UTF-8">
    <title>EDR ${esc(o.numero)} — ${esc(cli.nombre)}</title>
    <style>
      body { font-family: Arial, sans-serif; font-size: 12px; color: #333; margin: 32px; }
      h1 { font-size: 20px; margin: 0 0 4px; } h2 { font-size: 13px; color: #666; margin: 0 0 24px; }
      table { width: 100%; border-collapse: collapse; margin-top: 16px; }
      th { background: #f4f4f0; text-align: left; padding: 8px 10px; font-size: 11px; letter-spacing: .08em; }
      td { padding: 7px 10px; border-bottom: 1px solid #e5e5e5; }
      .total { font-size: 15px; font-weight: 700; }
      .green { color: #1a6b3c; } .red { color: #CC2200; }
    </style>
  </head><body>
    <h1>${esc(o.numero)} · Estado de Resultados</h1>
    <h2>${esc(cli.nombre || 'OP Interna')} — ${esc(o.desc)}</h2>
    <table>
      <tr><th>CONCEPTO</th><th style="text-align:right">MONTO</th></tr>
      <tr><td>Valor cotizado (sin IVA)</td><td style="text-align:right">$${Math.round(o.cotizado||0).toLocaleString('es-MX')}</td></tr>
      <tr><td>Cobrado al cliente</td><td style="text-align:right" class="green">$${Math.round(pagado).toLocaleString('es-MX')}</td></tr>
      <tr><td>Costos a proveedores</td><td style="text-align:right" class="red">$${Math.round(costos).toLocaleString('es-MX')}</td></tr>
      <tr><td class="total">Utilidad bruta</td><td style="text-align:right" class="total ${utilidad>=0?'green':'red'}">$${Math.round(utilidad).toLocaleString('es-MX')}</td></tr>
    </table>
    ${opDeudas.length ? `<table style="margin-top:24px">
      <tr><th>PROVEEDOR</th><th>CONCEPTO</th><th style="text-align:right">MONTO</th><th style="text-align:right">ESTATUS</th></tr>
      ${filas}
    </table>` : ''}
    <p style="margin-top:32px;font-size:10px;color:#999">Generado el ${new Date().toLocaleString('es-MX')} · Actidea Continnuo</p>
  </body></html>`;

  const win = window.open('', '_blank');
  win.document.write(html);
  win.document.close();
  setTimeout(() => win.print(), 400);
}
