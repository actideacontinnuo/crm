// ══════════════════════════════════════
// COMERCIAL / REPORTES — réplica exacta del diseño de referencia
// (Copia de Actidea CRM offline), alimentada con datos reales de Notion.
// ══════════════════════════════════════

// Periodo de la vista comercial: mes | tri | anual
window._comPeriodo = window._comPeriodo || 'mes';
function setComPeriodo(p) { window._comPeriodo = p; renderComercial(); }

async function renderComercial() {
  const root = document.getElementById('view-comercial');
  if (!root) return;

  showSpinner();
  let ops, prospectos;
  try {
    [ops, prospectos] = await Promise.all([db.ops.list(), db.prospectos.list()]);
  } catch (e) {
    toast('Error al cargar reportes', 'red');
    return;
  } finally {
    hideSpinner();
  }

  // Objetivo por ejecutivo: del módulo de Objetivos (visible para todo el equipo)
  let objetivoEjec = 2500000;
  try {
    const obj = await ObjetivosStore.load(ObjetivosStore.mesActual());
    if (obj?.objetivoEjecutivo) objetivoEjec = obj.objetivoEjecutivo;
  } catch {}

  const periodo = window._comPeriodo;
  const rangos  = _rangosPeriodo(periodo);
  const factor  = { mes: 1, tri: 3, anual: 12 }[periodo];
  objetivoEjec *= factor;
  // OPs ejecutadas del periodo (por fecha de evento); si no tiene fecha, cuenta solo en ANUAL
  const enPeriodo = o => periodo === 'anual' ? (!o.fechaEvento || _enRango(o.fechaEvento, rangos.actual)) : _enRango(o.fechaEvento, rangos.actual);
  const nombres = [...new Set([...ops.map(o => o.ejec), ...prospectos.map(p => p.ejec)].filter(Boolean))];
  const data = nombres.map(name => {
    const ejs     = ops.filter(o => o.ejec === name);
    const cerrado = ejs.filter(o => o.status === 'Ejecutado' && enPeriodo(o)).reduce((a, o) => a + (o.cotizado || 0), 0);
    const activo  = ejs.filter(o => o.status === 'En Producción').reduce((a, o) => a + (o.cotizado || 0), 0);
    const util    = ejs.filter(o => o.status === 'Ejecutado' && enPeriodo(o)).reduce((a, o) => a + (o.utilidad || 0), 0);
    const prosp   = prospectos.filter(p => p.ejec === name);
    const pipe    = prosp.reduce((a, p) => a + (parseFloat(p.estimado) || 0), 0);
    const cierre  = ejs.length ? Math.round(ejs.filter(o => o.status === 'Ejecutado').length / ejs.length * 100) : 0;
    return { name, short: name.split(' ')[0], color: ejecColor(name), cerrado, activo, util, pipe, objetivo: objetivoEjec, cierre, nProsp: prosp.length };
  }).sort((a, b) => (b.cerrado + b.activo) - (a.cerrado + a.activo));

  root.innerHTML = phHTML('INTELIGENCIA COMERCIAL', 'Comercial / Reportes', 'Desempeño por ejecutivo · Real vs. objetivo · ' + rangos.label,
    `<div class="vsel"><button class="vsel-btn ${periodo==='mes'?'active':''}" onclick="setComPeriodo('mes')">MES</button><button class="vsel-btn ${periodo==='tri'?'active':''}" onclick="setComPeriodo('tri')">TRIMESTRE</button><button class="vsel-btn ${periodo==='anual'?'active':''}" onclick="setComPeriodo('anual')">AÑO</button></div>`)
  + (!data.length
    ? `<div class="panel"><div class="panel-body"><div class="kpi-bar-meta" style="padding:14px 0">SIN DATOS DE EJECUTIVOS TODAVÍA — CREA OPs Y PROSPECTOS PARA VER EL REPORTE</div></div></div>`
    : `<div class="grid2" style="margin-bottom:20px">
      <div class="panel"><div class="panel-hdr"><div class="panel-title"><span class="dot"></span>VENTAS POR EJECUTIVO</div></div><div class="panel-body"><div class="chart-box"><canvas id="ch-com"></canvas></div></div></div>
      <div class="panel"><div class="panel-hdr"><div class="panel-title"><span class="dot"></span>CUMPLIMIENTO DE OBJETIVO</div></div><div class="panel-body">${data.map(d => {
        const p = Math.min(Math.round(d.cerrado / d.objetivo * 100), 130);
        const col = p >= 100 ? 'var(--green)' : p >= 60 ? 'var(--amber)' : 'var(--red)';
        return `<div style="margin-bottom:16px"><div style="display:flex;align-items:center;gap:9px;margin-bottom:7px">${avatarHTML(d.name, 28)}<span style="font-weight:600;font-size:13px;flex:1">${esc(d.short)}</span><span class="m" style="font-weight:700;color:${col}">${p}%</span></div><div class="prog" style="height:8px"><div class="prog-fill" style="width:${Math.min(p, 100)}%;background:linear-gradient(90deg,${d.color},${d.color}cc)"></div></div><div style="display:flex;justify-content:space-between;margin-top:4px"><span class="kpi-bar-meta">${fmxK(d.cerrado)} cerrado</span><span class="kpi-bar-meta">obj. ${fmxK(d.objetivo)}</span></div></div>`;
      }).join('')}</div></div>
    </div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>EJECUTIVO</th><th>CERRADO</th><th>EN PRODUCCIÓN</th><th>PIPELINE</th><th>UTILIDAD</th><th>% CIERRE</th><th>OBJETIVO</th><th>CUMPLIMIENTO</th></tr></thead><tbody>
    ${data.map(d => {
      const cump = Math.round(d.cerrado / d.objetivo * 100);
      return `<tr>
      <td><div style="display:flex;align-items:center;gap:9px">${avatarHTML(d.name, 30)}<div><div style="font-weight:600">${esc(d.name)}</div><div class="kpi-bar-meta">${d.nProsp} prospectos activos</div></div></div></td>
      <td class="monto" style="color:var(--green)">${fmxK(d.cerrado)}</td>
      <td class="monto" style="color:var(--amber)">${fmxK(d.activo)}</td>
      <td class="monto">${fmxK(d.pipe)}</td>
      <td class="monto" style="color:var(--green)">${fmxK(d.util)}</td>
      <td class="m" style="font-weight:700">${d.cierre}%</td>
      <td class="m" style="color:var(--gray600)">${fmxK(d.objetivo)}</td>
      <td><span class="tag ${cump >= 100 ? 'tag-green' : cump >= 60 ? 'tag-amber' : 'tag-red'}">${cump}%</span></td>
    </tr>`;
    }).join('')}</tbody></table></div>`);

  if (data.length) drawComercial(data);
}

