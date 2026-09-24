// ══════════════════════════════════════
// REPORTES VIEW
// ══════════════════════════════════════

let _rpCharts = { ingresos: null, ejec: null, cobros: null, estado: null };

function setRpPeriodo(v, el) {
  STATE.rpPeriodo = v;
  document.querySelectorAll('#view-reportes .vtab').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');
  renderReportes();
}

async function renderReportes() {
  showSpinner();
  let ops, pagos, clientes, prospectos;
  try {
    [ops, pagos, clientes, prospectos] = await Promise.all([
      db.ops.list(),
      db.pagos.list(),
      db.clientes.list(),
      db.prospectos.list(),
    ]);
  } catch (e) {
    toast('Error al cargar reportes', 'red');
    return;
  } finally {
    hideSpinner();
  }

  const periodo = STATE.rpPeriodo || 'mes';
  const now     = new Date();
  const cliMap  = Object.fromEntries(clientes.map(c => [c.id, c]));

  // Filter by period
  function inPeriodo(dateStr) {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    if (periodo === 'mes') return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    if (periodo === 'trimestre') {
      const q = Math.floor(now.getMonth() / 3);
      return Math.floor(d.getMonth() / 3) === q && d.getFullYear() === now.getFullYear();
    }
    return d.getFullYear() === now.getFullYear();
  }

  const opsP     = ops.filter(o => inPeriodo(o.fechaEvento));
  const pagosP   = pagos.filter(p => inPeriodo(p.fechaAcordada));
  const cobrados = pagosP.filter(p => p.status === 'Pagado' && p.tipo === 'Cobro a cliente');
  const totalCob = cobrados.reduce((a, p) => a + (p.monto || 0), 0);
  const utilidad = opsP.reduce((a, o) => a + (o.utilidad || 0), 0);
  const cotizado = opsP.reduce((a, o) => a + (o.cotizado || 0), 0);
  const margen   = cotizado > 0 ? Math.round(utilidad / cotizado * 100) : 0;

  document.getElementById('rp-kpis').innerHTML = `
    <div class="kpi"><div class="kpi-label">OPs EN PERIODO</div><div class="kpi-value kv-red">${opsP.length}</div><div class="kpi-delta">${periodo === 'mes' ? 'Este mes' : periodo === 'trimestre' ? 'Este trimestre' : 'Este año'}</div></div>
    <div class="kpi"><div class="kpi-label">COTIZADO</div><div class="kpi-value">${fmx(cotizado)}</div><div class="kpi-delta">MXN sin IVA</div></div>
    <div class="kpi"><div class="kpi-label">COBRADO</div><div class="kpi-value kv-green">${fmx(totalCob)}</div><div class="kpi-delta up">Efectivo confirmado</div></div>
    <div class="kpi"><div class="kpi-label">UTILIDAD BRUTA</div><div class="kpi-value kv-green">${fmx(utilidad)}</div><div class="kpi-delta up">Margen: ${margen}%</div></div>`;

  // OPs table
  const tbody = document.getElementById('rp-ops-tbody');
  if (tbody) {
    tbody.innerHTML = opsP.length
      ? opsP.map(o => {
          const cli = cliMap[o.clienteId] || {};
          return `<tr>
            <td class="mono" style="color:var(--red)">${esc(o.numero)}</td>
            <td><div style="font-weight:600">${esc(o.desc)}</div><div style="font-size:11px;color:var(--gray400)">${esc(cli.nombre) || '—'}</div></td>
            <td>${pillHTML(o.status)}</td>
            <td class="mono">${esc(o.fechaEvento) || '—'}</td>
            <td><div style="font-size:12px">${esc(o.ejec) || '—'}</div></td>
            <td class="monto">${fmx(o.cotizado)}</td>
            <td class="monto" style="color:var(--green)">${fmx(o.cobrado)}</td>
            <td class="monto" style="color:var(--green)">${fmx(o.utilidad)}</td>
          </tr>`;
        }).join('')
      : `<tr><td colspan="8"><div class="empty-state"><div>${icoHTML('chart',26)}</div><div>SIN OPs EN ESTE PERIODO</div></div></td></tr>`;
  }

  // Resumen por ejecutivo
  const rp = document.getElementById('rp-ejec');
  if (rp) {
    rp.innerHTML = EJEC_LIST.map(ejec => {
      const ejecOps = opsP.filter(o => o.ejec === ejec);
      const real    = ejecOps.reduce((a, o) => a + (o.cotizado || 0), 0);
      const util    = ejecOps.reduce((a, o) => a + (o.utilidad || 0), 0);
      const col     = EJEC_COL[ejec] || '#888';
      return `<div class="rank-row">
        <div class="av" style="background:${col}18;border-color:${col}45;color:${col}">${ejec.slice(0,2)}</div>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:600">${ejec}</div>
          <div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--gray400)">${ejecOps.length} OP(s)</div>
        </div>
        <div style="text-align:right">
          <div style="font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:700">${fmx(real)}</div>
          <div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--green)">Util: ${fmx(util)}</div>
        </div>
      </div>`;
    }).join('');
  }

  // Comisiones por beneficiario: OPs EJECUTADAS del periodo. Misma fórmula que el
  // Estado de Resultados (controlpagos.js/ops.js): utilidad × % fijo de la OP; los
  // socios (Eduardo/Alfredo) tienen 0 — su 7.5% se queda como utilidad de la empresa.
  const comBody = document.getElementById('rp-comisiones');
  if (comBody) {
    const grupos = {};
    opsP.filter(o => o.status === 'Ejecutado').forEach(o => {
      const quien = o.propietario || o.ejecCuenta || o.ejec || 'Sin asignar';
      const g = grupos[quien] || (grupos[quien] = { quien, ops: 0, base: 0, comision: 0, pendienteCobro: false });
      const pct = Number(o.comision) || 0;
      g.ops++;
      g.base += o.utilidad || 0;
      g.comision += pct > 0 ? (o.utilidad || 0) * pct / 100 : 0;
      if ((o.cobrado || 0) < (o.cotizado || 0)) g.pendienteCobro = true;
    });
    const filas = Object.values(grupos).sort((a, b) => b.comision - a.comision);
    comBody.innerHTML = filas.length
      ? filas.map(g => `<tr>
          <td><div style="font-weight:600">${esc(g.quien)}</div></td>
          <td class="mono">${g.ops}</td>
          <td class="monto">${fmx(g.base)}</td>
          <td class="monto" style="color:${g.comision > 0 ? 'var(--green)' : 'var(--gray400)'}">${g.comision > 0 ? fmx(g.comision) : '—'}</td>
          <td>${g.comision <= 0 ? '<span class="tag tag-amber">SIN COMISIÓN</span>' : g.pendienteCobro ? '<span class="tag tag-amber">PENDIENTE DE COBRO</span>' : '<span class="tag tag-green">POR LIQUIDAR</span>'}</td>
        </tr>`).join('')
      : `<tr><td colspan="5"><div class="empty-state"><div>SIN OPs EJECUTADAS EN EL PERIODO</div></div></td></tr>`;
  }

  _buildRpCharts(opsP, pagos, pagosP);
}

