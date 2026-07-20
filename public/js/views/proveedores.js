// ══════════════════════════════════════
// PROVEEDORES VIEW
// ══════════════════════════════════════
let _deudasFilterVal = 'todos';

function updateClabeLabel() {
  const banco = document.getElementById('prv-banco')?.value;
  const label = document.getElementById('prv-clabe-label');
  const inp   = document.getElementById('prv-clabe');
  if (!label || !inp) return;
  if (banco === 'Banorte') {
    label.innerHTML = '<span style="color:var(--amber)">⚠ BANORTE: NÚMERO DE CUENTA (no CLABE)</span>';
    inp.placeholder = 'No. de Cuenta Banorte';
  } else {
    label.textContent = 'CLABE INTERBANCARIA';
    inp.placeholder   = '18 dígitos';
  }
}

async function renderProveedores() {
  showSpinner();
  let provs, deudas;
  try {
    [provs, deudas] = await Promise.all([db.proveedores.list(), db.deudas.list().catch(() => [])]);
  } catch (e) {
    toast('Error al cargar proveedores', 'red');
    return;
  } finally {
    hideSpinner();
  }

  // Alert bar
  const deudasPend = deudas.filter(d => d.status === 'pendiente');
  const alertEl = document.getElementById('deudas-alert');
  if (alertEl) {
    if (deudasPend.length) {
      const total = deudasPend.reduce((a, d) => a + (d.monto || 0), 0);
      alertEl.innerHTML = `<div style="background:var(--white);border:1px solid var(--border);border-radius:10px;padding:14px 18px;display:flex;align-items:center;gap:14px;cursor:pointer;margin-bottom:16px" onclick="openM('deudas')">
        <div style="width:40px;height:40px;border-radius:10px;background:#FFF8F0;border:1px solid #F0DFC0;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--amber)">${icoHTML('doc',18)}</div>
        <div style="flex:1"><div style="font-size:13px;font-weight:600">Tienes ${deudasPend.length} pago(s) pendiente(s) a proveedores</div><div style="font-size:12px;color:var(--gray400);margin-top:2px">Total: ${fmx(total)} · Haz clic para ver el detalle</div></div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--gray400);white-space:nowrap">Ver detalle →</div>
      </div>`;
    } else {
      alertEl.innerHTML = '';
    }
  }

  // Table
  document.getElementById('prov-tbody').innerHTML = provs.map(p => {
    const deudasProv = deudas.filter(d => d.provId === p.id && d.status === 'pendiente');
    const totalDeuda = deudasProv.reduce((a, d) => a + (d.monto || 0), 0);
    const condTag = p.cond === 'Inmediato' ? 'gray' : p.cond === '30 días' ? 'amber' : 'red';
    return `<tr onclick="openDetalleProveedor('${p.id}')">
      <td><div style="font-weight:600">${esc(p.nombre)}</div><div style="font-size:11px;color:var(--gray400)">${esc(p.razon) || '—'}</div></td>
      <td><span class="tag tag-gray">${esc(p.servicio) || '—'}</span></td>
      <td class="mono" style="font-size:10px">${esc(p.rfc) || '—'}</td>
      <td><div style="font-size:12px">${esc(p.banco) || '—'}</div><div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--gray400)">${esc(p.clabe) || '—'}</div></td>
      <td><span class="tag tag-${condTag}">${(p.cond || '—').toUpperCase()}</span></td>
      <td>${p.emiteFactura ? '<span class="tag tag-green">SÍ ✓</span>' : '<span class="tag tag-gray">NO</span>'}</td>
      <td>${totalDeuda
        ? `<button class="btn btn-ghost btn-xs" style="color:var(--amber);border-color:var(--amber-bdr)" onclick="event.stopPropagation();openM('deudas')">${fmx(totalDeuda)}</button>`
        : '<span class="tag tag-green">Sin deuda ✓</span>'}</td>
      <td><button class="btn btn-ghost btn-xs" onclick="event.stopPropagation();openDetalleProveedor('${p.id}')">Ver</button></td>
    </tr>`;
  }).join('') || `<tr><td colspan="8"><div class="empty-state"><div>${icoHTML('truck',26)}</div><div>SIN PROVEEDORES</div></div></td></tr>`;
}

// ── Documentos del proveedor (leídos por IA) ──
let _provDocState = { csf: false, ec: false, oc: false };

