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
  // Cada llamada se protege por separado: si una falla (timeout/red hacia
  // la base de datos), la vista sigue mostrando lo que sí cargó en vez de un
  // "Error al cargar OPs" genérico que dejaba la pantalla en blanco.
  const [ops, clientes] = await Promise.all([
    db.ops.list().catch(() => { toast('No se pudieron cargar las OPs', 'red'); return []; }),
    db.clientes.list().catch(() => { toast('No se pudieron cargar los clientes', 'red'); return []; }),
  ]);
  hideSpinner();

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
          <td><div class="td-acciones">
            <button class="btn btn-ghost btn-xs" onclick="event.stopPropagation();openDetalleOP('${o.id}')">Ver</button>
            ${isExec ? `<button class="btn btn-primary btn-xs" onclick="event.stopPropagation();openEDR('${o.id}')">EdR</button>` : ''}
          </div></td>
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
  // El campo captura el TOTAL con IVA; se guarda el subtotal neto sin IVA.
  const totalConIvaOP = parseFloat(document.getElementById('op-monto').value) || 0;
  const monto  = netoSinIva(totalConIvaOP);
  // "Cotización" no es un estatus de OP: una OP puede tener varias cotizaciones
  // ligadas sin que eso cambie su estatus operativo. Toda OP nueva nace
  // En Producción; solo se mueve a Ejecutado manualmente cuando el evento ya pasó.
  const status = 'En Producción';

  // La OP hereda los 3 roles comerciales del cliente. El "dueño" operativo de la
  // OP (Ejecutivo) es SIEMPRE el Ejecutivo asignado del cliente. Natalia y el
  // Ejec. de cuenta conservan acceso por jerarquía (ver filtroRolesla base de datos backend).
  let cli = null;
  if (cliId && cliId !== '__interno__') { try { cli = await getClienteById(cliId); } catch (_) {} }
  const propietario  = cli?.propietario  || '';
  const ejecCuenta   = cli?.ejecCuenta   || '';
  const ejecAsignado = cli?.ejecAsignado || cli?.ejec || '';
  const ejec = ejecAsignado || document.getElementById('op-ejec').value;

  const data = {
    numero,
    desc,
    clienteId:  cliId,
    ejec,
    propietario,
    ejecCuenta,
    ejecAsignado,
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
    const doOpen = confirm(`OP creada: ${numero}\n\n⚠ No tiene monto cotizado todavía.\n\n¿Deseas subir la cotización (PDF/Excel) ahora?`);
    if (doOpen) {
      setTimeout(() => openSubirCotizacion(newOP?.id), 200);
    }
  } else {
    toast('✓ OP creada: ' + numero);
  }
}

