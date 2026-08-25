// ══════════════════════════════════════
// PAGOS VIEW
// ══════════════════════════════════════
function setPagosTab(f, el) {
  STATE.pagosTab = f;
  document.querySelectorAll('#view-pagos .vtab').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');
  renderPagos();
}

// "Vencido" para una Deuda (Pago a proveedor) se calcula igual que en Pagos:
// pendiente + fecha acordada ya pasada = Vencido. Deudas solo guarda
// 'pendiente'/'pagado' en Notion — el resto (Vencido) es un estatus EFECTIVO
// calculado aquí, para que el filtro/columna de la tabla fusionada sea
// consistente entre Cobros y Pagos.
function _statusEfectivoDeuda(d) {
  if (d.status === 'pagado') return 'Pagado';
  const hoy = new Date().toISOString().split('T')[0];
  return (d.fechaAcordada && d.fechaAcordada < hoy) ? 'Vencido' : 'Pendiente';
}

// Un solo flujo de caja: Cobros (base Pagos, dinero que entra) + Pagos a
// proveedor (base Deudas, dinero que sale — ahí es donde se captura el IVA y
// de donde sale la Utilidad real de la OP, ver withUtilidadReal en
// api/ops.js). Los "Pago a proveedor" que hayan quedado en Pagos de ANTES de
// este cambio también se muestran (de solo lectura, sin proveedor ligado) —
// nada se borra; simplemente ya no se crean nuevos ahí, ver savePago().
function _movimientosUnificados(pagos, deudas, opMap, cliMap, provMap) {
  const deCobros = pagos.filter(p => p.tipo === 'Cobro a cliente').map(p => ({
    id: p.id, source: 'pagos', tipo: 'Cobro',
    concepto: p.concepto, monto: p.monto, status: p.status,
    fechaAcordada: p.fechaAcordada, fechaReal: p.fechaReal,
    opId: p.opId, provId: null,
    contraparte: cliMap[opMap[p.opId]?.clienteId]?.nombre || '',
    forma: p.forma, comprobante: p.comprobante,
  }));
  const dePagosLegado = pagos.filter(p => p.tipo === 'Pago a proveedor').map(p => ({
    id: p.id, source: 'pagos-legado', tipo: 'Pago',
    concepto: p.concepto, monto: p.monto, status: p.status,
    fechaAcordada: p.fechaAcordada, fechaReal: p.fechaReal,
    opId: p.opId, provId: null,
    contraparte: '(registro anterior sin proveedor ligado)',
    forma: p.forma, comprobante: p.comprobante,
  }));
  const dePagosDeudas = deudas.map(d => ({
    id: d.id, source: 'deudas', tipo: 'Pago',
    concepto: d.concepto, monto: efectivoDeuda(d), status: _statusEfectivoDeuda(d),
    fechaAcordada: d.fechaAcordada, fechaReal: d.status === 'pagado' ? d.fechaAcordada : '',
    opId: d.opId, provId: d.provId,
    contraparte: provMap[d.provId]?.nombre || '',
    forma: '', comprobante: false,
  }));
  return [...deCobros, ...dePagosLegado, ...dePagosDeudas]
    .sort((a, b) => (b.fechaAcordada || '').localeCompare(a.fechaAcordada || ''));
}

