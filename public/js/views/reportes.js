// ══════════════════════════════════════
// REPORTES VIEW
// ══════════════════════════════════════

let _rpCharts = { ingresos: null, estado: null };

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
            <td class="mono" style="color:var(--red)">${o.numero}</td>
            <td><div style="font-weight:600">${o.desc}</div><div style="font-size:11px;color:var(--gray400)">${cli.nombre || '—'}</div></td>
            <td>${pillHTML(o.status)}</td>
            <td class="mono">${o.fechaEvento || '—'}</td>
            <td><div style="font-size:12px">${o.ejec || '—'}</div></td>
            <td class="monto">${fmx(o.cotizado)}</td>
            <td class="monto" style="color:var(--green)">${fmx(o.cobrado)}</td>
            <td class="monto" style="color:var(--green)">${fmx(o.utilidad)}</td>
          </tr>`;
        }).join('')
      : `<tr><td colspan="8"><div class="empty-state"><div>📊</div><div>SIN OPs EN ESTE PERIODO</div></div></td></tr>`;
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

  _buildRpCharts(opsP);
}

function _buildRpCharts(ops) {
  Chart.defaults.font.family = "'DM Sans',sans-serif";
  Chart.defaults.color = '#918B83';

  // Estado OP chart (donut)
  const statusCounts = {};
  ops.forEach(o => { statusCounts[o.status] = (statusCounts[o.status] || 0) + 1; });
  const statusColors = { 'Ejecutado': '#1A6B3C', 'En Producción': '#A0620A', 'Cotización': '#0077CC', 'Cancelado': '#C8C3BC' };

  if (_rpCharts.estado) _rpCharts.estado.destroy();
  const sel = document.getElementById('chartRpEstado');
  if (sel && Object.keys(statusCounts).length) {
    _rpCharts.estado = new Chart(sel, {
      type: 'doughnut',
      data: {
        labels: Object.keys(statusCounts),
        datasets: [{
          data: Object.values(statusCounts),
          backgroundColor: Object.keys(statusCounts).map(s => statusColors[s] || '#C8C3BC'),
          borderWidth: 2,
          borderColor: '#fff',
        }],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } },
          tooltip: { callbacks: { label: ctx => ctx.label + ': ' + ctx.parsed } },
        },
      },
    });
  }

  // Ingresos por ejecutivo
  if (_rpCharts.ingresos) _rpCharts.ingresos.destroy();
  const iel = document.getElementById('chartRpIngresos');
  if (iel) {
    _rpCharts.ingresos = new Chart(iel, {
      type: 'bar',
      data: {
        labels: EJEC_LIST,
        datasets: [{
          label: 'Cotizado',
          data: EJEC_LIST.map(e => ops.filter(o => o.ejec === e).reduce((a, o) => a + (o.cotizado || 0), 0)),
          backgroundColor: EJEC_LIST.map(e => EJEC_COL[e] || '#888'),
          borderRadius: 5,
          borderSkipped: false,
        }],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fmx(ctx.parsed.y) } } },
        scales: { y: { grid: { color: 'rgba(0,0,0,.05)' }, ticks: { callback: v => '$' + (v / 1000).toFixed(0) + 'K' } }, x: { grid: { display: false } } },
      },
    });
  }
}

async function exportReportePDF() {
  toast('Función de exportación disponible próximamente', 'amber');
}