function drawComercial(data) {
  const ctx = document.getElementById('ch-com');
  if (!ctx || !window.Chart) return;
  if (window._acCharts.com) window._acCharts.com.destroy();
  window._acCharts.com = new Chart(ctx, { type: 'bar', data: { labels: data.map(d => d.short), datasets: [
    { label: 'Cerrado', data: data.map(d => d.cerrado / 1000000), backgroundColor: data.map(d => d.color), borderRadius: 6, barThickness: 32 },
    { label: 'En producción', data: data.map(d => d.activo / 1000000), backgroundColor: data.map(d => d.color + '40'), borderRadius: 6, barThickness: 32 },
  ] }, options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false }, tooltip: { backgroundColor: '#0F0F0F', padding: 10, bodyFont: { family: 'DM Sans', size: 12 }, titleFont: { family: 'JetBrains Mono', size: 9 }, callbacks: { label: c => ' $' + c.parsed.y.toFixed(2) + 'M' } } }, scales: { x: { stacked: true, grid: { display: false }, ticks: { font: { family: 'JetBrains Mono', size: 10 }, color: '#5C5650' } }, y: { stacked: true, grid: { color: 'rgba(15,15,15,.05)' }, ticks: { font: { family: 'JetBrains Mono', size: 9 }, color: '#918B83', callback: v => '$' + v + 'M' } } } } });
}
