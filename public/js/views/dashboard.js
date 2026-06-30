// ══════════════════════════════════════
// DASHBOARD VIEW
// ══════════════════════════════════════
async function renderDashboard() {
  // Fecha de hoy en el header
  const hoy = new Date();
  const fechaLabel = hoy.toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).toUpperCase();
  const el = document.getElementById('dash-date');
  if (el) el.textContent = fechaLabel;

  showSpinner();
  let ops, pagos, prospectos, clientes, casos;
  try {
    [ops, pagos, prospectos, clientes, casos] = await Promise.all([
      db.ops.list(),
      db.pagos.list(),
      db.prospectos.list(),
      db.clientes.list(),
      db.casos.list(),
    ]);
  } catch (e) {
    toast('Error al cargar dashboard', 'red');
    return;
  } finally {
    hideSpinner();
  }

  const today  = hoy.toISOString().split('T')[0];
  const cliMap = Object.fromEntries(clientes.map(c => [c.id, c]));
  const opMap  = Object.fromEntries(ops.map(o => [o.id, o]));

  // ── Cargar objetivos del mes (solo admin los ve) ─
  const user = sesionActual();
  let obj = {};
  if (user?.role === 'admin') {
    try {
      const mes = `${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,'0')}`;
      const token = localStorage.getItem('crm_token');
      const r = await fetch(`/api/objetivos/${mes}`, { headers: { 'Authorization': 'Bearer ' + token } });
      if (r.ok) obj = await r.json();
    } catch {}
  }

  // ── KPIs ────────────────────────────────
  const opsActivas    = ops.filter(o => o.status === 'En Producción');
  const totalCotizado = opsActivas.reduce((a, o) => a + (o.cotizado || 0), 0);
  const pagosPend     = pagos.filter(p => p.status === 'Pendiente' || p.status === 'Vencido');
  const totalPend     = pagosPend.reduce((a, p) => a + (p.monto || 0), 0);
  const comisiones    = ops.filter(o => o.status === 'Ejecutado').reduce((a, o) => a + (o.utilidad || 0) * 0.075, 0);
  const pipeline      = prospectos.reduce((a, p) => a + (parseFloat(p.estimado) || 0), 0);
  const cliActivos    = clientes.filter(c => c.status === 'Activo').length;
  const pagosVencidos = pagos.filter(p => p.status === 'Vencido').length;

  function kpiBar(actual, meta) {
    if (!meta) return '';
    const p = Math.min(Math.round((actual / meta) * 100), 100);
    const color = p >= 100 ? 'var(--green)' : p >= 60 ? 'var(--amber)' : 'var(--red)';
    return `<div style="margin-top:6px">
      <div style="display:flex;justify-content:space-between;margin-bottom:2px">
        <span style="font-family:'JetBrains Mono',monospace;font-size:8px;color:var(--gray400)">META: ${typeof meta === 'number' && meta > 999 ? fmx(meta) : meta}</span>
        <span style="font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;color:${color}">${p}%</span>
      </div>
      <div class="prog"><div class="prog-fill" style="width:${p}%;background:${color}"></div></div>
    </div>`;
  }

  document.getElementById('dash-kpis').innerHTML = `
    <div class="kpi">
      <div class="kpi-label">OPs ACTIVAS</div>
      <div class="kpi-value kv-red">${opsActivas.length}</div>
      <div class="kpi-delta up">en producción</div>
      ${kpiBar(opsActivas.length, obj.opsActivas)}
    </div>
    <div class="kpi">
      <div class="kpi-label">COTIZADO ACTIVO</div>
      <div class="kpi-value">${fmx(totalCotizado)}</div>
      <div class="kpi-delta">MXN sin IVA</div>
      ${kpiBar(totalCotizado, obj.cotizado)}
    </div>
    <div class="kpi">
      <div class="kpi-label">COBROS PENDIENTES</div>
      <div class="kpi-value kv-red">${fmx(totalPend)}</div>
      <div class="kpi-delta ${pagosVencidos > 0 ? 'down' : ''}">${pagosVencidos > 0 ? '⚠ ' + pagosVencidos + ' VENCIDOS' : pagosPend.length + ' pagos'}</div>
      ${kpiBar(totalPend, obj.cobros)}
    </div>
    <div class="kpi">
      <div class="kpi-label">PIPELINE PROSPECTOS</div>
      <div class="kpi-value kv-green">${fmx(pipeline)}</div>
      <div class="kpi-delta up">${prospectos.length} prospectos</div>
      ${kpiBar(pipeline, obj.pipeline)}
    </div>
    <div class="kpi">
      <div class="kpi-label">CLIENTES ACTIVOS</div>
      <div class="kpi-value">${cliActivos}</div>
      <div class="kpi-delta">${clientes.length} en total</div>
      ${kpiBar(cliActivos, obj.cliActivos)}
    </div>
    <div class="kpi">
      <div class="kpi-label">COMISIONES LIBERABLES</div>
      <div class="kpi-value kv-green">${fmx(comisiones)}</div>
      <div class="kpi-delta up">OPs ejecutadas</div>
      ${kpiBar(comisiones, obj.comisiones)}
    </div>`;

  // ── OPs en producción ───────────────────
  const opsEl   = document.getElementById('dash-ops');
  const opsShow = opsActivas.slice(0, 3);
  if (!opsShow.length) {
    opsEl.innerHTML = '<div class="empty-state"><div>📋</div><div>SIN OPs EN PRODUCCIÓN</div></div>';
  } else {
    opsEl.innerHTML = opsShow.map(o => {
      const cli = cliMap[o.clienteId] || {};
      const p   = pct(o.cobrado, o.cotizado);
      return `<div class="op-card" onclick="openDetalleOP('${o.id}')">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px">
          <div><div class="op-num">${esc(o.numero)}</div><div class="op-name">${esc(o.desc)} · ${esc(cli.nombre) || '—'}</div></div>
          <div style="text-align:right">${pillHTML(o.status)}<div style="font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:700;margin-top:3px">${fmx(o.cotizado)}</div></div>
        </div>
        <div class="op-meta">
          <div class="op-meta-item">📅 ${esc(o.fechaEvento) || '—'}</div>
          <div class="op-meta-item">👤 ${esc(o.ejec) || '—'}</div>
          <div style="flex:1;margin-left:8px">
            <div style="display:flex;justify-content:space-between;margin-bottom:2px">
              <span style="font-family:'JetBrains Mono',monospace;font-size:8px;color:var(--gray400)">COBRADO</span>
              <span style="font-family:'JetBrains Mono',monospace;font-size:9px;color:${p>=100?'var(--green)':p>=50?'var(--amber)':'var(--red)'}">${p}%</span>
            </div>
            <div class="prog"><div class="prog-fill ${p>=100?'green':p>=50?'amber':'red'}" style="width:${Math.min(p,100)}%"></div></div>
          </div>
        </div>
      </div>`;
    }).join('');
  }

  // ── Cobros urgentes ─────────────────────
  const cobros   = pagos.filter(p => p.tipo === 'Cobro a cliente' && (p.status === 'Pendiente' || p.status === 'Vencido')).slice(0, 4);
  const badgeEl  = document.getElementById('dash-cobros-badge');
  const vencidos = cobros.filter(p => p.status === 'Vencido').length;
  if (badgeEl) badgeEl.textContent = vencidos > 0 ? vencidos + ' URGENTES' : 'AL DÍA';

  document.getElementById('dash-cobros').innerHTML = cobros.length
    ? cobros.map(p => {
        const op  = opMap[p.opId] || {};
        const cli = cliMap[op.clienteId] || {};
        return `<div class="pago-row" onclick="openDetallePago && openDetallePago('${p.id}')">
          <div class="pago-icon ${p.status==='Vencido'?'pi-venc':'pi-cobro'}">${p.status === 'Vencido' ? '⚠' : '$'}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;font-weight:500">${esc(p.concepto)}</div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--gray400)">${esc(op.numero) || '—'} · ${esc(cli.nombre) || '—'}</div>
          </div>
          <div style="text-align:right">
            <div style="font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:700;color:${p.status==='Vencido'?'var(--red)':'var(--green)'}">${fmx(p.monto)}</div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--gray400)">${p.status === 'Vencido' ? '⚠ VENCIDO' : (esc(p.fechaAcordada) || '—')}</div>
          </div>
        </div>`;
      }).join('')
    : `<div style="padding:12px 0;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--green);letter-spacing:.1em">✓ SIN COBROS PENDIENTES</div>`;

  // ── Prospectos calientes ─────────────────
  const prosp = prospectos.filter(p => p.status === 'Listo p/ cotizar' || p.status === 'En conversación').slice(0, 4);
  document.getElementById('dash-prospectos').innerHTML = prosp.length
    ? prosp.map(p => `
        <div class="seg-row" onclick="openDetalleProspecto('${p.id}')">
          <div class="seg-dot ${p.status === 'Listo p/ cotizar' ? 'green' : ''}"></div>
          <div style="flex:1;min-width:0">
            <div style="font-size:13px"><strong>${esc(p.empresa)}</strong> — ${esc(p.evento) || '—'}</div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--gray400)">${esc(p.ejec)} · ${fmx(p.estimado)} · ${pillHTML(p.status)}</div>
          </div>
        </div>`).join('')
    : `<div style="padding:12px 0;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--gray400);letter-spacing:.1em">SIN PROSPECTOS CALIENTES</div>`;

  // ── Seguimiento hoy ─────────────────────
  const seguHoy = prospectos.filter(p => p.seguimiento === today);
  document.getElementById('dash-seguimiento').innerHTML = seguHoy.length
    ? seguHoy.map(p => `
        <div class="seg-row" onclick="openDetalleProspecto('${p.id}')">
          <div class="seg-dot" style="background:var(--amber)"></div>
          <div>
            <div style="font-size:12.5px;font-weight:600">${esc(p.empresa)}</div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--gray400)">${esc(p.ejec)} · ${esc(p.contacto) || '—'} · ${esc(p.tel) || '—'}</div>
          </div>
        </div>`).join('')
    : `<div style="padding:12px 0;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--green);letter-spacing:.1em">✓ SIN SEGUIMIENTOS HOY</div>`;

  // ── Casos abiertos ──────────────────────
  const casosAbiertos = casos.filter(c => c.status === 'Abierto' || c.status === 'En proceso').slice(0, 4);
  const casosEl = document.getElementById('dash-casos-widget');
  if (casosEl) {
    casosEl.innerHTML = casosAbiertos.length
      ? casosAbiertos.map(c => `
          <div class="seg-row" onclick="openDetalleCaso('${c.id}')">
            <div class="seg-dot ${c.prio==='Alta'?'red':c.prio==='Media'?'amber':''}"></div>
            <div style="flex:1;min-width:0">
              <div style="font-size:12.5px">${esc(c.titulo)}</div>
              <div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--gray400)">${esc(c.quien) || '—'} · ${pillHTML(c.status)}</div>
            </div>
          </div>`).join('')
      : `<div style="padding:12px 0;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--green);letter-spacing:.1em">✓ SIN CASOS ABIERTOS</div>`;
  }
}