async function renderPagos() {
  showSpinner();
  let pagos, deudas, ops, clientes, provs;
  try {
    [pagos, deudas, ops, clientes, provs] = await Promise.all([
      db.pagos.list(),
      db.deudas.list().catch(() => []),
      db.ops.list(),
      db.clientes.list(),
      db.proveedores.list(),
    ]);
  } catch (e) {
    toast('Error al cargar pagos', 'red');
    return;
  } finally {
    hideSpinner();
  }

  const opMap   = Object.fromEntries(ops.map(o => [o.id, o]));
  const cliMap  = Object.fromEntries(clientes.map(c => [c.id, c]));
  const provMap = Object.fromEntries(provs.map(p => [p.id, p]));
  const movs = _movimientosUnificados(pagos, deudas, opMap, cliMap, provMap);

  const totalPorCobrar = movs.filter(m => m.tipo === 'Cobro' && m.status !== 'Pagado').reduce((a, m) => a + (m.monto||0), 0);
  const totalCobrado   = movs.filter(m => m.tipo === 'Cobro' && m.status === 'Pagado').reduce((a, m) => a + (m.monto||0), 0);
  const totalPorPagar  = movs.filter(m => m.tipo === 'Pago'  && m.status !== 'Pagado').reduce((a, m) => a + (m.monto||0), 0);
  const vencidos       = movs.filter(m => m.status === 'Vencido');
  const cobrosPagados  = movs.filter(m => m.tipo === 'Cobro' && m.status === 'Pagado');

  document.getElementById('pagos-kpis').innerHTML = `
    <div class="kpi" style="border-top:2px solid var(--green)"><div class="kpi-label">${icoHTML('wallet',13)} POR COBRAR (CLIENTES)</div><div class="kpi-value kv-green">${fmx(totalPorCobrar)}</div><div class="kpi-delta up">${movs.filter(m=>m.tipo==='Cobro'&&m.status!=='Pagado').length} pagos pendientes</div></div>
    <div class="kpi" style="border-top:2px solid #1A6B3C"><div class="kpi-label">${icoHTML('check',13)} YA COBRADO</div><div class="kpi-value" style="color:#1A6B3C">${fmx(totalCobrado)}</div><div class="kpi-delta">${cobrosPagados.length} cobros confirmados</div></div>
    <div class="kpi" style="border-top:2px solid var(--amber)"><div class="kpi-label">${icoHTML('send',13)} POR PAGAR (PROVEEDORES)</div><div class="kpi-value" style="color:var(--amber)">${fmx(totalPorPagar)}</div><div class="kpi-delta down">Salidas pendientes</div></div>
    <div class="kpi" style="border-top:2px solid var(--red)"><div class="kpi-label">⚠ VENCIDOS</div><div class="kpi-value kv-red">${vencidos.length}</div><div class="kpi-delta down">${fmx(vencidos.reduce((a,m)=>a+(m.monto||0),0))} en riesgo</div></div>`;

  let list = movs;
  const tab = STATE.pagosTab;
  if (tab === 'Cobro a cliente')       list = movs.filter(m => m.tipo === 'Cobro');
  else if (tab === 'Pago a proveedor') list = movs.filter(m => m.tipo === 'Pago');
  else if (tab === 'vencido')          list = movs.filter(m => m.status === 'Vencido');

  document.getElementById('pagos-tbody').innerHTML = list.length
    ? list.map(m => {
        const op = opMap[m.opId] || {};
        const isCobro = m.tipo === 'Cobro';
        const verHandler = m.source === 'deudas'
          ? (m.provId ? `openDetalleProveedor('${m.provId}')` : `void 0`)
          : `openDetallePago('${m.id}')`;
        return `<tr onclick="${verHandler}" style="background:${m.status==='Vencido'?'rgba(204,34,0,.03)':''}">
          <td>
            <div style="display:flex;align-items:center;gap:6px">
              <div style="width:8px;height:8px;border-radius:50%;background:${isCobro?'var(--green)':'var(--amber)'};flex-shrink:0"></div>
              <span class="tag ${isCobro?'tag-green':'tag-amber'}" style="font-size:9px">${isCobro?'COBRO ↓':'PAGO ↑'}</span>
            </div>
          </td>
          <td>
            <div style="font-size:13px;font-weight:500">${esc(m.concepto)}</div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--gray400)">${esc(m.forma) || '—'}</div>
          </td>
          <td>
            <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--red)">${esc(op.numero) || '—'}</div>
            <div style="font-size:11px;color:var(--gray400)">${esc(m.contraparte) || '—'}</div>
          </td>
          <td class="monto" style="color:${m.status==='Vencido'?'var(--red)':isCobro?'var(--green)':'var(--amber)'}">${fmx(m.monto)}</td>
          <td class="mono" style="color:${m.status==='Vencido'?'var(--red)':''}">
            ${esc(m.fechaAcordada) || '—'}
            ${m.status==='Vencido'?'<div style="font-family:\'JetBrains Mono\',monospace;font-size:8px;color:var(--red);font-weight:700;letter-spacing:.08em">VENCIDO</div>':''}
          </td>
          <td class="mono" style="color:var(--gray400)">${esc(m.fechaReal) || 'Pendiente'}</td>
          <td>${pillHTML(m.status)}</td>
          <td>${m.comprobante ? '<span class="tag tag-green" style="font-size:9px">PDF ✓</span>' : '<span style="color:var(--gray200);font-size:10px;font-family:\'JetBrains Mono\',monospace">Sin comprobante</span>'}</td>
          <td>
            ${m.status !== 'Pagado'
              ? (m.source === 'deudas'
                  ? `<button class="btn btn-primary btn-xs" onclick="event.stopPropagation();marcarDeudaPagada('${m.id}')">Marcar pagado</button>`
                  : `<button class="btn btn-primary btn-xs" onclick="event.stopPropagation();openDetallePago('${m.id}')">Registrar</button>`)
              : `<button class="btn btn-ghost btn-xs" onclick="event.stopPropagation();${verHandler}">Ver</button>`}
          </td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="9"><div class="empty-state"><div>${icoHTML('wallet',26)}</div><div>SIN MOVIMIENTOS EN ESTE FILTRO</div></div></td></tr>`;
}

async function savePago() {
  const tipo = document.getElementById('pg-tipo').value; // 'Cobro' | 'Pago'
  const concepto = document.getElementById('pg-concepto').value.trim();
  if (!concepto) { toast('El concepto es requerido', 'red'); return; }

  const monto  = parseFloat(document.getElementById('pg-monto').value) || 0;
  const opId   = document.getElementById('pg-op').value || null;
  const status = document.getElementById('pg-status').value;
  const provId = document.getElementById('pg-prov')?.value || '';

  // Un Pago (dinero que sale) SIEMPRE se liga a un proveedor — sin esto
  // quedaba huérfano, que es justo el problema que se está arreglando.
  if (tipo === 'Pago' && !provId) { toast('Selecciona a qué proveedor se le paga', 'red'); return; }

  showSpinner();
  try {
    if (tipo === 'Pago') {
      // Se guarda en Deudas, no en Pagos: es la única base que calcula
      // IVA/neto y alimenta la Utilidad real de la OP (withUtilidadReal en
      // api/ops.js). Un Pago a proveedor que no pase por ahí no contaría
      // para la Utilidad ni el Estado de Resultados.
      await db.deudas.create({
        provId, opId: opId || '', concepto,
        montoConIva:   monto,
        fechaAcordada: document.getElementById('pg-fecha').value || new Date().toISOString().split('T')[0],
        status:        status === 'Pagado' ? 'pagado' : 'pendiente',
      });
    } else {
      await db.pagos.create({
        tipo: 'Cobro a cliente', // valor interno fijo — ver api/ops.js/dashboard.js que filtran por este texto exacto
        concepto,
        opId:          opId || '',
        monto,
        fechaAcordada: document.getElementById('pg-fecha').value || new Date().toISOString().split('T')[0],
        fechaReal:     status === 'Pagado' ? new Date().toISOString().split('T')[0] : '',
        status,
        forma:         document.getElementById('pg-forma').value,
        ref:           document.getElementById('pg-ref').value,
        comprobante:   false,
      });
      // El "cobrado" de la OP ya no se actualiza aquí: el servidor lo calcula
      // siempre sumando los Pagos "Cobro a cliente" con status "Pagado"
      // (única fuente de verdad, ver withCobradoReal en api/ops.js).
    }

    closeM('nuevo-pago');
    ['pg-concepto','pg-monto','pg-fecha','pg-ref'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    toast(tipo === 'Pago' ? '✓ Pago a proveedor registrado' : '✓ Cobro registrado');
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

    // El "cobrado" de la OP se recalcula solo, en el servidor (ver arriba).

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
