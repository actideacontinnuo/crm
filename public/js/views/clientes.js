// ══════════════════════════════════════
// CLIENTES VIEW
// ══════════════════════════════════════
let _docState = { csf: false, oc: false, ec: false };

async function analizarDoc(tipo, input) {
  const file = input.files[0];
  if (!file) return;

  const area   = document.getElementById(`doc-${tipo}-area`);
  const status = document.getElementById(`doc-${tipo}-status`);

  area.innerHTML   = '⏳ Analizando con IA…';
  area.style.borderColor = 'var(--amber)';
  status.textContent     = '';

  const form = new FormData();
  form.append('file', file);

  try {
    const res  = await fetch(`/api/vision/${tipo}`, { method: 'POST', body: form });
    const json = await res.json();

    if (!res.ok || json.error) {
      throw new Error(json.error || 'Error en el servidor');
    }

    const d = json.data;

    if (!d.valido) {
      area.innerHTML = '❌ Documento no válido';
      area.style.borderColor = 'var(--red)';
      status.style.color = 'var(--red)';
      status.textContent = d.observaciones || 'No se pudo validar el documento';
      return;
    }

    // Auto-fill fields based on document type
    if (tipo === 'csf') {
      if (d.rfc)         { const el = document.getElementById('nc-rfc');   if (el) el.value = d.rfc; }
      if (d.razonSocial) { const el = document.getElementById('nc-razon'); if (el) el.value = d.razonSocial; }
      if (d.direccion)   { const el = document.getElementById('nc-dir');   if (el) el.value = d.direccion; }
      status.style.color = 'var(--green)';
      status.textContent = `✅ RFC: ${d.rfc || '—'} · ${d.razonSocial || ''} · Régimen: ${d.regimenFiscal || '—'}`;
    } else if (tipo === 'oc') {
      const positiva = d.sentido === 'POSITIVO';
      const vigente  = d.mesVigente;
      if (!positiva || !vigente) {
        area.innerHTML = '⚠️ Opinión no válida';
        area.style.borderColor = 'var(--red)';
        status.style.color = 'var(--red)';
        status.textContent = d.observaciones || (!positiva ? 'La opinión no es positiva' : 'La opinión está vencida');
        return;
      }
      status.style.color = 'var(--green)';
      status.textContent = `✅ Positiva · Fecha: ${d.fechaConsulta || '—'} · ${d.nombre || ''}`;
    } else if (tipo === 'ec') {
      status.style.color = 'var(--green)';
      status.textContent = `✅ Banco: ${d.banco || '—'} · CLABE: ${d.clabe || '—'} · Titular: ${d.titular || '—'}`;
      // Store bank data for saving in Docs field
      _docState._ecData = { banco: d.banco, clabe: d.clabe, titular: d.titular };
    }

    area.innerHTML = `✅ ${esc(file.name)}`;
    area.style.borderColor = 'var(--green)';
    _docState[tipo] = true;

  } catch (err) {
    area.innerHTML = '❌ Error al analizar';
    area.style.borderColor = 'var(--red)';
    status.style.color = 'var(--red)';
    status.textContent = err.message;
  }

  // Reset input so same file can be re-uploaded
  input.value = '';
}

