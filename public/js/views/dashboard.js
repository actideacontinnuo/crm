// ══════════════════════════════════════
// DASHBOARD VIEW — réplica exacta del diseño de referencia
// (Copia de Actidea CRM offline), alimentada con datos reales de Notion.
// ══════════════════════════════════════

// ── Helpers compartidos del diseño de referencia ──
function fmxK(n) {
  n = n || 0;
  if (n >= 1000000) return '$' + (n / 1000000).toFixed(n >= 1e7 ? 1 : 2) + 'M';
  if (n >= 1000) return '$' + Math.round(n / 1000) + 'K';
  return '$' + Math.round(n);
}

const AC_ECOL_PALETA = ['#CC2200', '#1A6B3C', '#A0620A', '#0055AA', '#5C5650'];
function ejecColor(name) {
  if (typeof EJEC_COL !== 'undefined' && EJEC_COL[name]) return EJEC_COL[name];
  if (!window._acEcol) window._acEcol = {};
  if (!window._acEcol[name]) {
    const usados = Object.keys(window._acEcol).length;
    window._acEcol[name] = AC_ECOL_PALETA[usados % AC_ECOL_PALETA.length];
  }
  return window._acEcol[name];
}

function acInitials(n) { return (n || '?').split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase(); }

function avatarHTML(name, size) {
  const c = ejecColor(name); const s = size || 30;
  return `<div class="av" style="width:${s}px;height:${s}px;font-size:${Math.round(s * 0.3)}px;background:${c}1a;border-color:${c}44;color:${c}">${acInitials(name)}</div>`;
}

// icoHTML es global (definido en app.js)

function phHTML(eye, title, sub, actions) {
  return `<div class="ph"><div><div class="ph-eye">${eye}</div><div class="ph-title">${title}</div>${sub ? `<div class="ph-sub">${sub}</div>` : ''}</div><div class="ph-actions">${actions || ''}</div></div>`;
}

if (!window._acCharts) window._acCharts = {};

// ── Periodo del dashboard: mes | tri | anual ──
window._dashPeriodo = window._dashPeriodo || 'mes';
function setDashPeriodo(p) { window._dashPeriodo = p; renderDashboard(); }

// Rango [desde, hasta) del periodo actual y del anterior, como strings YYYY-MM-DD
function _rangosPeriodo(periodo) {
  const hoy = new Date(); const y = hoy.getFullYear(); const m = hoy.getMonth();
  const iso = d => d.toISOString().slice(0, 10);
  if (periodo === 'anual') return {
    actual: [iso(new Date(y, 0, 1)), iso(new Date(y + 1, 0, 1))],
    previo: [iso(new Date(y - 1, 0, 1)), iso(new Date(y, 0, 1))],
    label: String(y),
  };
  if (periodo === 'tri') {
    const q = Math.floor(m / 3);
    return {
      actual: [iso(new Date(y, q * 3, 1)), iso(new Date(y, q * 3 + 3, 1))],
      previo: [iso(new Date(y, q * 3 - 3, 1)), iso(new Date(y, q * 3, 1))],
      label: 'Q' + (q + 1) + ' ' + y,
    };
  }
  return {
    actual: [iso(new Date(y, m, 1)), iso(new Date(y, m + 1, 1))],
    previo: [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 1))],
    label: hoy.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' }).toUpperCase(),
  };
}
function _enRango(fecha, rango) { return !!fecha && fecha >= rango[0] && fecha < rango[1]; }


