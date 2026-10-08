// ══════════════════════════════════════
// ARCHIVAR / RESTAURAR — solo Dirección y Oscar
// Nada se borra: se archiva con motivo obligatorio, y se puede restaurar.
// ══════════════════════════════════════
let _arch = null; // { entidad, id, puede }

const _ARCH_DETALLES = ['detalle-prospecto', 'detalle-cliente', 'detalle-op', 'detalle-caso', 'detalle-pago', 'detalle-proveedor', 'ver-cotizacion'];

function _archError(e) {
  let msg = (e && e.message) || 'Ocurrió un error';
  try { msg = JSON.parse(msg).error || msg; } catch (_) { /* no era JSON */ }
  return msg;
}

async function abrirArchivar(entidad, id) {
  if (!soyOficinaTotal()) { toast('Solo Dirección y Oscar pueden eliminar registros', 'red'); return; }
  if (!id) return;
  _arch = { entidad, id, puede: false };
  document.getElementById('arch-titulo').textContent = 'Revisando…';
  document.getElementById('arch-cuerpo').innerHTML = '<div style="color:var(--gray400);font-size:13px;padding:8px 0">Calculando qué pasará al eliminar…</div>';
  document.getElementById('arch-motivo-wrap').style.display = 'none';
  document.getElementById('arch-btn').disabled = true;
  document.getElementById('arch-error').style.display = 'none';
  _ARCH_DETALLES.forEach(closeM);
  setTimeout(() => openM('archivar'), 200);

  try {
    const imp = await db.archivo.impacto(entidad, id);
    _arch.puede = imp.puedeArchivar;
    document.getElementById('arch-titulo').textContent = imp.etiqueta || imp.tipo;
    document.getElementById('arch-eye').textContent = 'ELIMINAR ' + String(imp.tipo || '').toUpperCase();
    const bloques = [];
    if (imp.bloqueos.length) {
      bloques.push(`<div style="background:var(--red-dim,#fdecea);border:1px solid var(--red-border,#f3c2bd);border-radius:8px;padding:12px 14px;margin-bottom:12px">
        <div style="font-weight:700;font-size:12px;color:var(--red);margin-bottom:4px">NO SE PUEDE ELIMINAR TODAVÍA</div>
        ${imp.bloqueos.map(b => `<div style="font-size:13px">${esc(b)}</div>`).join('')}
      </div>`);
    }
    if (imp.arrastra.length) {
      bloques.push(`<div style="margin-bottom:12px"><div class="sect-label">SE ELIMINARÁ JUNTO CON</div>
        <ul style="margin:6px 0 0;padding-left:18px;font-size:13px">${imp.arrastra.map(a => `<li>${esc(a.texto)}</li>`).join('')}</ul></div>`);
    }
    if (imp.efectos.length) {
      bloques.push(`<div style="margin-bottom:12px"><div class="sect-label">QUÉ CAMBIARÁ EN LAS CIFRAS</div>
        <ul style="margin:6px 0 0;padding-left:18px;font-size:13px">${imp.efectos.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`);
    }
    bloques.push(`<div style="font-size:12px;color:var(--gray400)">El registro sale del OS, pero queda guardado y se puede restaurar desde el menú de tu avatar → <strong>Eliminados</strong>.</div>`);
    document.getElementById('arch-cuerpo').innerHTML = bloques.join('');
    if (imp.puedeArchivar) {
      document.getElementById('arch-motivo').value = '';
      document.getElementById('arch-motivo-wrap').style.display = '';
      document.getElementById('arch-btn').disabled = false;
    }
  } catch (e) {
    document.getElementById('arch-titulo').textContent = 'No se pudo revisar';
    document.getElementById('arch-cuerpo').innerHTML = `<div style="color:var(--red);font-size:13px">${esc(_archError(e))}</div>`;
  }
}

async function confirmarArchivar() {
  if (!_arch || !_arch.puede) return;
  const motivo = document.getElementById('arch-motivo').value.trim();
  const err = document.getElementById('arch-error');
  if (motivo.length < 5) { err.textContent = 'Escribe el motivo de la eliminación (por ejemplo: "duplicado" o "capturado por error").'; err.style.display = 'block'; return; }
  err.style.display = 'none';
  document.getElementById('arch-btn').disabled = true;
  showSpinner();
  try {
    const r = await db.archivo.archivar(_arch.entidad, _arch.id, motivo);
    closeM('archivar');
    toast('✓ Eliminado: ' + (r.etiqueta || r.tipo));
    _arch = null;
    const vista = document.querySelector('.view.active')?.id?.replace('view-', '');
    if (vista) nav(vista);
    updateBadges();
  } catch (e) {
    err.textContent = _archError(e); err.style.display = 'block';
    document.getElementById('arch-btn').disabled = false;
  } finally {
    hideSpinner();
  }
}

// ── Pantalla "Archivados": lo archivado desde el OS, con opción de restaurar ──
async function abrirArchivados() {
  if (!soyOficinaTotal()) return;
  document.getElementById('archivados-lista').innerHTML = '<div style="padding:12px;color:var(--gray400);font-size:12px">Cargando…</div>';
  openM('archivados');
  try {
    const lista = await db.archivo.lista();
    document.getElementById('archivados-lista').innerHTML = lista.length ? lista.map(a => `
      <div style="display:flex;align-items:center;gap:12px;padding:11px 4px;border-bottom:1px solid var(--border)">
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600">${esc(a.etiqueta || '—')} <span class="tag tag-gray" style="font-size:9px;margin-left:6px">${esc(a.tipo)}</span></div>
          <div style="font-size:12px;margin-top:2px">Motivo: ${esc(a.motivo)}</div>
          <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--gray400);margin-top:2px">
            ${esc(a.usuario) || '—'} · ${a.fecha ? new Date(a.fecha).toLocaleString('es-MX') : '—'}${a.arrastrados ? ' · incluye ' + a.arrastrados + ' registro(s) ligado(s)' : ''}
          </div>
        </div>
        <button class="btn btn-ghost btn-xs" onclick="restaurarArchivado('${a.grupo}')">↺ Restaurar</button>
      </div>`).join('')
      : '<div style="padding:16px 4px;color:var(--gray400);font-size:13px">No hay nada eliminado desde el OS.</div>';
  } catch (e) {
    document.getElementById('archivados-lista').innerHTML = `<div style="padding:12px;color:var(--red);font-size:12px">${esc(_archError(e))}</div>`;
  }
}

async function restaurarArchivado(grupo) {
  showSpinner();
  try {
    const r = await db.archivo.restaurar(grupo);
    toast('✓ Restaurado (' + r.restaurados + ' registro' + (r.restaurados === 1 ? '' : 's') + ')');
    await abrirArchivados();
    const vista = document.querySelector('.view.active')?.id?.replace('view-', '');
    if (vista) nav(vista);
    updateBadges();
  } catch (e) {
    toast(_archError(e), 'red');
  } finally {
    hideSpinner();
  }
}
