// ══════════════════════════════════════
// CONTROL DE PAGOS — cuentas por pagar a proveedores (por OP)
// Réplica del Excel: por OP → Cotización · Pagado · Debemos + P&L.
// Usa las "deudas" (pagos a proveedores). Solo Dirección/Administración.
// ══════════════════════════════════════
const _esPagado = s => String(s || '').toLowerCase() === 'pagado';

async function renderControlPagos() {
  const root = document.getElementById('view-controlpagos');
  if (!root) return;
  showSpinner();
  let deudas, provs, ops, clientes;
  try {
    [deudas, provs, ops, clientes] = await Promise.all([
      db.deudas.list(), db.proveedores.list(), db.ops.list(), db.clientes.list(),
    ]);
  } catch (e) {
    toast('Error al cargar Control de pagos', 'red'); hideSpinner(); return;
  } finally { hideSpinner(); }

  const provMap = Object.fromEntries(provs.map(p => [p.id, p]));
  const opMap   = Object.fromEntries(ops.map(o => [o.id, o]));
  const cliMap  = Object.fromEntries(clientes.map(c => [c.id, c]));

  // KPIs globales
  const totalDebemos = deudas.filter(d => !_esPagado(d.status)).reduce((a, d) => a + (d.monto || 0), 0);
  const totalPagado  = deudas.filter(d => _esPagado(d.status)).reduce((a, d) => a + (d.monto || 0), 0);
  const totalGastos  = deudas.reduce((a, d) => a + (d.monto || 0), 0);
  const nProv        = new Set(deudas.map(d => d.provId).filter(Boolean)).size;

  // Agrupar deudas por OP
  const byOp = {};
  deudas.forEach(d => { const k = d.opId || '__sinop__'; (byOp[k] = byOp[k] || []).push(d); });

  const kpi = (label, val, color) =>
    `<div class="kpi"><div class="kpi-top"><div class="kpi-label">${label}</div></div><div class="kpi-value ${color || ''}">${fmxK(val)}</div></div>`;

  const bloqueOP = (opId, lista) => {
    const o   = opMap[opId] || {};
    const cli = cliMap[o.clienteId] || {};
    const precioVenta = o.cotizado || 0;                 // sin IVA
    const costo   = lista.reduce((a, d) => a + (d.monto || 0), 0);
    const pagado  = lista.filter(d => _esPagado(d.status)).reduce((a, d) => a + (d.monto || 0), 0);
    const debemos = costo - pagado;
    const utilidad = precioVenta - costo;
    const pctUtil  = precioVenta ? (utilidad / precioVenta * 100) : 0;
    const comisionEjec = o.ejec ? (utilidad * 0.075) : 0; // 7.5% sobre utilidad
    const utilDespues  = utilidad - comisionEjec;

    const filas = lista.map(d => {
      const prov = provMap[d.provId] || {};
      const nombre = prov.nombre || d.concepto || '—';
      const pag = _esPagado(d.status) ? (d.monto || 0) : 0;
      const deb = _esPagado(d.status) ? 0 : (d.monto || 0);
      return `<tr>
        <td>${esc(nombre)}<div style="font-size:10px;color:var(--gray400)">${esc(d.concepto) || ''}</div></td>
        <td class="monto">${fmx(d.monto)}</td>
        <td class="monto" style="color:${pag ? 'var(--green)' : 'var(--gray400)'}">${pag ? fmx(pag) : '—'}</td>
        <td class="monto" style="color:${deb ? 'var(--red)' : 'var(--gray400)'}">${deb ? fmx(deb) : '—'}</td>
        <td>${pillHTML(_esPagado(d.status) ? 'Pagado' : 'Pendiente')}</td>
      </tr>`;
    }).join('');

    return `<div class="panel" style="margin-bottom:16px">
      <div class="panel-hdr">
        <div class="panel-title"><span class="dot"></span>${esc(o.numero) || 'SIN OP'} · ${esc(cli.nombre) || (opId === '__sinop__' ? 'Sin OP asignada' : '—')}</div>
        <span class="tag ${debemos > 0 ? 'tag-red' : 'tag-green'}">${debemos > 0 ? 'DEBEMOS ' + fmxK(debemos) : 'AL DÍA'}</span>
      </div>
      <div class="panel-body">
        <table class="tbl"><thead><tr><th>PROVEEDOR</th><th>COTIZACIÓN</th><th>PAGADO</th><th>DEBEMOS</th><th>ESTATUS</th></tr></thead>
        <tbody>${filas}
          <tr style="border-top:2px solid var(--border)"><td style="font-weight:700">TOTAL GASTOS</td><td class="monto" style="font-weight:700">${fmx(costo)}</td><td class="monto" style="font-weight:700;color:var(--green)">${fmx(pagado)}</td><td class="monto" style="font-weight:700;color:var(--red)">${fmx(debemos)}</td><td></td></tr>
        </tbody></table>
        ${o.numero ? `<div style="display:flex;flex-wrap:wrap;gap:18px;margin-top:12px;padding:10px 12px;background:var(--cream);border-radius:8px;font-family:'JetBrains Mono',monospace;font-size:11px">
          <span>Precio de venta: <strong>${fmx(precioVenta)}</strong></span>
          <span>Costo de producción: <strong>${fmx(costo)}</strong></span>
          <span>Utilidad: <strong style="color:${utilidad >= 0 ? 'var(--green)' : 'var(--red)'}">${fmx(utilidad)}</strong></span>
          <span>% Utilidad: <strong>${pctUtil.toFixed(2)}%</strong></span>
          <span>Comisión 7.5%: <strong>${fmx(comisionEjec)}</strong></span>
          <span>Utilidad después de %: <strong style="color:var(--green)">${fmx(utilDespues)}</strong></span>
        </div>` : ''}
      </div>
    </div>`;
  };

  const ordenOps = Object.keys(byOp).sort((a, b) => {
    const da = byOp[a].filter(d => !_esPagado(d.status)).reduce((s, d) => s + (d.monto || 0), 0);
    const dbb = byOp[b].filter(d => !_esPagado(d.status)).reduce((s, d) => s + (d.monto || 0), 0);
    return dbb - da; // primero los que más debemos
  });

  root.innerHTML =
    phHTML('CONTROL FINANCIERO', 'Control de Pagos', 'Cuentas por pagar a proveedores por OP',
      `<button class="btn btn-ghost btn-sm" onclick="exportarControlPagosCSV()">${icoHTML('download')} Exportar</button>`)
    + `<div class="kpis" style="margin-bottom:20px">
        ${kpi('POR PAGAR (DEBEMOS)', totalDebemos, 'kv-red')}
        ${kpi('YA PAGADO', totalPagado, 'kv-green')}
        ${kpi('TOTAL GASTOS', totalGastos, '')}
        <div class="kpi"><div class="kpi-top"><div class="kpi-label">PROVEEDORES CON DEUDA</div></div><div class="kpi-value">${nProv}</div></div>
      </div>`
    + (ordenOps.length
        ? ordenOps.map(k => bloqueOP(k, byOp[k])).join('')
        : `<div class="panel"><div class="panel-body"><div class="kpi-bar-meta" style="padding:14px 0">SIN CUENTAS POR PAGAR REGISTRADAS. Registra pagos a proveedores desde Proveedores → Ver Deudas.</div></div></div>`);
}

function exportarControlPagosCSV() {
  Promise.all([db.deudas.list(), db.proveedores.list(), db.ops.list()]).then(([deudas, provs, ops]) => {
    const provMap = Object.fromEntries(provs.map(p => [p.id, p]));
    const opMap   = Object.fromEntries(ops.map(o => [o.id, o]));
    const filas = [['OP', 'Proveedor', 'Concepto', 'Cotización', 'Pagado', 'Debemos', 'Estatus']]
      .concat(deudas.map(d => {
        const o = opMap[d.opId] || {}; const prov = provMap[d.provId] || {};
        const pag = _esPagado(d.status) ? d.monto : 0; const deb = _esPagado(d.status) ? 0 : d.monto;
        return [o.numero || '', prov.nombre || '', d.concepto || '', d.monto || 0, pag || 0, deb || 0, d.status || ''];
      }));
    const csv = filas.map(f => f.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
    a.download = 'control-de-pagos.csv';
    a.click();
  }).catch(() => toast('Error al exportar', 'red'));
}