async function renderClientes() {
  const q  = (document.getElementById('cli-search')?.value  || '').toLowerCase();
  const st = document.getElementById('cli-status')?.value || '';

  showSpinner();
  let list;
  try {
    list = await db.clientes.list();
  } catch (e) {
    toast('Error al cargar clientes', 'red');
    return;
  } finally {
    hideSpinner();
  }

  const filtered = list.filter(c =>
    (!q  || (c.nombre + c.codigo + (c.rfc || '')).toLowerCase().includes(q)) &&
    (!st || c.status === st)
  );

  let ops = [];
  try { ops = await db.ops.list(); } catch (_) {}
  const tbody = document.getElementById('cli-tbody');
  tbody.innerHTML = filtered.length
    ? filtered.map(c => {
        const opsCount = ops.filter(o => o.clienteId === c.id).length;
        const allDocs = c.docs && c.docs.csf && c.docs.oc && c.docs.ec;
        return `<tr onclick="openDetalleCliente('${c.id}')">
          <td class="mono" style="color:var(--red)">${esc(c.codigo)}</td>
          <td><div style="font-weight:600">${esc(c.nombre)}</div><div style="font-size:11px;color:var(--gray400)">${esc(c.razon) || '—'}</div></td>
          <td><div style="font-size:12px">${esc(c.contacto)}</div><div style="font-size:10px;color:var(--gray400)">${esc(c.cargo)}</div></td>
          <td><div style="font-size:12px">${esc(c.ejec)}</div></td>
          <td><span class="tag tag-${c.pago==='90 días'?'red':c.pago==='60 días'?'amber':'gray'}">${(c.pago||'—').toUpperCase()}</span></td>
          <td>${pillHTML(c.status)}</td>
          <td class="mono" style="color:var(--red);font-weight:700;text-align:center">${opsCount}</td>
          <td><span class="tag ${allDocs ? 'tag-green' : 'tag-amber'}">${allDocs ? 'COMPLETA ✓' : 'INCOMPLETA'}</span></td>
          <td><button class="btn btn-ghost btn-xs" onclick="event.stopPropagation();openDetalleCliente('${c.id}')">Ver</button></td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="9"><div class="empty-state"><div>🏢</div><div>SIN CLIENTES REGISTRADOS</div></div></td></tr>`;
}

async function saveCliente() {
  const nom      = document.getElementById('nc-nombre').value.trim();
  const razon    = document.getElementById('nc-razon').value.trim();
  const rfc      = document.getElementById('nc-rfc').value.trim();
  const dir      = document.getElementById('nc-dir').value.trim();
  const contacto = document.getElementById('nc-contacto').value.trim();
  const email    = document.getElementById('nc-email').value.trim();

  const missing = [];
  if (!nom)      missing.push('Nombre comercial');
  if (!razon)    missing.push('Razón social');
  if (!rfc)      missing.push('RFC');
  if (!dir)      missing.push('Dirección fiscal');
  if (!contacto) missing.push('Nombre del contacto');
  if (!email)    missing.push('Email');
  if (!_docState.csf) missing.push('CSF — Constancia de Situación Fiscal');
  if (!_docState.oc)  missing.push('Opinión de Cumplimiento Positiva');
  if (!_docState.ec)  missing.push('Carátula del Estado de Cuenta');

  if (missing.length) {
    toast('Faltan: ' + missing.slice(0, 2).join(', ') + (missing.length > 2 ? ' y ' + (missing.length - 2) + ' más' : ''), 'red');
    if (!nom)      document.getElementById('nc-nombre').style.borderColor = 'var(--red)';
    if (!razon)    document.getElementById('nc-razon').style.borderColor  = 'var(--red)';
    if (!rfc)      document.getElementById('nc-rfc').style.borderColor    = 'var(--red)';
    if (!dir)      document.getElementById('nc-dir').style.borderColor    = 'var(--red)';
    if (!contacto) document.getElementById('nc-contacto').style.borderColor = 'var(--red)';
    if (!email)    document.getElementById('nc-email').style.borderColor  = 'var(--red)';
    if (!_docState.csf) document.getElementById('doc-csf').style.borderColor = 'var(--red)';
    if (!_docState.oc)  document.getElementById('doc-oc').style.borderColor  = 'var(--red)';
    if (!_docState.ec)  document.getElementById('doc-ec').style.borderColor  = 'var(--red)';

    let blocker = document.getElementById('nc-blocker');
    if (!blocker) {
      blocker = document.createElement('div');
      blocker.id = 'nc-blocker';
      blocker.style.cssText = 'background:var(--red-dim);border:1px solid var(--red-border);border-radius:8px;padding:11px 14px;margin-bottom:12px;font-size:12.5px;color:var(--red-dark)';
      const body = document.querySelector('#m-nuevo-cliente .modal-body');
      if (body) body.prepend(blocker);
    }
    blocker.innerHTML = '<strong>⛔ No se puede guardar.</strong> Completa todos los campos y confirma los 3 documentos:<br>' + missing.map(m => `· ${m}`).join('<br>');
    return;
  }

  const ejec   = document.getElementById('nc-ejec').value;
  const codigo = _buildCodigo(razon, ejec);

  const data = {
    codigo,
    nombre:   nom,
    razon,
    rfc,
    giro:     document.getElementById('nc-giro').value || '',
    dir,
    contacto,
    cargo:    document.getElementById('nc-cargo').value || '',
    tel:      document.getElementById('nc-tel').value || '',
    email,
    ejec,
    pago:     document.getElementById('nc-pago').value,
    status:   'Activo',
    docs:     { csf: true, oc: true, ec: true },
  };

  showSpinner();
  try {
    await db.clientes.create(data);

    // If converting from a prospecto, archive it
    if (STATE.selProsp) {
      await db.prospectos.delete(STATE.selProsp);
      STATE.selProsp = null;
    }

    closeM('nuevo-cliente');
    _resetClienteForm();
    toast('✓ Cliente dado de alta: ' + nom);
    renderClientes();
    updateBadges();
  } catch (e) {
    toast('Error al guardar: ' + e.message, 'red');
  } finally {
    hideSpinner();
  }
}

function _buildCodigo(razon, ejec) {
  const r = (razon || 'XXX').replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 3);
  const e = (ejec  || 'EJE').replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 3);
  const d = new Date();
  return `${r}${e}${String(d.getDate()).padStart(2,'0')}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getFullYear()).slice(2)}`;
}

