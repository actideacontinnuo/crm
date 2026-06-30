// ══════════════════════════════════════
// COMERCIAL VIEW
// Computed from real Notion data with
// per-ejecutivo objective scaffolding
// ══════════════════════════════════════

// Chart instances
let _comCharts = { tend: null, comp: null };

function semaforo(p) {
  if (p >= 100) return { bg: 'rgba(26,107,60,.12)', bdr: 'rgba(26,107,60,.3)', col: '#1A6B3C', lbl: '✓ Meta alcanzada' };
  if (p >= 75)  return { bg: 'rgba(160,98,10,.10)', bdr: 'rgba(160,98,10,.3)', col: '#A0620A', lbl: '⚑ En progreso' };
  return { bg: 'rgba(204,34,0,.09)', bdr: 'rgba(204,34,0,.28)', col: '#CC2200', lbl: '↓ Por debajo' };
}

// Build per-ejecutivo stats from real OP data
function _buildEjecStats(ops) {
  // Objectives (annual, hardcoded targets in MXN)
  const OBJ_ANUAL = { 'Natalia Gama': 12000000, 'Ximena': 9600000, 'Alexia': 4800000 };
  const result = [];
  for (const ejec of EJEC_LIST) {
    const col     = EJEC_COL[objec = ejec] || '#888';
    const ejecOps = ops.filter(o => o.ejec === ejec);
    const anual   = ejecOps.reduce((a, o) => a + (o.cotizado || 0), 0);
    const obj     = OBJ_ANUAL[ejec] || 10000000;
    const ejecutadas = ejecOps.filter(o => o.status === 'Ejecutado');
    result.push({ nombre: ejec, col, real: anual, obj, ops: ejecutadas.length });
  }
  return result;
}

async function renderComercial() {
  showSpinner();
  let ops;
  try {
    ops = await db.ops.list();
  } catch (e) {
    toast('Error al cargar comercial', 'red');
    return;
  } finally {
    hideSpinner();
  }

  const ejecs = _buildEjecStats(ops);
  const total  = ejecs.reduce((a, e) => a + e.real, 0);
  const objTot = ejecs.reduce((a, e) => a + e.obj, 0);
  const pt     = objTot ? Math.round(total / objTot * 100) : 0;
  const totalOps = ejecs.reduce((a, e) => a + e.ops, 0);
  const s = semaforo(pt);

  document.getElementById('com-kpis').innerHTML = `
    <div class="kpi"><div class="kpi-label">INGRESOS TOTALES</div><div class="kpi-value">${fmx(total)}</div><div class="kpi-delta">de ${fmx(objTot)} objetivo</div></div>
    <div class="kpi" style="border-top:2px solid ${s.col}"><div class="kpi-label">CUMPLIMIENTO</div><div class="kpi-value" style="color:${s.col}">${pt}%</div><div class="kpi-delta">${s.lbl}</div></div>
    <div class="kpi"><div class="kpi-label">OPs EJECUTADAS</div><div class="kpi-value kv-red">${totalOps}</div></div>
    <div class="kpi"><div class="kpi-label">EJECUTIVOS</div><div class="kpi-value">${ejecs.length}</div></div>
    <div class="kpi"><div class="kpi-label">TOTAL OPs</div><div class="kpi-value">${ops.length}</div></div>`;

  // Ranking
  const sorted = [...ejecs].sort((a, b) => b.real - a.real);
  document.getElementById('com-ranking').innerHTML = sorted.map((e, i) => {
    const pt = e.obj ? Math.round(e.real / e.obj * 100) : 0;
    const s  = semaforo(pt);
    return `<div class="rank-row">
      <div style="font-size:18px;width:24px">${['🥇','🥈','🥉'][i] || '#' + (i + 1)}</div>
      <div class="av" style="background:${e.col}18;border-color:${e.col}45;color:${e.col};width:32px;height:32px;font-size:11px">${e.nombre.slice(0,2)}</div>
      <div style="flex:1">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px">
          <span style="font-size:13px;font-weight:600">${e.nombre}</span>
          <span style="font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700">${fmx(e.real)}</span>
        </div>
        <div style="background:var(--gray100);border-radius:3px;height:5px;overflow:hidden"><div style="height:100%;width:${Math.min(pt,100)}%;background:${e.col};border-radius:3px"></div></div>
        <div style="display:flex;justify-content:space-between;margin-top:2px">
          <span style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--gray400)">Obj: ${fmx(e.obj)}</span>
          <span style="font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;color:${s.col}">${pt}%</span>
        </div>
      </div>
      <div style="font-family:'JetBrains Mono',monospace;font-size:8px;padding:2px 8px;border-radius:4px;background:${s.bg};border:1px solid ${s.bdr};color:${s.col}">${s.lbl}</div>
    </div>`;
  }).join('');

  // Cards
  document.getElementById('com-cards').innerHTML = ejecs.map(e => {
    const pt = e.obj ? Math.round(e.real / e.obj * 100) : 0;
    const s  = semaforo(pt);
    return `<div class="panel" style="border-top:3px solid ${e.col};margin-bottom:0">
      <div style="padding:13px 16px 8px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:9px">
        <div class="av" style="width:34px;height:34px;font-size:12px;background:${e.col}18;border-color:${e.col}45;color:${e.col}">${e.nombre.slice(0,2)}</div>
        <div><div style="font-weight:600;font-size:14px">${e.nombre}</div><div style="font-family:'JetBrains Mono',monospace;font-size:8px;color:var(--gray400);letter-spacing:.1em">EJECUTIVO COMERCIAL</div></div>
        <div style="margin-left:auto;font-family:'JetBrains Mono',monospace;font-size:9px;padding:2px 7px;border-radius:4px;background:${s.bg};border:1px solid ${s.bdr};color:${s.col}">${pt}%</div>
      </div>
      <div style="padding:10px 16px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:8px">
          <div class="info-cell" style="text-align:center;padding:7px"><div class="info-cell-label">REAL</div><div style="font-family:'Bebas Neue',cursive;font-size:20px;color:${e.col}">${fmx(e.real)}</div></div>
          <div class="info-cell" style="text-align:center;padding:7px"><div class="info-cell-label">OBJETIVO</div><div style="font-family:'Bebas Neue',cursive;font-size:20px">${fmx(e.obj)}</div></div>
        </div>
        <div style="background:var(--gray100);border-radius:4px;height:7px;overflow:hidden;margin-bottom:5px"><div style="height:100%;width:${Math.min(pt,100)}%;background:${e.col};border-radius:4px"></div></div>
        <div style="display:flex;justify-content:space-between">
          <div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--gray400)">OPs ejecutadas: ${e.ops}</div>
          <div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:${s.col}">${s.lbl}</div>
        </div>
      </div>
    </div>`;
  }).join('');

  // Objetivos table
  _renderComObjetivos(ejecs);

  // Charts
  _buildComCharts(ejecs, ops);
}