async function openDetalleOP(id) {
  showSpinner();
  // La OP misma (o) es indispensable — sin ella no hay nada que mostrar. Los
  // demás datos se degradan solos si fallan (timeout/red hacia la base de datos) en vez
  // de tumbar el modal completo con un "Error al cargar OP" genérico.
  let o, clientes, pagos, cots;
  try {
    o = await db.ops.get(id);
  } catch (e) {
    hideSpinner();
    toast('Error al cargar OP', 'red');
    return;
  }
  [clientes, pagos, cots] = await Promise.all([
    db.clientes.list().catch(() => { toast('No se pudieron cargar los clientes', 'red'); return []; }),
    db.pagos.list().catch(() => []),
    db.cotizaciones.list().catch(() => []),
  ]);
  hideSpinner();

  STATE.selOP = id;
  const cliMap = Object.fromEntries(clientes.map(c => [c.id, c]));
  const cli = cliMap[o.clienteId] || {};

  document.getElementById('dop-num').textContent   = o.numero;
  document.getElementById('dop-title').textContent = o.desc + ' — ' + (cli.nombre || '—');

  document.getElementById('dop-info').innerHTML = `
    <div class="info-cell"><div class="info-cell-label">CLIENTE</div><div class="info-cell-val">${esc(cli.nombre) || '—'}</div><div style="font-size:11px;color:var(--gray400)">${esc(cli.contacto) || '—'}</div></div>
    <div class="info-cell"><div class="info-cell-label">FECHA EVENTO</div><div class="info-cell-val">${esc(o.fechaEvento) || '—'}</div><div style="font-size:11px;color:var(--gray400)">Ejecutivo: ${esc(o.ejec) || '—'}</div></div>`;

const _sub = o.cotizado || 0, _iva = _sub * 0.16, _totIva = _sub + _iva;
  document.getElementById('dop-montos').innerHTML = `
    <div class="info-cell" style="text-align:center"><div class="info-cell-label">SUBTOTAL</div><div style="font-family:'Bebas Neue',cursive;font-size:22px">${fmx(_sub)}</div></div>
    <div class="info-cell" style="text-align:center;background:var(--green-dim);border:1px solid var(--green-bdr)"><div class="info-cell-label" style="color:var(--green)">COBRADO</div><div style="font-family:'Bebas Neue',cursive;font-size:22px;color:var(--green)">${fmx(o.cobrado)}</div></div>
    <div class="info-cell" style="text-align:center;background:var(--red-dim);border:1px solid var(--red-border)"><div class="info-cell-label" style="color:var(--red)">PENDIENTE</div><div style="font-family:'Bebas Neue',cursive;font-size:22px;color:var(--red)">${fmx(Math.max(0, _totIva - (o.cobrado||0)))}</div></div>`;
  // Línea de IVA — id fijo y reemplazo (no insertAdjacentHTML repetido), para
  // que reabrir la misma OP varias veces no acumule filas duplicadas debajo
  // de #dop-montos (el contenedor del modal nunca se limpia entre aperturas).
  // Caption de IVA — pertenece a las tarjetas de montos (proximidad = relación),
  // por eso queda pegado a ellas (gap chico arriba) y la separación grande la
  // aporta el .sect-label de la siguiente sección. Antes usaba margin-top
  // negativo, que lo encimaba sobre las tarjetas.
  const ivaLineHTML = `<div id="dop-iva-line" style="display:flex;justify-content:space-between;font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--gray600);margin:var(--gap-sm) 0 0;padding:0 4px"><span>IVA 16%: <strong>${fmx(_iva)}</strong></span><span>TOTAL CON IVA: <strong style="color:var(--black)">${fmx(_totIva)}</strong></span></div>`;
  const existingIvaLine = document.getElementById('dop-iva-line');
  if (existingIvaLine) existingIvaLine.outerHTML = ivaLineHTML;
  else document.getElementById('dop-montos').insertAdjacentHTML('afterend', ivaLineHTML);

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
    : `<div style="color:var(--gray400);font-size:12px">Sin pagos registrados. <span style="color:var(--red);cursor:pointer" onclick="abrirNuevoPagoParaOP('${id}')">Registrar pago →</span></div>`;

  // Bono en la OP: SIEMPRE manual y SOLO aplica al Ejecutivo asignado (quien
  // lleva el evento), y solo si está en BONO_ELEGIBLES. Lo captura Dirección.
  // Un único campo — se renderiza en #dop-bono-wrap, un contenedor dedicado
  // que SIEMPRE se limpia primero (nunca insertAdjacentHTML sobre un hermano,
  // que apilaba una caja de bono nueva cada vez que se reabría la misma OP).
  const user = sesionActual();
  const bonoWrap = document.getElementById('dop-bono-wrap');
  const aplicaBono = BONO_ELEGIBLES.includes(o.ejec);
  if (bonoWrap) {
    if (aplicaBono) {
      const puedeEditar = user?.role === 'admin';
      bonoWrap.innerHTML = `<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border)">
          <div class="info-cell-label" style="margin-bottom:6px">BONO · ${esc(o.ejec)} (CAPTURA MANUAL)</div>
          ${puedeEditar
            ? `<div style="display:flex;gap:8px;align-items:center">
                 <input class="fi" id="dop-bono" style="flex:1" placeholder="Monto o % del bono" value="${esc(o.bono) || ''}">
                 <button class="btn btn-primary btn-sm" onclick="guardarBonoOP('${o.id}')">Guardar bono</button>
               </div>`
            : `<div class="info-cell-val">${esc(o.bono) || '—'}</div><div style="font-size:11px;color:var(--gray400)">Solo Dirección captura el bono</div>`}
        </div>`;
    } else {
      bonoWrap.innerHTML = '';
    }
  }

  // Todas las versiones de cotización (PDF/Excel) cargadas para esta OP.
  const opCots = (cots || []).filter(ct => ct.opId === id);
  const _fileTagOP = (arr, label, icon) => {
    const f = (arr || [])[0];
    if (!f || !f.url) return `<span class="tag" style="opacity:.45">SIN ${label}</span>`;
    return `<a href="${esc(f.url)}" target="_blank" rel="noopener" class="tag tag-green" style="text-decoration:none" onclick="event.stopPropagation()">${icon} ${label} ↓</a>`;
  };
  const dopCotHost = document.getElementById('dop-cotizaciones');
  if (dopCotHost) {
    dopCotHost.innerHTML = opCots.length
      ? opCots.map(ct => `
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 0;border-bottom:1px solid var(--border);cursor:pointer" onclick="openVerCotizacion('${ct.id}')">
            <div style="font-size:12.5px;font-weight:600">${esc((typeof _etiquetaCot === 'function') ? _etiquetaCot(ct, o) : ct.cotId)}</div>
            <div style="display:flex;gap:5px;flex-wrap:wrap">${_fileTagOP(ct.pdf, 'PDF', icoHTML('file', 11))}${_fileTagOP(ct.excel, 'EXCEL', icoHTML('grid', 11))}</div>
          </div>`).join('')
      : '<div style="color:var(--gray400);font-size:12px">Sin cotizaciones cargadas para esta OP</div>';
  }

  const statuses = ['En Producción', 'Ejecutado'];
  document.getElementById('dop-acciones').innerHTML =
    statuses.filter(s => s !== o.status).map(s => `<button class="btn btn-ghost btn-sm" onclick="changeOPStatus('${o.id}','${s}')">${s}</button>`).join('') +
    `<button class="btn btn-ghost btn-sm" onclick="abrirNuevoPagoParaOP('${o.id}')">+ Registrar pago</button>` +
    `<button class="btn btn-ghost btn-sm" onclick="openCotForOP()">+ Nueva cotización</button>`;

  openM('detalle-op');
}