function _resetClienteForm() {
  _docState = { csf: false, oc: false, ec: false };
  ['doc-csf','doc-oc','doc-ec'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.classList.remove('uploaded'); el.style.borderColor = ''; el.innerHTML = '📎 Clic para confirmar recepción del documento'; }
  });
  ['nc-nombre','nc-razon','nc-rfc','nc-dir','nc-contacto','nc-email','nc-giro','nc-cargo','nc-tel'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.value = ''; el.style.borderColor = ''; }
  });
  const blocker = document.getElementById('nc-blocker');
  if (blocker) blocker.remove();
}

async function openDetalleCliente(id) {
  showSpinner();
  let c, allOps;
  try {
    [c, allOps] = await Promise.all([db.clientes.get(id), db.ops.list()]);
  } catch (e) {
    toast('Error al cargar cliente', 'red');
    return;
  } finally {
    hideSpinner();
  }

  STATE.selCliente = id;
  document.getElementById('dc-eye').textContent    = c.codigo + ' · ' + c.status.toUpperCase();
  document.getElementById('dc-nombre').textContent = c.nombre;

  document.getElementById('dc-info').innerHTML = `
    <div class="info-cell"><div class="info-cell-label">RAZÓN SOCIAL</div><div class="info-cell-val">${esc(c.razon)}</div><div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--gray400)">RFC: ${esc(c.rfc)}</div></div>
    <div class="info-cell"><div class="info-cell-label">CONTACTO PRINCIPAL</div><div class="info-cell-val">${esc(c.contacto)}</div><div style="font-size:11px;color:var(--gray400)">${esc(c.cargo)}</div></div>
    <div class="info-cell"><div class="info-cell-label">TELÉFONO</div><div class="info-cell-val" style="font-family:'JetBrains Mono',monospace;font-size:12px">${esc(c.tel) || '—'}</div></div>
    <div class="info-cell"><div class="info-cell-label">EMAIL</div><div class="info-cell-val" style="font-size:12px">${esc(c.email) || '—'}</div></div>`;

  const clienteOps = allOps.filter(o => o.clienteId === id);
  const totalFact  = clienteOps.reduce((a, o) => a + (o.cobrado || 0), 0);

  document.getElementById('dc-stats').innerHTML = `
    <div class="info-cell" style="text-align:center"><div class="info-cell-label">PAGO</div><div style="font-size:14px;font-weight:600;color:var(--amber)">${c.pago}</div></div>
    <div class="info-cell" style="text-align:center"><div class="info-cell-label">OPs TOTAL</div><div style="font-family:'Bebas Neue',cursive;font-size:24px;color:var(--red)">${clienteOps.length}</div></div>
    <div class="info-cell" style="text-align:center;background:var(--green-dim);border:1px solid var(--green-bdr)"><div class="info-cell-label" style="color:var(--green)">COBRADO</div><div style="font-size:14px;font-weight:700;color:var(--green)">${fmx(totalFact)}</div></div>
    <div class="info-cell" style="text-align:center"><div class="info-cell-label">EJECUTIVO</div><div style="font-size:13px;font-weight:500">${esc(c.ejec)}</div></div>`;

  const docs = [
    { key: 'csf', label: 'CSF — Constancia de Situación Fiscal' },
    { key: 'oc',  label: 'Opinión de Cumplimiento Positiva' },
    { key: 'ec',  label: 'Carátula del Estado de Cuenta' },
  ];
  document.getElementById('dc-checklist').innerHTML = docs.map(d => `
    <div style="display:flex;align-items:center;gap:8px;padding:7px 10px;background:${c.docs && c.docs[d.key] ? 'var(--green-dim)' : 'var(--red-dim)'};border-radius:6px;border:1px solid ${c.docs && c.docs[d.key] ? 'var(--green-bdr)' : 'var(--red-border)'}">
      <span style="color:${c.docs && c.docs[d.key] ? 'var(--green)' : 'var(--red)'}">${c.docs && c.docs[d.key] ? '✓' : '✗'}</span>
      <span style="font-size:12px">${d.label}</span>
    </div>`).join('');

  document.getElementById('dc-ops').innerHTML = clienteOps.length
    ? clienteOps.map(o => `
        <div class="op-card" onclick="openDetalleOP('${o.id}');closeM('detalle-cliente')">
          <div class="op-num">${esc(o.numero)}</div>
          <div class="op-name">${esc(o.desc)}</div>
          <div class="op-meta">
            <div class="op-meta-item">${pillHTML(o.status)}</div>
            <div class="op-meta-item">${fmx(o.cotizado)}</div>
          </div>
        </div>`).join('')
    : '<div style="color:var(--gray400);font-size:12px;padding:8px">Sin OPs registradas</div>';

  openM('detalle-cliente');
}

function openNewOPForClient() {
  const clienteId = STATE.selCliente;
  closeM('detalle-cliente');
  setTimeout(async () => {
    await _populateClienteSelectNuevaOP();
    const sel = document.getElementById('op-cliente');
    if (sel && clienteId) { sel.value = clienteId; _previewOPNum(); }
    openM('nueva-op');
  }, 200);
}
