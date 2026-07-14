// ══════════════════════════════════════
// OPs VIEW
// ══════════════════════════════════════
function setOPTab(f, el) {
  STATE.opTabFilter = f;
  document.querySelectorAll('#view-ops .vtab').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');
  renderOPs();
}

async function renderOPs() {
  showSpinner();
  let ops, clientes;
  try {
    [ops, clientes] = await Promise.all([db.ops.list(), db.clientes.list()]);
  } catch (e) {
    toast('Error al cargar OPs', 'red');
    return;
  } finally {
    hideSpinner();
  }

  const f = STATE.opTabFilter;
  const list = f === 'todas' ? ops : ops.filter(o => o.status === f);
  const cliMap = Object.fromEntries(clientes.map(c => [c.id, c]));

  const tbody = document.getElementById('ops-tbody');
  tbody.innerHTML = list.length
    ? list.map(o => {
        const cli = cliMap[o.clienteId] || {};
        const isExec = o.status === 'Ejecutado';
        const col = EJEC_COL[o.ejec] || 'var(--red)';
        return `<tr onclick="openDetalleOP('${o.id}')">
          <td class="mono" style="color:var(--red)">${esc(o.numero)}</td>
          <td><div style="font-weight:600;font-size:13px">${esc(o.desc)}</div><div style="font-size:11px;color:var(--gray400)">${esc(cli.nombre) || '—'}</div></td>
          <td>${pillHTML(o.status)}</td>
          <td class="mono">${esc(o.fechaEvento) || '—'}</td>
          <td><div style="display:flex;align-items:center;gap:6px">
            <div class="av" style="background:${col}18;border-color:${col}45;color:${col}">${esc((o.ejec||'?').slice(0,2).toUpperCase())}</div>
            <span style="font-size:12px">${esc(o.ejec) || '—'}</span>
          </div></td>
          <td class="monto">${fmx(o.cotizado)}</td>
          <td class="monto" style="color:${o.cobrado===o.cotizado?'var(--green)':o.cobrado>0?'var(--amber)':'var(--gray400)'}">${fmx(o.cobrado)}</td>
          <td class="monto" style="color:${o.utilidad>0?'var(--green)':'var(--gray400)'}">${o.utilidad ? fmx(o.utilidad) : '—'}</td>
          <td>${isExec ? '<span class="tag tag-green">LIBERADA ✓</span>' : '<span class="tag tag-amber">PENDIENTE</span>'}</td>
          <td style="display:flex;gap:5px">
            <button class="btn btn-ghost btn-xs" onclick="event.stopPropagation();openDetalleOP('${o.id}')">Ver</button>
            ${isExec ? `<button class="btn btn-primary btn-xs" onclick="event.stopPropagation();openEDR('${o.id}')">EdR</button>` : ''}
          </td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="10"><div class="empty-state"><div>${icoHTML('box',26)}</div><div>SIN RESULTADOS</div></div></td></tr>`;
}

async function saveOP() {
  const cliId = document.getElementById('op-cliente').value;
  const desc  = document.getElementById('op-desc').value.trim();
  if (!desc)  { toast('La descripción del evento es requerida', 'red'); return; }
  const esInterna = document.getElementById('op-interna')?.checked;
  if (!cliId && !esInterna) { toast('Selecciona un cliente', 'red'); return; }

  const ops = await db.ops.list();
  const numero = document.getElementById('op-num-prev').value || ('OP-' + uid().toUpperCase());
  const monto  = parseFloat(document.getElementById('op-monto').value) || 0;
  const status = document.getElementById('op-status').value;

  const data = {
    numero,
    desc,
    clienteId:  cliId,
    ejec:       document.getElementById('op-ejec').value,
    fechaEvento: document.getElementById('op-fecha').value || new Date().toISOString().split('T')[0],
    cotizado:   monto,
    cobrado:    0,
    utilidad:   0,
    status,
  };

  showSpinner();
  let newOP;
  try {
    newOP = await db.ops.create(data);
    closeM('nueva-op');
    ['op-desc','op-monto','op-fecha'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    renderOPs();
    updateBadges();
  } catch (e) {
    toast('Error al guardar OP: ' + e.message, 'red');
    return;
  } finally {
    hideSpinner();
  }

  if (!monto) {
    const doOpen = confirm(`OP creada: ${numero}\n\n⚠ No tiene monto cotizado todavía.\n\n¿Deseas abrir el cotizador ahora?`);
    if (doOpen) {
      setTimeout(async () => {
        await populateCotSelects();
        const cSel = document.getElementById('cot-cliente');
        if (cSel) cSel.value = cliId;
        await cotUpdateOP();
        setTimeout(() => { const opSel = document.getElementById('cot-op'); if (opSel && newOP) opSel.value = newOP.id; }, 100);
        STATE.cotEditor = { id: null, opId: newOP?.id || null, clienteId: cliId, ejec: 'Natalia Gama', secciones: { audio:[], esceno:[], logistica:[], catering:[], otros:[] }, fee: 15 };
        openM('cotizador');
        setTimeout(renderCotizador, 150);
      }, 200);
    }
  } else {
    toast('✓ OP creada: ' + numero);
  }
}

async function openDetalleOP(id) {
  showSpinner();
  let o, clientes, pagos;
  try {
    [o, clientes, pagos] = await Promise.all([db.ops.get(id), db.clientes.list(), db.pagos.list().catch(() => [])]);
  } catch (e) {
    toast('Error al cargar OP', 'red');
    return;
  } finally {
    hideSpinner();
  }

  STATE.selOP = id;
  const cliMap = Object.fromEntries(clientes.map(c => [c.id, c]));
  const cli = cliMap[o.clienteId] || {};

  document.getElementById('dop-num').textContent   = o.numero;
  document.getElementById('dop-title').textContent = o.desc + ' — ' + (cli.nombre || '—');

  document.getElementById('dop-info').innerHTML = `
    <div class="info-cell"><div class="info-cell-label">CLIENTE</div><div class="info-cell-val">${esc(cli.nombre) || '—'}</div><div style="font-size:11px;color:var(--gray400)">${esc(cli.contacto) || '—'}</div></div>
    <div class="info-cell"><div class="info-cell-label">FECHA EVENTO</div><div class="info-cell-val">${esc(o.fechaEvento) || '—'}</div><div style="font-size:11px;color:var(--gray400)">Ejecutivo: ${esc(o.ejec) || '—'}</div></div>`;

  document.getElementById('dop-montos').innerHTML = `
    <div class="info-cell" style="text-align:center"><div class="info-cell-label">COTIZADO</div><div style="font-family:'Bebas Neue',cursive;font-size:22px">${fmx(o.cotizado)}</div></div>
    <div class="info-cell" style="text-align:center;background:var(--green-dim);border:1px solid var(--green-bdr)"><div class="info-cell-label" style="color:var(--green)">COBRADO</div><div style="font-family:'Bebas Neue',cursive;font-size:22px;color:var(--green)">${fmx(o.cobrado)}</div></div>
    <div class="info-cell" style="text-align:center;background:var(--red-dim);border:1px solid var(--red-border)"><div class="info-cell-label" style="color:var(--red)">PENDIENTE</div><div style="font-family:'Bebas Neue',cursive;font-size:22px;color:var(--red)">${fmx(Math.max(0, (o.cotizado||0) - (o.cobrado||0)))}</div></div>`;

  const pagosOP = pagos.filter(pg => pg.opId === id && pg.tipo === 'Cobro a cliente');
  document.getElementById('dop-cobros').innerHTML = pagosOP.length
    ? pagosOP.map(pg => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">
          <div style="font-size:12.5px">${esc(pg.concepto)}</div>
          <div style="display:flex;align-items:center;gap:10px">
            <div style="font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:700">${fmx(pg.monto)}</div>
            ${pillHTML(pg.status)}
          </div>
        </div>`).join('')
    : `<div style="color:var(--gray400);font-size:12px">Sin pagos registrados. <span style="color:var(--red);cursor:pointer" onclick="closeM('detalle-op');openM('nuevo-pago')">Registrar pago →</span></div>`;

  const statuses = ['Cotización', 'En Producción', 'Ejecutado'];
  document.getElementById('dop-acciones').innerHTML =
    statuses.filter(s => s !== o.status).map(s => `<button class="btn btn-ghost btn-sm" onclick="changeOPStatus('${o.id}','${s}')">${s}</button>`).join('') +
    `<button class="btn btn-ghost btn-sm" onclick="closeM('detalle-op');openM('nuevo-pago')">+ Registrar pago</button>` +
    `<button class="btn btn-ghost btn-sm" onclick="openCotForOP()">+ Nueva cotización</button>`;

  openM('detalle-op');
}

async function changeOPStatus(id, status) {
  const o = await db.ops.get(id);
  const update = { status };
  if (status === 'Ejecutado' && !o.utilidad) {
    update.utilidad = Math.round((o.cotizado || 0) * 0.3);
  }
  showSpinner();
  try {
    await db.ops.update(id, update);
    closeM('detalle-op');
    renderOPs();
    updateBadges();
    toast('✓ OP actualizada: ' + status);
  } catch (e) {
    toast('Error al actualizar OP', 'red');
  } finally {
    hideSpinner();
  }
}

function openEdRForOP() {
  const id = STATE.selOP;
  closeM('detalle-op');
  setTimeout(() => openEDR(id), 200);
}

async function openEDR(id) {
  showSpinner();
  let o, clientes, deudas, proveedores;
  try {
    [o, clientes, deudas, proveedores] = await Promise.all([
      db.ops.get(id),
      db.clientes.list(),
      db.deudas.list().catch(() => []),
      db.proveedores.list(),
    ]);
  } catch (e) {
    toast('Error al cargar EdR', 'red');
    return;
  } finally {
    hideSpinner();
  }

  STATE.selOP = id;
  const cliMap = Object.fromEntries(clientes.map(c => [c.id, c]));
  const provMap = Object.fromEntries(proveedores.map(p => [p.id, p]));

  document.getElementById('edr-num').textContent   = o.numero + ' · ESTADO DE RESULTADOS';
  document.getElementById('edr-title').textContent = o.desc; // textContent — seguro sin escapar

  const margen = o.cotizado > 0 ? Math.round((o.utilidad || 0) / o.cotizado * 100) : 0;
  document.getElementById('edr-kpis').innerHTML = `
    <div class="info-cell" style="text-align:center"><div class="info-cell-label">INGRESOS TOTALES</div><div style="font-family:'Bebas Neue',cursive;font-size:26px">${fmx(o.cotizado)}</div></div>
    <div class="info-cell" style="text-align:center;background:var(--green-dim);border:1px solid var(--green-bdr)"><div class="info-cell-label" style="color:var(--green)">UTILIDAD BRUTA</div><div style="font-family:'Bebas Neue',cursive;font-size:26px;color:var(--green)">${fmx(o.utilidad)}</div></div>
    <div class="info-cell" style="text-align:center"><div class="info-cell-label">MARGEN</div><div style="font-family:'Bebas Neue',cursive;font-size:26px">${margen}%</div></div>`;

  const opDeudas = deudas.filter(d => d.opId === id);
  const tbody = document.getElementById('edr-tbody');
  tbody.innerHTML = opDeudas.length
    ? opDeudas.map(d => {
        const pv = provMap[d.provId] || {};
        const pagado = d.status === 'pagado' ? d.monto : 0;
        const debemos = d.status !== 'pagado' ? d.monto : 0;
        return `<tr>
          <td>${esc(pv.nombre) || '—'}<div style="font-size:10px;color:var(--gray400)">${esc(d.concepto)}</div></td>
          <td style="text-align:right" class="mono">${fmx(d.monto)}</td>
          <td style="text-align:right;color:var(--green)" class="mono">${fmx(pagado)}</td>
          <td style="text-align:right;color:${debemos ? 'var(--red)' : 'var(--gray400)'}" class="mono">${fmx(debemos)}</td>
          <td style="text-align:right" class="mono">—</td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="5" style="text-align:center;color:var(--gray400);padding:16px;font-size:12px">Sin costos de proveedores registrados.<br><span style="color:var(--red);cursor:pointer" onclick="closeM('edr');openM('nueva-deuda')">+ Registrar pago a proveedor →</span></td></tr>`;

  const costos = opDeudas.reduce((a, d) => a + (d.monto || 0), 0);
  document.getElementById('edr-bottom').innerHTML = `
    <div class="info-cell"><div class="info-cell-label">COMISIÓN EJECUTIVO (7.5%)</div><div style="font-family:'Bebas Neue',cursive;font-size:22px;color:var(--green)">${fmx((o.utilidad || 0) * 0.075)}</div><div style="font-size:11px;color:var(--gray400)">${esc(o.ejec)} · 7.5% de ${fmx(o.utilidad)}</div></div>
    <div class="info-cell"><div class="info-cell-label">COSTOS REGISTRADOS A PROVEEDORES</div><div style="font-family:'Bebas Neue',cursive;font-size:22px;color:var(--amber)">${fmx(costos)}</div><div style="font-size:11px;color:var(--gray400)">${opDeudas.length} proveedor(es)</div></div>`;

  openM('edr');
}

// ── OP Interna (gastos sin cliente) ──
function toggleOPInterna(checked) {
  const wrap    = document.getElementById('op-cliente-wrap');
  const titleEl = document.getElementById('nueva-op-title');
  const eyeEl   = document.getElementById('nueva-op-eye');
  const cliSel  = document.getElementById('op-cliente');

  if (wrap)    wrap.style.display  = checked ? 'none' : '';
  if (titleEl) titleEl.textContent = checked ? 'Nueva OP Interna' : 'Nueva OP';
  if (eyeEl)   eyeEl.textContent   = checked ? 'GASTO INTERNO' : 'CREAR ORDEN DE PRODUCCIÓN';

  if (cliSel) {
    if (checked) {
      // Insertar opción especial "Interno" si no existe
      let opt = cliSel.querySelector('option[value="__interno__"]');
      if (!opt) {
        opt = document.createElement('option');
        opt.value = '__interno__';
        opt.textContent = 'Interno / Gasto administrativo';
        cliSel.prepend(opt);
      }
      cliSel.value = '__interno__';
    } else {
      // Quitar opción interna y limpiar selección
      const opt = cliSel.querySelector('option[value="__interno__"]');
      if (opt) opt.remove();
      cliSel.value = '';
    }
  }
}

async function openCotForOP() {
  const id = STATE.selOP;
  closeM('detalle-op');
  setTimeout(async () => {
    const o = await db.ops.get(id);
    await populateCotSelects();
    STATE.cotEditor = { id: null, opId: id, clienteId: o.clienteId, ejec: o.ejec || 'Natalia Gama', secciones: { audio:[], esceno:[], logistica:[], catering:[], otros:[] }, fee: 15 };
    const cSel = document.getElementById('cot-cliente');
    if (cSel) cSel.value = o.clienteId;
    await cotUpdateOP();
    setTimeout(() => { const opSel = document.getElementById('cot-op'); if (opSel) opSel.value = id; }, 100);
    openM('cotizador');
    setTimeout(renderCotizador, 150);
  }, 200);
}