async function analizarDocProv(tipo, input) {
  return _procesarDoc(tipo, input, {
    prefix: 'pdoc',
    state: _provDocState,
    onData(tipo, d, status, area) {
      if (tipo === 'csf') {
        if (d.rfc)         { const el = document.getElementById('prv-rfc');   if (el) el.value = d.rfc; }
        if (d.razonSocial) { const el = document.getElementById('prv-razon'); if (el && !el.value) el.value = d.razonSocial; }
        status.style.color = 'var(--green)';
        status.textContent = `✅ RFC: ${d.rfc || '—'} · ${d.razonSocial || ''}`;
      } else if (tipo === 'ec') {
        if (d.clabe) { const el = document.getElementById('prv-clabe'); if (el && !el.value) el.value = d.clabe; }
        status.style.color = 'var(--green)';
        status.textContent = `✅ ${d.banco || '—'} · CLABE: ${d.clabe || '—'} · Titular: ${d.titular || '—'}`;
      } else if (tipo === 'oc') {
        const positiva = d.sentido === 'POSITIVO';
        const vigente  = d.mesVigente;
        // Se acepta el documento; si no es positiva/vigente, se avisa en ámbar (no bloquea).
        if (!positiva || !vigente) {
          status.style.color = 'var(--amber)';
          status.textContent = '⚠ ' + (d.observaciones || (!positiva ? 'La opinión no es positiva' : 'La opinión no parece del mes en curso')) + ' — revisar';
        } else {
          status.style.color = 'var(--green)';
          status.textContent = `✅ Positiva · Fecha: ${d.fechaConsulta || '—'}`;
        }
      }
    },
  });
}

// Muestra/oculta la Opinión de Cumplimiento (solo persona moral) y la advertencia de excepción
function updateProvDocs() {
  const persona   = document.getElementById('prv-persona')?.value || 'moral';
  const excepcion = !!document.getElementById('prv-excepcion')?.checked;
  const ocWrap    = document.getElementById('pdoc-oc-wrap');
  const docsWrap  = document.getElementById('prv-docs');
  const warn      = document.getElementById('prv-excepcion-warn');

  // Opinión de Cumplimiento: solo aplica a Persona Moral
  if (ocWrap) ocWrap.style.display = persona === 'moral' ? '' : 'none';
  // Excepción: atenúa los documentos (ya no serán obligatorios) y muestra la advertencia
  if (docsWrap) { docsWrap.style.opacity = excepcion ? '.45' : '1'; docsWrap.style.pointerEvents = excepcion ? 'none' : 'auto'; }
  if (warn) warn.style.display = excepcion ? 'block' : 'none';
}

