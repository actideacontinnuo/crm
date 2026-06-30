// ══════════════════════════════════════
// PAGOS VIEW
// ══════════════════════════════════════
function setPagosTab(f, el) {
  STATE.pagosTab = f;
  document.querySelectorAll('#view-pagos .vtab').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');
  renderPagos();
}

async function renderPagos() {
  showSpinner();
  let pagos, ops, clientes;
  try {
    [pagos, ops, clientes] = await Promise.all([
      db.pagos.list(),
      db.ops.list(),
      db.clientes.list(),
    ]);
  } catch (e) {
    toast('Error al cargar pagos', 'red');
    return;
  } finally {
    hideSpinner();
  }

  const opMap  = Object.fromEntries(ops.map(o => [o.id, o]));
  const cliMap = Object.fromEntries(clientes.map(c => [c.id, c]));

  const totalPorCobrar = pagos.filter(p => p.tipo === 'Cobro a cliente' && p.status !== 'Pagado').reduce((a, p) => a + (p.monto||0), 0);
  const totalCobrado   = pagos.filter(p => p.tipo === 'Cobro a cliente' && p.status === 'Pagado').reduce((a, p) => a + (p.monto||0), 0);
  const totalPorPagar  = pagos.filter(p => p.tipo === 'Pago a proveedor' && p.status !== 'Pagado').reduce((a, p) => a + (p.monto||0), 0);
  const vencidos       = pagos.filter(p => p.status === 'Vencido');
  const cobrosPagados  = pagos.filter(p => p.tipo === 'Cobro a cliente' && p.status === 'Pagado');

  document.getElementById('pagos-kpis').innerHTML = `
    <div class="kpi" style="border-top:2px solid var(--green)"><div class="kpi-label">💰 POR COBRAR (CLIENTES)</div><div class="kpi-value kv-green">${fmx(totalPorCobrar)}</div><div class="kpi-delta up">${pagos.filter(p=>p.tipo==='Cobro a cliente'&&p.status!=='Pagado').length} pagos pendientes</div></div>
    <div class="kpi" style="border-top:2px solid #1A6B3C"><div class="kpi-label">✅ YA COBRADO</div><div class="kpi-value" style="color:#1A6B3C">${fmx(totalCobrado)}</div><div class="kpi-delta">${cobrosPagados.length} cobros confirmados</div></div>
    <div class="kpi" style="border-top:2px solid var(--amber)"><div class="kpi-label">📤 POR PAGAR (PROVEEDORES)</div><div class="kpi-value" style="color:var(--amber)">${fmx(totalPorPagar)}</div><div class="kpi-delta down">Salidas pendientes</div></div>
    <div class="kpi" style="border-top:2px solid var(--red)"><div class="kpi-label">⚠ VENCIDOS</div><div class="kpi-value kv-red">${vencidos.length}</div><div class="kpi-delta down">${fmx(vencidos.reduce((a,p)=>a+(p.monto||0),0))} en riesgo</div></div>`;

  let list = pagos;
  const tab = STATE.pagosTab;
  if (tab === 'Cobro a cliente')    list = pagos.filter(p => p.tipo === 'Cobro a cliente');
  else if (tab === 'Pago a proveedor') list = pagos.filter(p => p.tipo === 'Pago a proveedor');
  else if (tab === 'vencido')       list = pagos.filter(p => p.status === 'Vencido');

  document.getElementById('pagos-tbody').innerHTML = list.length
    ? list.map(p => {
        const op  = opMap[p.opId] || {};
        const cli = cliMap[op.clienteId] || {};
        const isCobro = p.tipo === 'Cobro a cliente';
        return `<tr onclick="openDetallePago('${p.id}')" style="background:${p.status==='Vencido'?'rgba(204,34,0,.03)':''}">
          <td>
            <div style="display:flex;align-items:center;gap:6px">
              <div style="width:8px;height:8px;border-radius:50%;background:${isCobro?'var(--green)':'var(--amber)'};flex-shrink:0"></div>
              <span class="tag ${isCobro?'tag-green':'tag-amber'}" style="font-size:9px">${isCobro?'COBRO ↓':'PAGO ↑'}</span>
            </div>
          </td>
          <td>
            <div style="font-size:13px;font-weight:500">${esc(p.concepto)}</div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--gray400)">${esc(p.forma) || '—'}</div>
          </td>
          <td>
            <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--red)">${esc(op.numero) || '—'}</div>
            <div style="font-size:11px;color:var(--gray400)">${esc(cli.nombre) || '—'}</div>
          </td>
          <td class="monto" style="color:${p.status==='Vencido'?'var(--red)':isCobro?'var(--green)':'var(--amber)'}">${fmx(p.monto)}</td>
          <td class="mono" style="color:${p.status==='Vencido'?'var(--red)':''}">
            ${esc(p.fechaAcordada) || '—'}
            ${p.status==='Vencido'?'<div style="font-family:\'JetBrains Mono\',monospace;font-size:8px;color:var(--red);font-weight:700;letter-spacing:.08em">VENCIDO</div>':''}
          </td>
          <td class="mono" style="color:var(--gray400)">${esc(p.fechaReal) || 'Pendiente'}</td>
          <td>${pillHTML(p.status)}</td>
          <td>${p.comprobante ? '<span class="tag tag-green" style="font-size:9px">PDF ✓</span>' : '<span style="color:var(--gray200);font-size:10px;font-family:\'JetBrains Mono\',monospace">Sin comprobante</span>'}</td>
          <td>
            ${p.status !== 'Pagado'
              ? `<button class="btn btn-primary btn-xs" onclick="event.stopPropagation();openDetallePago('${p.id}')">Registrar</button>`
              : `<button class="btn btn-ghost btn-xs" onclick="event.stopPropagation();openDetallePago('${p.id}')">Ver</button>`}
          </td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="9"><div class="empty-state"><div>💳</div><div>SIN MOVIMIENTOS EN ESTE FILTRO</div></div></td></tr>`;
}

async function savePago() {
  const concepto = document.getElementById('pg-concepto').value.trim();
  if (!concepto) { toast('El concepto es requerido', 'red'); return; }

  const monto  = parseFloat(document.getElementById('pg-monto').value) || 0;
  const opId   = document.getElementById('pg-op').value || null;
  const status = document.getElementById('pg-status').value;

  const data = {
    tipo:          document.getElementById('pg-tipo').value,
    concepto,
    opId:          opId || '',
    monto,
    fechaAcordada: document.getElementById('pg-fecha').value || new Date().toISOString().split('T')[0],
    fechaReal:     status === 'Pagado' ? new Date().toISOString().split('T')[0] : '',
    status,
    forma:         document.getElementById('pg-forma').value,
    ref:           document.getElementById('pg-ref').value,
    comprobante:   false,
  };

  showSpinner();
  try {
    await db.pagos.create(data);

    // If paid cobro, update OP.cobrado
    if (opId && status === 'Pagado' && data.tipo === 'Cobro a cliente') {
      const op = await db.ops.get(opId);
      await db.ops.update(opId, { cobrado: (op.cobrado || 0) + monto });
    }

    closeM('nuevo-pago');
    ['pg-concepto','pg-monto','pg-fecha','pg-ref'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    toast('✓ Pago registrado');
    renderPagos();
    updateBadges();
  } catch (e) {
    toast('Error al guardar: ' + e.message, 'red');
  } finally {
    hideSpinner();
  }
}

async function openDetallePago(id) {
  showSpinner();
  let p, ops, clientes;
  try {
    const pagos = await db.pagos.list();
    p = pagos.find(x => x.id === id);
    if (!p) throw new Error('Pago no encontrado');
    [ops, clientes] = await Promise.all([db.ops.list(), db.clientes.list()]);
  } catch (e) {
    toast('Error al cargar pago', 'red');
    return;
  } finally {
    hideSpinner();
  }

  STATE.selPago = id;
  const opMap  = Object.fromEntries(ops.map(o => [o.id, o]));
  const cliMap = Object.fromEntries(clientes.map(c => [c.id, c]));
  const op  = opMap[p.opId]  || {};
  const cli = cliMap[op.clienteId] || {};

  document.getElementById('dpg-tipo').textContent     = p.tipo.toUpperCase();
  document.getElementById('dpg-concepto').textContent = p.concepto;

  document.getElementById('dpg-kpis').innerHTML = `
    <div class="info-cell" style="text-align:center;${p.status==='Vencido'?'background:var(--red-dim);border:1px solid var(--red-border)':''}">
      <div class="info-cell-label" style="${p.status==='Vencido'?'color:var(--red)':''}">MONTO</div>
      <div style="font-family:'Bebas Neue',cursive;font-size:24px;color:${p.status==='Vencido'?'var(--red)':''}">${fmx(p.monto)}</div>
    </div>
    <div class="info-cell" style="text-align:center">
      <div class="info-cell-label">FECHA ACORDADA</div>
      <div style="font-size:14px;font-weight:600;color:${p.status==='Vencido'?'var(--red)':''}">${esc(p.fechaAcordada)}</div>
    </div>
    <div class="info-cell" style="text-align:center">${pillHTML(p.status)}</div>`;

  document.getElementById('dpg-info').innerHTML = `
    <div class="info-cell"><div class="info-cell-label">OP</div><div class="info-cell-val" style="font-family:'JetBrains Mono',monospace;font-size:12px">${esc(op.numero) || '—'}</div></div>
    <div class="info-cell"><div class="info-cell-label">CLIENTE</div><div class="info-cell-val">${esc(cli.nombre) || '—'}</div></div>
    <div class="info-cell"><div class="info-cell-label">FORMA DE PAGO</div><div class="info-cell-val">${esc(p.forma) || '—'}</div></div>
    <div class="info-cell"><div class="info-cell-label">REFERENCIA</div><div class="info-cell-val" style="font-family:'JetBrains Mono',monospace;font-size:11px">${esc(p.ref) || '—'}</div></div>`;

  const btn = document.getElementById('dpg-btn');
  if (p.status === 'Pagado') {
    btn.textContent = 'Ya pagado ✓'; btn.disabled = true; btn.style.opacity = '0.5';
  } else {
    btn.textContent = 'Confirmar Pago Recibido'; btn.disabled = false; btn.style.opacity = '1';
  }

  openM('detalle-pago');
}

async function marcarPagado() {
  const id = STATE.selPago;
  if (!id) return;

  const pagos = await db.pagos.list();
  const p = pagos.find(x => x.id === id);
  if (!p) return;

  showSpinner();
  try {
    await db.pagos.update(id, {
      status:    'Pagado',
      fechaReal: new Date().toISOString().split('T')[0],
      comprobante: true,
    });

    // Update OP.cobrado if cobro a cliente
    if (p.opId && p.tipo === 'Cobro a cliente') {
      const op = await db.ops.get(p.opId);
      await db.ops.update(p.opId, { cobrado: (op.cobrado || 0) + (p.monto || 0) });
    }

    closeM('detalle-pago');
    toast('✓ Pago confirmado');
    renderPagos();
    updateBadges();
  } catch (e) {
    toast('Error al marcar pago', 'red');
  } finally {
    hideSpinner();
  }
}