function _renderComObjetivos(ejecs) {
  const rows = ejecs.map(e => {
    const pt     = e.obj ? Math.round(e.real / e.obj * 100) : 0;
    const s      = semaforo(pt);
    const falta  = Math.max(0, e.obj - e.real);
    return `<tr>
      <td style="padding:11px 16px">
        <div style="display:flex;align-items:center;gap:8px">
          <div class="av" style="background:${e.col}18;border-color:${e.col}45;color:${e.col}">${e.nombre.slice(0,2)}</div>
          <span style="font-size:13px;font-weight:500">${e.nombre}</span>
        </div>
      </td>
      <td class="mono" style="font-weight:700">${fmx(e.obj)}</td>
      <td class="mono" style="color:${e.col};font-weight:700">${fmx(e.real)}</td>
      <td style="min-width:160px;padding:11px 12px">
        <div style="display:flex;align-items:center;gap:8px">
          <div style="flex:1;background:var(--gray100);border-radius:3px;height:6px;overflow:hidden"><div style="height:100%;width:${Math.min(pt,100)}%;background:${e.col};border-radius:3px"></div></div>
          <div style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;color:${s.col};width:34px;text-align:right">${pt}%</div>
        </div>
      </td>
      <td><div style="font-family:'JetBrains Mono',monospace;font-size:9px;padding:3px 8px;border-radius:4px;background:${s.bg};border:1px solid ${s.bdr};color:${s.col};display:inline-block">${s.lbl}</div></td>
      <td class="mono" style="color:var(--gray600)">${fmx(falta)}</td>
    </tr>`;
  }).join('');
  document.getElementById('com-objetivos').innerHTML = `
    <table class="tbl"><thead><tr><th>EJECUTIVO</th><th>OBJETIVO</th><th>REAL AL DÍA</th><th style="min-width:180px">AVANCE</th><th>SEMÁFORO</th><th>FALTA P/ META</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function _buildComCharts(ejecs, ops) {
  Chart.defaults.font.family = "'DM Sans',sans-serif";
  Chart.defaults.color = '#918B83';

  // Tendencia chart — monthly cotizado (simplified)
  const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const currentYear = new Date().getFullYear();
  const byMonth = Array(12).fill(0);
  ops.filter(o => o.fechaEvento).forEach(o => {
    const d = new Date(o.fechaEvento);
    if (d.getFullYear() === currentYear) byMonth[d.getMonth()] += (o.cotizado || 0);
  });

  if (_comCharts.tend) _comCharts.tend.destroy();
  const tel = document.getElementById('chartTend');
  if (tel) {
    _comCharts.tend = new Chart(tel, {
      type: 'line',
      data: {
        labels: months,
        datasets: [{
          label: String(currentYear),
          data: byMonth,
          borderColor: '#CC2200',
          backgroundColor: 'rgba(204,34,0,.07)',
          borderWidth: 2,
          pointBackgroundColor: '#CC2200',
          pointRadius: 4,
          fill: true,
          tension: .35,
        }],
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } }, tooltip: { callbacks: { label: ctx => ctx.dataset.label + ': ' + fmx(ctx.parsed.y) } } },
        scales: { y: { grid: { color: 'rgba(0,0,0,.05)' }, ticks: { callback: v => '$' + (v / 1000).toFixed(0) + 'K' } }, x: { grid: { display: false } } },
      },
    });
  }

  // Comparativo por ejecutivo
  if (_comCharts.comp) _comCharts.comp.destroy();
  const cel = document.getElementById('chartComp');
  if (cel) {
    _comCharts.comp = new Chart(cel, {
      type: 'bar',
      data: {
        labels: ejecs.map(e => e.nombre.split(' ')[0]),
        datasets: [
          { label: 'Objetivo', data: ejecs.map(e => e.obj), backgroundColor: 'rgba(200,195,188,.55)', borderRadius: 4, borderSkipped: false },
          { label: 'Real', data: ejecs.map(e => e.real), backgroundColor: ejecs.map(e => e.col), borderRadius: 4, borderSkipped: false },
        ],
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } }, tooltip: { callbacks: { label: ctx => ctx.dataset.label + ': ' + fmx(ctx.parsed.y) } } },
        scales: { y: { grid: { color: 'rgba(0,0,0,.05)' }, ticks: { callback: v => '$' + (v / 1000).toFixed(0) + 'K' } }, x: { grid: { display: false } } },
      },
    });
  }
}