async function changeOPStatus(id, status) {
  // La Utilidad ya NO se captura ni se autocompleta aquí — el backend la
  // calcula siempre como cotizado − costos reales de proveedores (ver
  // api/ops.js withUtilidadReal). Solo cambiamos el estatus.
  const update = { status };
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

// Estado de Resultados — replica EXACTA de la hoja de cálculo de Oscar
// (confirmado dato por dato con el usuario, ver conversación):
//  - Tabla de proveedores en CON IVA (Cotización/Pagado/Debemos) + fila de
//    totales sin IVA (÷1.16), que es la que de verdad alimenta la Utilidad.
//  - PAGO CLIENTE = cobros NO marcados como Extra. EXTRAS = cobros SÍ
//    marcados como Extra (fuera de la cotización original). REMANENTE =
//    PAGO CLIENTE + EXTRAS (por definición, igual que PAGADO — se muestra
//    como renglón aparte porque así viene en la hoja original).
//  - Utilidad = Precio de venta (sin IVA) − Costo de producción (sin IVA).
//    La Comisión del Ejecutivo NUNCA resta del costo de producción — se resta
//    directo de la Utilidad (confirmado). Utilidad después de comisión = la
//    que realmente se reparte.
async function openEDR(id) {
  showSpinner();
  let o, clientes, deudas, proveedores, pagos;
  try {
    [o, clientes, deudas, proveedores, pagos] = await Promise.all([
      db.ops.get(id),
      db.clientes.list(),
      db.deudas.list().catch(() => []),
      db.proveedores.list(),
      db.pagos.list().catch(() => []),
    ]);
  } catch (e) {
    toast('Error al cargar EdR', 'red');
    return;
  } finally {
    hideSpinner();
  }

  STATE.selOP = id;
  const provMap = Object.fromEntries(proveedores.map(p => [p.id, p]));

  document.getElementById('edr-num').textContent   = o.numero + ' · ESTADO DE RESULTADOS';
  document.getElementById('edr-title').textContent = o.desc; // textContent — seguro sin escapar

  // ── Tabla de proveedores (con IVA) ──
  const opDeudas = deudas.filter(d => d.opId === id);
  const tbody = document.getElementById('edr-tbody');
  tbody.innerHTML = opDeudas.length
    ? opDeudas.map(d => {
        const pv = provMap[d.provId] || {};
        const cotizacion = efectivoDeuda(d);
        const pagado = d.pagadoConIva || 0;
        const debemos = d.debemosConIva ?? 0;
        return `<tr style="cursor:${debemos > 0 ? 'pointer' : 'default'}" onclick="${debemos > 0 ? `abrirAbonoDeuda('${d.id}')` : ''}">
          <td>${esc(pv.nombre) || '—'}<div style="font-size:10px;color:var(--gray400)">${esc(d.concepto)}</div></td>
          <td style="text-align:right" class="mono">${fmx(cotizacion)}</td>
          <td style="text-align:right;color:var(--green)" class="mono">${fmx(pagado)}</td>
          <td style="text-align:right;color:${debemos ? 'var(--red)' : 'var(--gray400)'}" class="mono">${fmx(debemos)}</td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="4" style="text-align:center;color:var(--gray400);padding:16px;font-size:12px">Sin costos de proveedores registrados.<br><span style="color:var(--red);cursor:pointer" onclick="abrirNuevaDeudaParaOP('${id}')">+ Registrar pago a proveedor →</span></td></tr>`;

  const totCotizConIva = opDeudas.reduce((a, d) => a + efectivoDeuda(d), 0);
  const totPagadoConIva = opDeudas.reduce((a, d) => a + (d.pagadoConIva || 0), 0);
  const totDebemosConIva = opDeudas.reduce((a, d) => a + (d.debemosConIva ?? 0), 0);
  const totCotizNeto = opDeudas.reduce((a, d) => a + (d.monto || 0), 0);
  const totPagadoNeto = opDeudas.reduce((a, d) => a + (d.pagado || 0), 0);
  const totDebemosNeto = Math.max(0, totCotizNeto - totPagadoNeto);

  document.getElementById('edr-tfoot').innerHTML = opDeudas.length ? `
    <tr style="border-top:2px solid var(--border-d)"><td style="font-weight:700">TOTAL GASTOS</td><td style="text-align:right;font-weight:700" class="mono">${fmx(totCotizConIva)}</td><td style="text-align:right;font-weight:700;color:var(--green)" class="mono">${fmx(totPagadoConIva)}</td><td style="text-align:right;font-weight:700;color:var(--red)" class="mono">${fmx(totDebemosConIva)}</td></tr>
    <tr><td style="font-size:11px;color:var(--gray400)">TOTAL SIN IVA</td><td style="text-align:right;font-size:11px;color:var(--gray400)" class="mono">${fmx(totCotizNeto)}</td><td style="text-align:right;font-size:11px;color:var(--gray400)" class="mono">${fmx(totPagadoNeto)}</td><td style="text-align:right;font-size:11px;color:var(--gray400)" class="mono">${fmx(totDebemosNeto)}</td></tr>
  ` : '';

  // ── Cobranza: Pago Cliente / Extras / Pagado / Remanente ──
  const opCobrosPagados = pagos.filter(p => p.opId === id && p.tipo === 'Cobro a cliente' && p.status === 'Pagado');
  const pagoCliente = opCobrosPagados.filter(p => !p.extra).reduce((a, p) => a + (p.monto || 0), 0);
  const extras      = opCobrosPagados.filter(p => p.extra).reduce((a, p) => a + (p.monto || 0), 0);
  const pagadoTotal = pagoCliente + extras;
  const remanente    = pagoCliente + extras; // por definición, igual a Pagado

  document.getElementById('edr-cobranza').innerHTML = `
    <div class="info-grid" style="grid-template-columns:1fr 1fr">
      <div class="info-cell"><div class="info-cell-label">PAGO CLIENTE</div><div class="info-cell-val mono">${fmx(pagoCliente)}</div></div>
      <div class="info-cell"><div class="info-cell-label">PAGADO</div><div class="info-cell-val mono">${fmx(pagadoTotal)}</div></div>
      <div class="info-cell"><div class="info-cell-label">EXTRAS</div><div class="info-cell-val mono">${fmx(extras)}</div><div style="font-size:10px;color:var(--gray400)">Fuera de cotización</div></div>
      <div class="info-cell"><div class="info-cell-label">REMANENTE</div><div class="info-cell-val mono">${fmx(remanente)}</div></div>
    </div>`;

  // ── Resultado del evento (sin IVA) ──
  const margen = o.cotizado > 0 ? Math.round((o.utilidad || 0) / o.cotizado * 100 * 100) / 100 : 0;
  document.getElementById('edr-evento-label').textContent = esc(o.numero) + ' · ' + esc(o.desc || '');
  // % real de esta OP (heredado del cliente — Regla 2 = 15%, Externo = manual).
  // La comisión NUNCA resta del costo de producción (confirmado) — se resta
  // directo de la Utilidad. Para Eduardo/Alfredo (comision=0) su 7.5% no se
  // paga, se queda como utilidad, así que no aparece ninguna línea.
  const comisionPct = Number(o.comision) || 0;
  const comisionMonto = comisionPct > 0 ? (o.utilidad || 0) * (comisionPct / 100) : 0;
  const utilDespues = (o.utilidad || 0) - comisionMonto;

  document.getElementById('edr-resultados').innerHTML = `
    <div class="info-grid" style="grid-template-columns:1fr 1fr">
      <div class="info-cell"><div class="info-cell-label">PRECIO DE VENTA</div><div class="info-cell-val mono">${fmx(o.cotizado)}</div></div>
      <div class="info-cell"><div class="info-cell-label">COSTO PRODUCCIÓN</div><div class="info-cell-val mono">${fmx(totCotizNeto)}</div></div>
      <div class="info-cell" style="background:var(--green-dim);border:1px solid var(--green-bdr)"><div class="info-cell-label" style="color:var(--green)">UTILIDAD</div><div class="info-cell-val mono" style="color:var(--green)">${fmx(o.utilidad)}</div></div>
      <div class="info-cell"><div class="info-cell-label">% UTILIDAD</div><div class="info-cell-val mono">${margen}%</div></div>
      ${comisionPct > 0 ? `<div class="info-cell"><div class="info-cell-label">COMISIÓN ${comisionPct}%</div><div class="info-cell-val mono">${fmx(comisionMonto)}</div></div>` : ''}
      <div class="info-cell" style="background:var(--green-dim);border:1px solid var(--green-bdr)"><div class="info-cell-label" style="color:var(--green)">UTILIDAD DESPUÉS DE COMISIÓN</div><div class="info-cell-val mono" style="color:var(--green)">${fmx(utilDespues)}</div></div>
    </div>`;

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

// openCotForOP se define en views/cotizaciones.js (abre el modal de subida de archivos).

// ══════════════════════════════════════
// EDITAR OP (oficina total) — reasignar ejecutivo, estatus, montos
// Código: CODIGOCLIENTE-01, -02, -03... Se asigna UNA vez al crear la OP (ver
// buildOPNum en app.js) y YA NO cambia por reasignar ejecutivo — el número es
// el identificador fijo del proyecto/evento para ese cliente.
// ══════════════════════════════════════
async function openEditarOP() {
  const id = STATE.selOP;
  if (!id) return;
  if (!soyOficinaTotal()) { toast('Solo Dirección y Oscar pueden editar la OP', 'red'); return; }
  showSpinner();
  let o, clientes;
  try {
    [o, clientes] = await Promise.all([db.ops.get(id), db.clientes.list()]);
  } catch (e) {
    toast('Error al cargar OP', 'red');
    return;
  } finally { hideSpinner(); }

  const cli = clientes.find(c => c.id === o.clienteId) || null;
  STATE._editOP = { id, numero: o.numero, cliente: cli };

  document.getElementById('eop-desc').value   = o.desc || '';
  document.getElementById('eop-fecha').value  = o.fechaEvento || '';
  document.getElementById('eop-status').value = o.status || 'En Producción';
  // El campo muestra el TOTAL con IVA (el interno 'cotizado' es el subtotal neto).
  document.getElementById('eop-monto').value  = totalConIva(o.cotizado || 0);
  _previewEopIva();
  document.getElementById('eop-num').value    = o.numero || '';

  document.getElementById('eop-propietario').innerHTML  = personaOptions(o.propietario  || cli?.propietario  || '', PERSONAS_PROPIETARIO);
  document.getElementById('eop-ejeccuenta').innerHTML   = personaOptions(o.ejecCuenta   || cli?.ejecCuenta   || '', PERSONAS_EJECUTIVO);
  document.getElementById('eop-ejecasignado').innerHTML = personaOptions(o.ejecAsignado || o.ejec || cli?.ejecAsignado || '', PERSONAS_EJECUTIVO);
  // El propietario NUNCA cambia ni se reasigna, y el ejec. de cuenta se deriva
  // de él → ambos quedan bloqueados. Solo el Ejecutivo ASIGNADO es editable.
  document.getElementById('eop-propietario').disabled = true;
  document.getElementById('eop-ejeccuenta').disabled  = true;

  closeM('detalle-op');
  setTimeout(() => openM('editar-op'), 200);
}

async function saveEditarOP() {
  const st = STATE._editOP;
  if (!st) return;
  const ejecAsignado = document.getElementById('eop-ejecasignado').value;
  const desc   = document.getElementById('eop-desc').value.trim();
  if (!desc) { toast('La descripción es requerida', 'red'); return; }

  const data = {
    // El número (código) NO se toca al reasignar ejecutivo — es fijo por proyecto.
    desc,
    status:       document.getElementById('eop-status').value,
    // El campo trae el TOTAL con IVA; se guarda el subtotal neto sin IVA.
    cotizado:     netoSinIva(parseFloat(document.getElementById('eop-monto').value) || 0),
    // Propietario y ejec. de cuenta NO se mandan: son inmutables (el backend los
    // ignora de todos modos). Solo se reasigna el Ejecutivo ASIGNADO.
    ejecAsignado,
    ejec:         ejecAsignado, // ejecutivo asignado = quien ejecuta/lleva el proyecto (para el bono)
  };
  const fecha = document.getElementById('eop-fecha').value;
  if (fecha) data.fechaEvento = fecha;

  showSpinner();
  try {
    await db.ops.update(st.id, data);
    closeM('editar-op');
    STATE._editOP = null;
    toast('✓ OP actualizada: ' + st.numero);
    renderOPs();
    updateBadges();
  } catch (e) {
    toast('Error al guardar OP: ' + e.message, 'red');
  } finally { hideSpinner(); }
}

// ── Exportar Estado de Resultados (EdR) como PDF imprimible — mismos números
// exactos que el modal (ver openEDR): proveedores en con IVA + resumen sin IVA.
async function exportEDR() {
  const opId = STATE.selOP;
  if (!opId) return;

  const [ops, clientes, deudas, pagos, proveedores] = await Promise.all([
    db.ops.list(), db.clientes.list(),
    db.deudas.list().catch(() => []), db.pagos.list().catch(() => []),
    db.proveedores.list().catch(() => []),
  ]);
  const o   = ops.find(x => x.id === opId) || {};
  const cli = clientes.find(x => x.id === o.clienteId) || {};
  const provMap = Object.fromEntries(proveedores.map(p => [p.id, p]));
  const opDeudas = deudas.filter(d => d.opId === opId);
  const opCobrosPagados = pagos.filter(p => p.opId === opId && p.tipo === 'Cobro a cliente' && p.status === 'Pagado');

  const pagoCliente = opCobrosPagados.filter(p => !p.extra).reduce((a, p) => a + (p.monto || 0), 0);
  const extras      = opCobrosPagados.filter(p => p.extra).reduce((a, p) => a + (p.monto || 0), 0);
  const pagadoTotal = pagoCliente + extras;
  const costos      = opDeudas.reduce((a, d) => a + (d.monto || 0), 0); // sin IVA
  const utilidad    = o.utilidad || 0; // única fuente de verdad: la calcula el servidor (withUtilidadReal en api/ops.js)
  const comisionPct = Number(o.comision) || 0;
  const comisionMonto = comisionPct > 0 ? utilidad * (comisionPct / 100) : 0;

  const filas = opDeudas.map(d => `
    <tr>
      <td>${esc(provMap[d.provId]?.nombre || '—')}</td>
      <td>${esc(d.concepto || '—')}</td>
      <td style="text-align:right">$${Math.round(efectivoDeuda(d)).toLocaleString('es-MX')}</td>
      <td style="text-align:right" class="green">$${Math.round(d.pagadoConIva || 0).toLocaleString('es-MX')}</td>
      <td style="text-align:right" class="red">$${Math.round(d.debemosConIva || 0).toLocaleString('es-MX')}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html><html lang="es"><head>
    <meta charset="UTF-8">
    <title>EDR ${esc(o.numero)} — ${esc(cli.nombre)}</title>
    <style>
      body { font-family: Arial, sans-serif; font-size: 12px; color: #333; margin: 32px; }
      h1 { font-size: 20px; margin: 0 0 4px; } h2 { font-size: 13px; color: #666; margin: 0 0 24px; }
      table { width: 100%; border-collapse: collapse; margin-top: 16px; }
      th { background: #f4f4f0; text-align: left; padding: 8px 10px; font-size: 11px; letter-spacing: .08em; }
      td { padding: 7px 10px; border-bottom: 1px solid #e5e5e5; }
      .total { font-size: 15px; font-weight: 700; }
      .green { color: #1a6b3c; } .red { color: #CC2200; }
    </style>
  </head><body>
    <h1>${esc(o.numero)} · Estado de Resultados</h1>
    <h2>${esc(cli.nombre || 'OP Interna')} — ${esc(o.desc)}</h2>
    <table>
      <tr><th>CONCEPTO</th><th style="text-align:right">MONTO</th></tr>
      <tr><td>Precio de venta (sin IVA)</td><td style="text-align:right">$${Math.round(o.cotizado||0).toLocaleString('es-MX')}</td></tr>
      <tr><td>Pago cliente</td><td style="text-align:right" class="green">$${Math.round(pagoCliente).toLocaleString('es-MX')}</td></tr>
      <tr><td>Extras (fuera de cotización)</td><td style="text-align:right" class="green">$${Math.round(extras).toLocaleString('es-MX')}</td></tr>
      <tr><td>Pagado (total cobrado)</td><td style="text-align:right" class="green">$${Math.round(pagadoTotal).toLocaleString('es-MX')}</td></tr>
      <tr><td>Costo de producción (sin IVA)</td><td style="text-align:right" class="red">$${Math.round(costos).toLocaleString('es-MX')}</td></tr>
      <tr><td class="total">Utilidad</td><td style="text-align:right" class="total ${utilidad>=0?'green':'red'}">$${Math.round(utilidad).toLocaleString('es-MX')}</td></tr>
      ${comisionPct > 0 ? `<tr><td>Comisión ejecutivo (${comisionPct}%)</td><td style="text-align:right">$${Math.round(comisionMonto).toLocaleString('es-MX')}</td></tr>
      <tr><td class="total">Utilidad después de comisión</td><td style="text-align:right" class="total green">$${Math.round(utilidad - comisionMonto).toLocaleString('es-MX')}</td></tr>` : ''}
    </table>
    ${opDeudas.length ? `<table style="margin-top:24px">
      <tr><th>PROVEEDOR</th><th>CONCEPTO</th><th style="text-align:right">COTIZACIÓN</th><th style="text-align:right">PAGADO</th><th style="text-align:right">DEBEMOS</th></tr>
      ${filas}
    </table>` : ''}
    <p style="margin-top:32px;font-size:10px;color:#999">Generado el ${new Date().toLocaleString('es-MX')} · Actidea Continnuo</p>
  </body></html>`;

  const win = window.open('', '_blank');
  win.document.write(html);
  win.document.close();
  setTimeout(() => win.print(), 400);
}

async function guardarBonoOP(id) {
  const bono = document.getElementById('dop-bono')?.value || '';
  try {
    await db.ops.update(id, { bono });
    toast('✓ Bono guardado');
    // Antes se guardaba pero la pantalla (el modal abierto y la lista de OPs)
    // se quedaba mostrando el valor viejo hasta F5 — se refresca de inmediato.
    openDetalleOP(id);
    if (typeof renderOPs === 'function' && document.getElementById('view-ops')?.classList.contains('active')) renderOPs();
  } catch (e) { toast('Error al guardar bono: ' + e.message, 'red'); }
}