async function saveProveedor() {
  const nom = document.getElementById('prv-nombre').value.trim();
  if (!nom) { toast('El nombre es requerido', 'red'); return; }

  const persona   = document.getElementById('prv-persona')?.value || 'moral';
  const excepcion = !!document.getElementById('prv-excepcion')?.checked;

  // Validación de documentos (a menos que sea excepción)
  if (!excepcion) {
    const faltan = [];
    if (!_provDocState.csf) faltan.push('CSF');
    if (!_provDocState.ec)  faltan.push('Carátula bancaria');
    if (persona === 'moral' && !_provDocState.oc) faltan.push('Opinión de Cumplimiento (persona moral)');
    if (faltan.length) {
      toast('Faltan documentos: ' + faltan.join(', ') + '. O marca "Hacer excepción".', 'red');
      return;
    }
  }

  const facturaVal = document.getElementById('prv-factura')?.value || 'No — solo recibo';
  const marca = `[${persona === 'moral' ? 'Persona Moral' : 'Persona Física'}]${excepcion ? ' [EXCEPCIÓN: sin documentos completos — pago por vía alterna]' : ''}`;
  const notasUser = document.getElementById('prv-notas').value || '';
  const data = {
    nombre:       nom,
    razon:        document.getElementById('prv-razon').value || nom + ' SA de CV',
    rfc:          document.getElementById('prv-rfc').value || 'POR DEFINIR',
    banco:        document.getElementById('prv-banco').value,
    clabe:        document.getElementById('prv-clabe').value || '—',
    servicio:     document.getElementById('prv-servicio').value || 'General',
    cond:         document.getElementById('prv-cond').value,
    emiteFactura: facturaVal === 'true' && !excepcion,
    notas:        (marca + (notasUser ? ' · ' + notasUser : '')).trim(),
    contacto:     document.getElementById('prv-contacto').value || '',
    tel:          document.getElementById('prv-tel').value || '',
    email:        document.getElementById('prv-email').value || '',
  };

  showSpinner();
  try {
    await db.proveedores.create(data);
    closeM('nuevo-proveedor');
    ['prv-nombre','prv-razon','prv-rfc','prv-clabe','prv-servicio','prv-notas','prv-contacto','prv-tel','prv-email'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    // Resetear documentos y opciones del proveedor
    _provDocState = { csf: false, ec: false, oc: false };
    const exc = document.getElementById('prv-excepcion'); if (exc) exc.checked = false;
    ['pdoc-csf','pdoc-ec','pdoc-oc'].forEach(p => {
      const a = document.getElementById(p + '-area'); if (a) a.style.borderColor = '';
      const s = document.getElementById(p + '-status'); if (s) s.textContent = '';
    });
    updateProvDocs();
    toast('✓ Proveedor dado de alta');
    renderProveedores();
  } catch (e) {
    toast('Error al guardar: ' + e.message, 'red');
  } finally {
    hideSpinner();
  }
}

async function openDetalleProveedor(id) {
  showSpinner();
  let p, deudas, ops;
  try {
    [p, deudas, ops] = await Promise.all([
      db.proveedores.get(id),
      db.deudas.list().catch(() => []),
      db.ops.list(),
    ]);
  } catch (e) {
    toast('Error al cargar proveedor', 'red');
    return;
  } finally {
    hideSpinner();
  }

  STATE.selProv = id;
  const opMap = Object.fromEntries(ops.map(o => [o.id, o]));

  document.getElementById('dprv-rfc').textContent    = p.rfc || '—';
  document.getElementById('dprv-nombre').textContent = p.nombre;

  document.getElementById('dprv-info').innerHTML = `
    <div class="info-cell"><div class="info-cell-label">RAZÓN SOCIAL</div><div class="info-cell-val">${esc(p.razon) || '—'}</div></div>
    <div class="info-cell"><div class="info-cell-label">BANCO / CLABE</div><div class="info-cell-val">${esc(p.banco) || '—'}</div><div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--gray400)">${esc(p.clabe) || '—'}</div></div>
    <div class="info-cell"><div class="info-cell-label">SERVICIO</div><div class="info-cell-val">${esc(p.servicio) || '—'}</div></div>
    <div class="info-cell"><div class="info-cell-label">CONDICIONES · FACTURA</div><div class="info-cell-val">${esc(p.cond) || '—'} · ${p.emiteFactura ? 'Sí — emite factura' : 'No — solo recibo'}</div></div>`;

  const provDeudas = deudas.filter(d => d.provId === id);
  document.getElementById('dprv-deudas').innerHTML = provDeudas.length
    ? provDeudas.map(d => {
        const op = opMap[d.opId] || {};
        return `<div style="display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--border)">
          <div>
            <div style="font-size:12.5px;font-weight:500">${esc(d.concepto)}</div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--gray400)">${esc(op.numero) || '—'} · Vence ${esc(d.fechaAcordada) || '—'}</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <div style="font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:700">${fmx(d.monto)}</div>
            ${pillHTML(d.status === 'pagado' ? 'Pagado' : 'Pendiente')}
          </div>
        </div>`;
      }).join('')
    : '<div style="color:var(--gray400);font-size:12px;padding:8px 0">Sin deudas registradas con este proveedor.</div>';

  openM('detalle-proveedor');
}

// ── Deudas modal ────────────────────────
function filterDeudas(val, el) {
  _deudasFilterVal = val;
  document.querySelectorAll('#m-deudas .vsel-btn').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  renderDeudasModal();
}

async function renderDeudasModal() {
  showSpinner();
  let deudas, provs, ops;
  try {
    [deudas, provs, ops] = await Promise.all([
      db.deudas.list().catch(() => []),
      db.proveedores.list(),
      db.ops.list(),
    ]);
  } catch (e) {
    toast('Error al cargar deudas', 'red');
    return;
  } finally {
    hideSpinner();
  }

  const provFilter = document.getElementById('deudas-prov-filter')?.value || '';
  const provMap = Object.fromEntries(provs.map(p => [p.id, p]));
  const opMap   = Object.fromEntries(ops.map(o => [o.id, o]));

  // Populate prov filter select
  const dpf = document.getElementById('deudas-prov-filter');
  if (dpf && dpf.options.length <= 1) {
    dpf.innerHTML = '<option value="">Todos los proveedores</option>' + provs.map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('');
  }

  const list = deudas.filter(d =>
    (!provFilter || d.provId === provFilter) &&
    (_deudasFilterVal === 'todos' ||
     (_deudasFilterVal === 'pendiente' && d.status === 'pendiente') ||
     (_deudasFilterVal === 'pagado'    && d.status === 'pagado'))
  );

  const pend   = deudas.filter(d => d.status === 'pendiente');
  const pagadas = deudas.filter(d => d.status === 'pagado');
  const now = new Date();
  const venceSemana = pend.filter(d => {
    const dias = (new Date(d.fechaAcordada) - now) / (1000 * 60 * 60 * 24);
    return dias <= 7 && dias >= 0;
  });

  document.getElementById('deudas-kpis').innerHTML = `
    <div class="info-cell"><div class="info-cell-label">POR PAGAR</div><div style="font-family:'Bebas Neue',cursive;font-size:26px">${fmx(pend.reduce((a,d)=>a+(d.monto||0),0))}</div><div style="font-size:11px;color:var(--gray400)">${pend.length} proveedor(es)</div></div>
    <div class="info-cell" style="background:#FFF8F0;border:1px solid #F0DFC0"><div class="info-cell-label" style="color:var(--amber)">VENCE ESTA SEMANA</div><div style="font-family:'Bebas Neue',cursive;font-size:26px;color:var(--amber)">${fmx(venceSemana.reduce((a,d)=>a+(d.monto||0),0))}</div></div>
    <div class="info-cell" style="background:#F2FBF5;border:1px solid #C0DFC8"><div class="info-cell-label" style="color:var(--green)">PAGADO</div><div style="font-family:'Bebas Neue',cursive;font-size:26px;color:var(--green)">${fmx(pagadas.reduce((a,d)=>a+(d.monto||0),0))}</div></div>`;

  document.getElementById('deudas-cards').innerHTML = list.map(d => {
    const pv = provMap[d.provId] || {};
    const op = opMap[d.opId] || {};
    const isPagado = d.status === 'pagado';
    return `<div class="deuda-card" style="opacity:${isPagado ? '.6' : '1'}">
      <div class="deuda-hdr" style="background:${isPagado ? 'var(--cream)' : 'var(--white)'}">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:36px;height:36px;border-radius:8px;background:var(--cream);border:1px solid var(--border-d);display:flex;align-items:center;justify-content:center;font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;color:var(--gray600)">${esc(pv.nombre ? pv.nombre.split(' ').map(x=>x[0]).join('').slice(0,2) : '??')}</div>
          <div><div style="font-size:13px;font-weight:600">${esc(pv.nombre) || '—'}</div><div style="font-size:11px;color:var(--gray400)">${esc(pv.servicio) || '—'}</div></div>
        </div>
        <div style="text-align:right">
          <div style="font-family:'Bebas Neue',cursive;font-size:22px;${isPagado ? 'text-decoration:line-through;color:var(--gray400)' : ''}">${fmx(d.monto)}</div>
          <div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:${isPagado ? 'var(--green)' : 'var(--gray400)'}">${isPagado ? 'Pagado ✓' : 'Vence ' + (esc(d.fechaAcordada) || '—')}</div>
        </div>
      </div>
      ${!isPagado ? `<div class="deuda-body">
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px"><span class="deuda-tag">OP: ${esc(op.numero) || '—'}</span><span class="deuda-tag">${esc(op.desc) || '—'}</span></div>
        <div style="font-size:12px;color:var(--gray600);margin-bottom:10px">${esc(d.concepto)}</div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="btn btn-sm" style="background:var(--green);color:var(--white)" onclick="marcarDeudaPagada('${d.id}')">Marcar como pagado</button>
        </div>
      </div>` : ''}
    </div>`;
  }).join('') || '<div class="empty-state"><div>✓</div><div>SIN DEUDAS EN ESTE FILTRO</div></div>';
}

async function marcarDeudaPagada(id) {
  showSpinner();
  try {
    await db.deudas.update(id, { status: 'pagado' });
    toast('✓ Pago registrado a proveedor');
    renderDeudasModal();
    renderProveedores();
  } catch (e) {
    toast('Error al actualizar deuda', 'red');
  } finally {
    hideSpinner();
  }
}

async function saveDeuda() {
  const provId   = document.getElementById('nd-prov')?.value;
  const opId     = document.getElementById('nd-op')?.value || null;
  const concepto = document.getElementById('nd-concepto')?.value.trim();
  if (!concepto) { toast('El concepto es requerido', 'red'); return; }

  const data = {
    provId:       provId || '',
    opId:         opId || '',
    concepto,
    monto:        parseFloat(document.getElementById('nd-monto')?.value) || 0,
    fechaAcordada: document.getElementById('nd-fecha')?.value || new Date().toISOString().split('T')[0],
    status:       'pendiente',
  };

  showSpinner();
  try {
    await db.deudas.create(data);
    closeM('nueva-deuda');
    ['nd-concepto','nd-monto','nd-fecha'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    toast('✓ Deuda registrada');
    openM('deudas');
  } catch (e) {
    toast('Error al guardar deuda: ' + e.message, 'red');
  } finally {
    hideSpinner();
  }
}