function _rpDonut(canvasId, key, labels, data, colors) {
  if (_rpCharts[key]) { _rpCharts[key].destroy(); _rpCharts[key] = null; }
  const el = document.getElementById(canvasId);
  if (!el || !data.some(v => v > 0)) return;
  _rpCharts[key] = new Chart(el, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 2, borderColor: '#fff' }] },
    options: { responsive: true, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } }, tooltip: { callbacks: { label: ctx => ctx.label + ': ' + fmx(ctx.parsed) } } } },
  });
}

// Las 4 gráficas de Reportes, dibujadas en los lienzos que existen en index.html.
function _buildRpCharts(ops, pagos, pagosPeriodo) {
  Chart.defaults.font.family = "'DM Sans',sans-serif";
  Chart.defaults.color = '#918B83';
  const cobros = p => p.tipo === 'Cobro a cliente';
  const anio = new Date().getFullYear();

  // 1) Ingresos por mes — año actual (cobros a cliente ya pagados)
  if (_rpCharts.ingresos) { _rpCharts.ingresos.destroy(); _rpCharts.ingresos = null; }
  const porMes = new Array(12).fill(0);
  pagos.filter(p => cobros(p) && p.status === 'Pagado').forEach(p => {
    const d = new Date(p.fechaReal || p.fechaAcordada);
    if (!isNaN(d) && d.getFullYear() === anio) porMes[d.getMonth()] += p.monto || 0;
  });
  const iel = document.getElementById('chartIngresos');
  if (iel) {
    _rpCharts.ingresos = new Chart(iel, {
      type: 'bar',
      data: { labels: ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'], datasets: [{ label: 'Cobrado', data: porMes, backgroundColor: '#1A6B3C', borderRadius: 5, borderSkipped: false }] },
      options: {
        responsive: true,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fmx(ctx.parsed.y) } } },
        scales: { y: { grid: { color: 'rgba(0,0,0,.05)' }, ticks: { callback: v => '$' + (v / 1000).toFixed(0) + 'K' } }, x: { grid: { display: false } } },
      },
    });
  }

  // 2) Ingresos por ejecutivo (cobrado de las OPs del periodo)
  const porEjec = {};
  ops.forEach(o => { const n = o.ejec || 'Sin asignar'; porEjec[n] = (porEjec[n] || 0) + (o.cobrado || 0); });
  const ejecNombres = Object.keys(porEjec).filter(n => porEjec[n] > 0);
  _rpDonut('chartEjec', 'ejec', ejecNombres, ejecNombres.map(n => porEjec[n]), ejecNombres.map(n => (typeof ejecColor === 'function' ? ejecColor(n) : '#888')));
  const leg = document.getElementById('ejec-legend');
  if (leg) leg.innerHTML = ejecNombres.map(n => `<div style="display:flex;justify-content:space-between;font-size:12px;padding:2px 0"><span>${esc(n)}</span><strong>${fmx(porEjec[n])}</strong></div>`).join('');

  // 3) Cobros por estatus (monto de los cobros a cliente del periodo)
  const estCobros = { Pagado: 0, Pendiente: 0, Vencido: 0 };
  pagosPeriodo.filter(cobros).forEach(p => { if (p.status in estCobros) estCobros[p.status] += p.monto || 0; });
  _rpDonut('chartCobros', 'cobros', Object.keys(estCobros), Object.values(estCobros), ['#1A6B3C', '#A0620A', '#CC2200']);

  // 4) OPs por estatus
  const conteo = {};
  ops.forEach(o => { conteo[o.status] = (conteo[o.status] || 0) + 1; });
  const colOp = { 'Ejecutado': '#1A6B3C', 'En Producción': '#A0620A' };
  _rpDonut('chartOps', 'estado', Object.keys(conteo), Object.values(conteo), Object.keys(conteo).map(k => colOp[k] || '#C8C3BC'));
}

async function exportReportePDF() {
  toast('Función de exportación disponible próximamente', 'amber');
}