// Exportar OPs del dashboard a CSV (equivalente real del botón Exportar de la referencia)
function exportarDashboardCSV() {
  db.ops.list().then(ops => {
    const filas = [['Número OP', 'Descripción', 'Estatus', 'Ejecutivo', 'Fecha Evento', 'Cotizado', 'Cobrado', 'Utilidad']]
      .concat(ops.map(o => [o.numero, o.desc, o.status, o.ejec, o.fechaEvento || '', o.cotizado, o.cobrado, o.utilidad]));
    const csv = filas.map(f => f.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
    a.download = 'actidea-ops.csv';
    a.click();
  }).catch(() => toast('Error al exportar', 'red'));
}

async function renderDashboard() {
  const root = document.getElementById('view-dashboard');
  if (!root) return;

  showSpinner();
  let ops, pagos, prospectos, clientes;
  let pagosVisibles = true; // pagos es solo-admin: los demás roles ven el resto del dashboard
  try {
    [ops, pagos, prospectos, clientes] = await Promise.all([
      db.ops.list(),
      db.pagos.list().catch(() => { pagosVisibles = false; return []; }),
      db.prospectos.list(),
      db.clientes.list(),
    ]);
  } catch (e) {
    toast('Error al cargar dashboard', 'red');
    return;
  } finally {
    hideSpinner();
  }

  const cliMap = Object.fromEntries(clientes.map(c => [c.id, c]));
  const opMap  = Object.fromEntries(ops.map(o => [o.id, o]));
  const cliById = id => cliMap[id] || {};
  const opById  = id => opMap[id] || {};

  const opsActivas    = ops.filter(o => o.status === 'En Producción');
  const totalCotizado = opsActivas.reduce((a, o) => a + (o.cotizado || 0), 0);
  const pagosPend     = pagos.filter(p => (p.status === 'Pendiente' || p.status === 'Vencido') && p.tipo === 'Cobro a cliente');
  const totalPend     = pagosPend.reduce((a, p) => a + (p.monto || 0), 0);
  const pipeline      = prospectos.reduce((a, p) => a + (parseFloat(p.estimado) || 0), 0);
  const ejecutadas    = ops.filter(o => o.status === 'Ejecutado');
  const ejecutado     = ejecutadas.reduce((a, o) => a + (o.cotizado || 0), 0);
  const utilidad      = ejecutadas.reduce((a, o) => a + (o.utilidad || 0), 0);
  const margen        = ejecutado ? Math.round(utilidad / ejecutado * 100) : 0;
  const cliActivos    = clientes.filter(c => c.status === 'Activo').length;
  const vencidos      = pagos.filter(p => p.status === 'Vencido').length;
  const hoy = new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase();

  // Metas: del módulo de Objetivos (visibles para todo el equipo); defaults si no hay
  let obj = {};
  const user = sesionActual();
  try { obj = await ObjetivosStore.load(ObjetivosStore.mesActual()); } catch {}
  const factor = { mes: 1, tri: 3, anual: 12 }[window._dashPeriodo];
  const METAS = {
    ventas:     (obj.metaVentas     || 3000000) * factor,
    produccion: (obj.metaProduccion || 8000000),
    pipeline:   (obj.metaPipeline   || 18000000),
    clientes:   (obj.metaClientes   || 0),
    utilidad:   (obj.metaUtilidad   || 0) * factor,   // Capa 2 · Dirección
    cobranza:   (obj.metaCobranza   || 0) * factor,   // Capa 2 · Dirección
  };
  // Cobrado del mes (para la meta de cobranza de Dirección)
  const cobradoMes = pagos.filter(p => p.tipo === 'Cobro a cliente' && p.status === 'Pagado')
    .reduce((a, p) => a + (p.monto || 0), 0);

  // Ventas ejecutadas del PERIODO seleccionado (mes/tri/anual) y comparativa vs periodo anterior
  const periodo = window._dashPeriodo;
  const rangos  = _rangosPeriodo(periodo);
  // Sin fecha de evento: cuentan en la vista ANUAL (para no perder ventas), no en mes/tri
  const _cuenta = o => periodo === 'anual' ? (!o.fechaEvento || _enRango(o.fechaEvento, rangos.actual)) : _enRango(o.fechaEvento, rangos.actual);
  const ejecPeriodo = ejecutadas.filter(_cuenta);
  const ventasPeriodo = ejecPeriodo.reduce((a, o) => a + (o.cotizado || 0), 0);
  const ventasPrevio  = ejecutadas.filter(o => _enRango(o.fechaEvento, rangos.previo)).reduce((a, o) => a + (o.cotizado || 0), 0);
  const sinFecha = ejecutadas.filter(o => !o.fechaEvento).length;
  const delta = ventasPrevio ? Math.round((ventasPeriodo - ventasPrevio) / ventasPrevio * 100) : null;
  const deltaHTML = delta === null
    ? `<div class="kpi-delta up">${ejecPeriodo.length} OPs en el periodo${sinFecha ? ' · ' + sinFecha + ' sin fecha' : ''}</div>`
    : `<div class="kpi-delta ${delta >= 0 ? 'up' : 'down'}">${icoHTML('arrowup')} ${delta >= 0 ? '+' : ''}${delta}% vs periodo anterior</div>`;

  const kpiBar = (a, b, col) => {
    const p = Math.min(Math.round(a / b * 100), 100);
    return `<div class="kpi-bar"><div class="kpi-bar-top"><span class="kpi-bar-meta">META ${fmxK(b)}</span><span class="kpi-bar-meta" style="color:${p >= 100 ? 'var(--green)' : p >= 60 ? 'var(--amber)' : 'var(--red)'};font-weight:700">${p}%</span></div><div class="prog"><div class="prog-fill ${col}" style="width:${p}%"></div></div></div>`;
  };

  // ── Actividad reciente: auditoría real (solo admin la puede leer) ──
  let actividad = [];
  if (user?.role === 'admin') {
    try {
      const audit = await API.get('/auditoria?limit=8');
      const verbos = { crear: 'creó', editar: 'editó', eliminar: 'eliminó', login_exitoso: 'inició sesión', backup_generado: 'generó respaldo' };
      actividad = (audit || []).slice(0, 6).map(a => ({
        ico: a.exito ? (a.accion === 'crear' ? 'green' : a.accion === 'eliminar' ? 'amber' : 'gray') : 'amber',
        who: a.usuario || 'Sistema',
        act: verbos[a.accion] || a.accion || '',
        obj: a.entidad || '',
        time: (a.fecha || '').slice(0, 16).replace('T', ' '),
      }));
    } catch {}
  }
  const actividadHTML = actividad.length
    ? actividad.map(a => `<div class="feed-row"><div class="feed-dot ${a.ico}"></div><div style="flex:1"><div style="font-size:12.5px"><strong>${esc(a.who)}</strong> ${esc(a.act)} <span style="color:var(--gray600)">${esc(a.obj)}</span></div><div class="kpi-bar-meta" style="margin-top:2px">${esc(a.time)}</div></div></div>`).join('')
    : `<div class="kpi-bar-meta" style="padding:8px 0">SIN ACTIVIDAD RECIENTE</div>`;

  root.innerHTML = phHTML('PANORAMA · ' + rangos.label, 'Dashboard', 'Resumen ejecutivo del periodo seleccionado',
    `<button class="btn btn-ghost btn-sm" onclick="exportarDashboardCSV()">${icoHTML('download')} Exportar</button><button class="btn btn-primary btn-sm" onclick="openM('nueva-op')">${icoHTML('plus')} Nueva OP</button>`)
  + `<div class="kpis">
      <div class="kpi" style="--accent:var(--red);--accent-dim:var(--red-dim)"><div class="kpi-top"><div class="kpi-label">VENTAS EJECUTADAS</div><div class="kpi-ico">${icoHTML('chart')}</div></div><div class="kpi-value kv-red">${fmxK(ventasPeriodo)}</div>${deltaHTML}${kpiBar(ventasPeriodo, METAS.ventas, 'red')}</div>
      <div class="kpi" style="--accent:var(--amber);--accent-dim:var(--amber-dim)"><div class="kpi-top"><div class="kpi-label">OPs ACTIVAS</div><div class="kpi-ico">${icoHTML('box')}</div></div><div class="kpi-value kv-amber">${opsActivas.length}</div><div class="kpi-delta">${fmxK(totalCotizado)} en producción</div>${kpiBar(totalCotizado, METAS.produccion, 'amber')}</div>
      <div class="kpi" style="--accent:var(--green);--accent-dim:var(--green-dim)"><div class="kpi-top"><div class="kpi-label">PIPELINE PROSPECTOS</div><div class="kpi-ico">${icoHTML('target')}</div></div><div class="kpi-value kv-green">${fmxK(pipeline)}</div><div class="kpi-delta up">${prospectos.length} oportunidades</div>${kpiBar(pipeline, METAS.pipeline, 'green')}</div>
    </div>
    <div class="kpis" style="margin-bottom:22px">
      <div class="kpi" style="--accent:var(--red);--accent-dim:var(--red-dim)"><div class="kpi-top"><div class="kpi-label">COBRANZA PENDIENTE</div><div class="kpi-ico" style="background:var(--red-dim);color:var(--red)">${icoHTML('wallet')}</div></div><div class="kpi-value kv-red">${pagosVisibles ? fmxK(totalPend) : '—'}</div><div class="kpi-delta ${vencidos ? 'down' : ''}">${!pagosVisibles ? 'solo Dirección' : vencidos ? icoHTML('alert') + ' ' + vencidos + ' vencidos' : pagosPend.length + ' por cobrar'}</div>${METAS.cobranza ? kpiBar(cobradoMes, METAS.cobranza, cobradoMes >= METAS.cobranza ? 'green' : 'amber') : ''}</div>
      <div class="kpi" style="--accent:var(--green);--accent-dim:var(--green-dim)"><div class="kpi-top"><div class="kpi-label">UTILIDAD GENERADA</div><div class="kpi-ico" style="background:var(--green-dim);color:var(--green)">${icoHTML('trend')}</div></div><div class="kpi-value kv-green">${fmxK(utilidad)}</div><div class="kpi-delta up">margen prom. ${margen}%</div>${METAS.utilidad ? kpiBar(utilidad, METAS.utilidad, 'green') : ''}</div>
      <div class="kpi"><div class="kpi-top"><div class="kpi-label">CLIENTES ACTIVOS</div><div class="kpi-ico" style="background:var(--gray50);color:var(--gray600)">${icoHTML('building')}</div></div><div class="kpi-value">${cliActivos}</div><div class="kpi-delta">${clientes.length} en directorio</div>${METAS.clientes ? `<div class="kpi-bar"><div class="kpi-bar-top"><span class="kpi-bar-meta">META ${METAS.clientes}</span><span class="kpi-bar-meta" style="color:${cliActivos >= METAS.clientes ? 'var(--green)' : 'var(--amber)'};font-weight:700">${Math.min(Math.round(cliActivos / METAS.clientes * 100), 100)}%</span></div><div class="prog"><div class="prog-fill ${cliActivos >= METAS.clientes ? 'green' : 'amber'}" style="width:${Math.min(Math.round(cliActivos / METAS.clientes * 100), 100)}%"></div></div></div>` : ''}</div>
    </div>
    <div class="dash-grid">
      <div class="col-stack">
        <div class="panel">
          <div class="panel-hdr"><div class="panel-title"><span class="dot"></span>TENDENCIA DE VENTAS · ${new Date().getFullYear()}</div><div class="vsel"><button class="vsel-btn ${periodo==='mes'?'active':''}" onclick="setDashPeriodo('mes')">MENSUAL</button><button class="vsel-btn ${periodo==='tri'?'active':''}" onclick="setDashPeriodo('tri')">TRIMESTRAL</button><button class="vsel-btn ${periodo==='anual'?'active':''}" onclick="setDashPeriodo('anual')">ANUAL</button></div></div>
          <div class="panel-body"><div class="chart-box"><canvas id="ch-trend"></canvas></div></div>
        </div>
        <div class="panel">
          <div class="panel-hdr"><div class="panel-title"><span class="dot"></span>OPs EN PRODUCCIÓN</div><span class="link-red mono" style="font-size:9px;color:var(--red);cursor:pointer" onclick="nav('ops')">VER TODAS →</span></div>
          <div class="panel-body" style="display:flex;flex-direction:column;gap:10px">${
            opsActivas.length ? opsActivas.map(o => {
              const c = cliById(o.clienteId); const p = pct(o.cobrado, o.cotizado);
              return `<div class="op-card" onclick="openDetalleOP('${o.id}')"><div style="display:flex;justify-content:space-between;align-items:flex-start"><div><div class="op-num">${esc(o.numero)}</div><div class="op-name">${esc(o.desc)}</div><div class="op-meta"><div class="op-meta-item">${icoHTML('building')} ${esc(c.nombre) || '—'}</div><div class="op-meta-item">${icoHTML('cal')} ${esc(o.fechaEvento) || '—'}</div><div class="op-meta-item">${icoHTML('user')} ${esc(o.ejec) || '—'}</div></div></div><div style="text-align:right;min-width:130px"><div class="mono" style="font-size:14px;font-weight:700">${fmx(o.cotizado)}</div><div style="margin-top:6px"><div style="display:flex;justify-content:space-between;margin-bottom:3px"><span class="kpi-bar-meta">COBRADO</span><span class="kpi-bar-meta" style="color:${p >= 100 ? 'var(--green)' : p >= 50 ? 'var(--amber)' : 'var(--red)'};font-weight:700">${p}%</span></div><div class="prog"><div class="prog-fill ${p >= 100 ? 'green' : p >= 50 ? 'amber' : 'red'}" style="width:${Math.min(p, 100)}%"></div></div></div></div></div></div>`;
            }).join('') : `<div class="kpi-bar-meta" style="padding:8px 0">SIN OPs EN PRODUCCIÓN</div>`
          }</div>
        </div>
      </div>
      <div class="col-stack">
        <div class="panel">
          <div class="panel-hdr"><div class="panel-title"><span class="dot"></span>RANKING EJECUTIVOS</div><span class="kpi-bar-meta">ESTE MES</span></div>
          <div class="panel-body">${rankingHTML(ops)}</div>
        </div>
        <div class="panel">
          <div class="panel-hdr"><div class="panel-title"><span class="dot" style="background:var(--red)"></span>COBROS URGENTES</div><span class="tag ${!pagosVisibles ? '' : vencidos ? 'tag-red' : 'tag-green'}">${!pagosVisibles ? 'SOLO DIRECCIÓN' : vencidos ? vencidos + ' VENCIDOS' : 'AL DÍA'}</span></div>
          <div class="panel-body">${
            pagosPend.length ? pagosPend.slice(0, 4).map(p => {
              const o = opById(p.opId); const c = cliById(o.clienteId);
              return `<div class="pay-row" onclick="nav('pagos')"><div class="pay-ico ${p.status === 'Vencido' ? 'pi-venc' : 'pi-cobro'}">${p.status === 'Vencido' ? '⚠' : '$'}</div><div style="flex:1;min-width:0"><div style="font-size:12.5px;font-weight:500">${esc(p.concepto)}</div><div class="kpi-bar-meta" style="margin-top:2px">${esc(o.numero) || '—'} · ${esc(c.nombre) || '—'}</div></div><div style="text-align:right"><div class="mono" style="font-size:12px;font-weight:700;color:${p.status === 'Vencido' ? 'var(--red)' : 'var(--green)'}">${fmxK(p.monto)}</div><div class="kpi-bar-meta">${p.status === 'Vencido' ? 'VENCIDO' : esc(p.fechaAcordada) || '—'}</div></div></div>`;
            }).join('') : `<div class="kpi-bar-meta" style="padding:8px 0">${pagosVisibles ? '✓ SIN COBROS PENDIENTES' : 'VISIBLE SOLO PARA DIRECCIÓN'}</div>`
          }</div>
        </div>
        ${user?.role === 'admin' ? `<div class="panel">
          <div class="panel-hdr"><div class="panel-title"><span class="dot"></span>ACTIVIDAD RECIENTE</div><span class="kpi-bar-meta">SOLO DIRECCIÓN</span></div>
          <div class="panel-body">${actividadHTML}</div>
        </div>` : ''}
      </div>
    </div>`;

  drawTrend(ejecutadas, (obj.metaVentas || 3000000), periodo);
}

function rankingHTML(ops) {
  const nombres = [...new Set(ops.map(o => o.ejec).filter(Boolean))];
  const data = nombres.map(name => {
    const cerrado = ops.filter(o => o.ejec === name && o.status === 'Ejecutado').reduce((a, o) => a + (o.cotizado || 0), 0);
    const activo  = ops.filter(o => o.ejec === name && o.status === 'En Producción').reduce((a, o) => a + (o.cotizado || 0), 0);
    return { name, short: name.split(' ')[0], color: ejecColor(name), cerrado, activo, total: cerrado + activo };
  }).sort((a, b) => b.total - a.total);
  if (!data.length) return `<div class="kpi-bar-meta" style="padding:8px 0">SIN DATOS DE EJECUTIVOS</div>`;
  const max = Math.max(...data.map(d => d.total), 1);
  return data.map((d, i) => `<div class="rank-row"><div class="rank-pos ${i === 0 ? 'top' : ''}">${i + 1}</div>${avatarHTML(d.name, 34)}<div style="flex:1"><div style="display:flex;justify-content:space-between;margin-bottom:5px"><span style="font-size:13px;font-weight:600">${esc(d.short)}</span><span class="mono" style="font-size:12px;font-weight:700;color:${d.color}">${fmxK(d.total)}</span></div><div class="prog"><div class="prog-fill" style="width:${Math.round(d.total / max * 100)}%;background:linear-gradient(90deg,${d.color},${d.color}cc)"></div></div></div></div>`).join('');
}

function drawTrend(ejecutadas, metaMensual, periodo) {
  const ctx = document.getElementById('ch-trend');
  if (!ctx || !window.Chart) return;
  if (window._acCharts.trend) window._acCharts.trend.destroy();
  const anio = new Date().getFullYear();
  const suma = (desde, hasta) => ejecutadas
    .filter(o => o.fechaEvento && o.fechaEvento >= desde && o.fechaEvento < hasta)
    .reduce((a, o) => a + (o.cotizado || 0), 0) / 1e6;
  let labels, ventas, metaVal;
  if (periodo === 'anual') {
    labels = [anio - 2, anio - 1, anio].map(String);
    ventas = labels.map(y => suma(`${y}-01-01`, `${+y + 1}-01-01`));
    metaVal = metaMensual * 12 / 1e6;
  } else if (periodo === 'tri') {
    labels = ['Q1', 'Q2', 'Q3', 'Q4'];
    ventas = [0, 3, 6, 9].map(m0 => suma(
      `${anio}-${String(m0 + 1).padStart(2, '0')}-01`,
      m0 + 4 > 12 ? `${anio + 1}-01-01` : `${anio}-${String(m0 + 4).padStart(2, '0')}-01`));
    metaVal = metaMensual * 3 / 1e6;
  } else {
    labels = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
    ventas = labels.map((_, i) => suma(
      `${anio}-${String(i + 1).padStart(2, '0')}-01`,
      i + 2 > 12 ? `${anio + 1}-01-01` : `${anio}-${String(i + 2).padStart(2, '0')}-01`));
    metaVal = metaMensual / 1e6;
  }
  const meta = labels.map(() => metaVal);
  const g = ctx.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 230);
  grad.addColorStop(0, 'rgba(204,34,0,.22)'); grad.addColorStop(1, 'rgba(204,34,0,0)');
  window._acCharts.trend = new Chart(ctx, { type: 'line', data: { labels, datasets: [
    { label: 'Ventas', data: ventas, borderColor: '#CC2200', backgroundColor: grad, fill: true, tension: .4, borderWidth: 2.5, pointBackgroundColor: '#CC2200', pointRadius: 0, pointHoverRadius: 5, pointHoverBorderColor: '#fff', pointHoverBorderWidth: 2 },
    { label: 'Meta', data: meta, borderColor: 'rgba(145,139,131,.5)', borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, fill: false, tension: .3 },
  ] }, options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false }, tooltip: { backgroundColor: '#0F0F0F', padding: 10, titleFont: { family: 'JetBrains Mono', size: 9 }, bodyFont: { family: 'DM Sans', size: 12 }, callbacks: { label: c => ' $' + c.parsed.y.toFixed(1) + 'M' } } }, scales: { y: { beginAtZero: true, grid: { color: 'rgba(15,15,15,.05)' }, ticks: { font: { family: 'JetBrains Mono', size: 9 }, color: '#918B83', callback: v => '$' + v + 'M' } }, x: { grid: { display: false }, ticks: { font: { family: 'JetBrains Mono', size: 9 }, color: '#918B83' } } } } });
}
