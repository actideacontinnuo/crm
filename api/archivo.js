// Archivar y restaurar registros desde el OS — solo "oficina total" (Dirección y Oscar).
// Nada se borra: se archiva (deleted_at) con motivo obligatorio y queda constancia en
// 'archivados' + Auditoría. Antes de actuar se calcula el IMPACTO (qué arrastra, qué lo
// bloquea y cómo cambian las cifras), para que nadie archive algo a ciegas.
const express = require('express');
const router = express.Router();
const { queryDB, getRow, archivarConConstancia, restaurarGrupo, listarArchivados } = require('./db');
const { esOficinaTotal } = require('./_guard');
const { logAudit, clientIp } = require('./_audit');

const quien = req => req.user?.ejec || req.user?.nombre || req.user?.id;
const dinero = n => '$' + Number(n || 0).toLocaleString('es-MX', { maximumFractionDigits: 2 });

// Defensa en profundidad: aunque server.js ya filtra por rol, la ruta lo vuelve a exigir.
router.use((req, res, next) => {
  if (!esOficinaTotal(req.user)) return res.status(403).json({ error: 'Solo Dirección y Administración pueden archivar o restaurar registros.' });
  next();
});

const ENTIDADES = {
  prospecto:  { tabla: 'prospectos',   tipo: 'Prospecto',    etiqueta: r => r.empresa },
  cliente:    { tabla: 'clientes',     tipo: 'Cliente',      etiqueta: r => r.nombre },
  proveedor:  { tabla: 'proveedores',  tipo: 'Proveedor',    etiqueta: r => r.nombre },
  op:         { tabla: 'ops',          tipo: 'OP',           etiqueta: r => [r.numero, r.descripcion].filter(Boolean).join(' · ') },
  cotizacion: { tabla: 'cotizaciones', tipo: 'Cotización',   etiqueta: r => r.cotId || 'Cotización sin ID' },
  caso:       { tabla: 'casos',        tipo: 'Caso',         etiqueta: r => r.titulo },
  ticket:     { tabla: 'tickets',      tipo: 'Ticket',       etiqueta: r => r.tipo },
  pago:       { tabla: 'pagos',        tipo: 'Cobro/Pago',   etiqueta: r => r.concepto },
  deuda:      { tabla: 'deudas',       tipo: 'Pago a proveedor', etiqueta: r => r.concepto },
};

const item = (tabla, id, etiqueta) => ({ tabla, id, etiqueta });

// Arma el plan: la raíz, lo que arrastra, lo que bloquea y los efectos en las cifras.
async function plan(entidad, id) {
  const def = ENTIDADES[entidad];
  if (!def) { const e = new Error('Tipo de registro no válido'); e.status = 400; throw e; }
  const row = await getRow(def.tabla, id);
  const etiqueta = def.etiqueta(row) || def.tipo;
  const raiz = item(def.tabla, id, etiqueta);
  const hijos = [], bloqueos = [], efectos = [];

  // Un ticket cuelga de una cotización: si la cotización se archiva, sus tickets van con ella.
  const ticketsDe = async cotId => (await queryDB('tickets', { cotizacionId: cotId })).forEach(t => hijos.push(item('tickets', t.id, t.tipo)));

  if (entidad === 'prospecto' && row.status === 'Convertido') {
    efectos.push('Este prospecto ya se convirtió en cliente. El cliente no se afecta.');
  }

  if (entidad === 'cliente') {
    const ops = await queryDB('ops', { clienteId: id });
    if (ops.length) bloqueos.push(`Tiene ${ops.length} OP(s) activa(s): ${ops.map(o => o.numero).join(', ')}. Archívalas primero.`);
    for (const c of await queryDB('cotizaciones', { clienteId: id })) { hijos.push(item('cotizaciones', c.id, c.cotId)); await ticketsDe(c.id); }
    for (const k of await queryDB('casos', { clienteId: id })) hijos.push(item('casos', k.id, k.titulo));
  }

  if (entidad === 'proveedor') {
    const deudas = await queryDB('deudas', { proveedorId: id });
    if (deudas.length) bloqueos.push(`Tiene ${deudas.length} pago(s) a proveedor registrado(s). Archiva primero esos pagos, o pide apoyo técnico para pasarlos al proveedor correcto.`);
  }

  if (entidad === 'op') {
    const deudas = await queryDB('deudas', { opId: id });
    const pagos = await queryDB('pagos', { opId: id });
    deudas.forEach(d => hijos.push(item('deudas', d.id, d.concepto)));
    pagos.forEach(p => hijos.push(item('pagos', p.id, p.concepto)));
    for (const c of await queryDB('cotizaciones', { opId: id })) { hijos.push(item('cotizaciones', c.id, c.cotId)); await ticketsDe(c.id); }
    for (const k of await queryDB('casos', { opId: id })) hijos.push(item('casos', k.id, k.titulo));
    const cobrado = pagos.filter(p => p.tipo === 'Cobro a cliente' && p.status === 'Pagado').reduce((a, p) => a + (Number(p.monto) || 0), 0);
    const costos = deudas.reduce((a, d) => a + (Number(d.monto) || 0), 0);
    efectos.push('La OP y todas sus cifras dejarán de contar en el Dashboard, Reportes y Comercial.');
    if (cobrado) efectos.push(`Se quitarán ${dinero(cobrado)} de cobrado.`);
    if (costos) efectos.push(`Se quitarán ${dinero(costos)} de costos de proveedores (netos).`);
  }

  if (entidad === 'cotizacion') await ticketsDe(id);

  if (entidad === 'pago') {
    const op = row.opId ? await getRow('ops', row.opId).catch(() => null) : null;
    if (op && row.tipo === 'Cobro a cliente' && row.status === 'Pagado') efectos.push(`El cobrado de la OP ${op.numero} bajará ${dinero(row.monto)}.`);
    else if (op) efectos.push(`Pertenece a la OP ${op.numero}.`);
  }

  if (entidad === 'deuda') {
    const op = row.opId ? await getRow('ops', row.opId).catch(() => null) : null;
    if (op) efectos.push(`El costo de la OP ${op.numero} bajará ${dinero(row.monto)} (neto) y su utilidad subirá lo mismo.`);
    if (Number(row.pagadoConIva) > 0) efectos.push(`Ya tiene ${dinero(row.pagadoConIva)} abonados. Archivarla no revierte el dinero que ya se pagó; úsalo solo si el registro está duplicado o capturado por error.`);
  }

  const cuenta = {};
  hijos.forEach(h => { cuenta[h.tabla] = (cuenta[h.tabla] || 0) + 1; });
  const ROTULO = { deudas: 'pago(s) a proveedor', pagos: 'cobro(s)/pago(s)', cotizaciones: 'cotización(es)', casos: 'caso(s)', tickets: 'ticket(s)' };
  const arrastra = Object.entries(cuenta).map(([t, n]) => ({ tabla: t, cantidad: n, texto: `${n} ${ROTULO[t] || t}` }));
  return { def, raiz, hijos, bloqueos, efectos, arrastra };
}

// Qué pasaría si se archiva (sin cambiar nada).
router.get('/impacto/:entidad/:id', async (req, res) => {
  try {
    const p = await plan(req.params.entidad, req.params.id);
    res.json({ tipo: p.def.tipo, etiqueta: p.raiz.etiqueta, arrastra: p.arrastra, bloqueos: p.bloqueos, efectos: p.efectos, puedeArchivar: p.bloqueos.length === 0 });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// Archiva (motivo obligatorio). Todo o nada.
router.post('/archivar/:entidad/:id', async (req, res) => {
  try {
    const motivo = String(req.body?.motivo || '').trim();
    if (motivo.length < 5) return res.status(400).json({ error: 'Escribe el motivo del archivado (mínimo 5 caracteres).' });
    if (motivo.length > 300) return res.status(400).json({ error: 'El motivo es demasiado largo (máximo 300 caracteres).' });
    const p = await plan(req.params.entidad, req.params.id);
    if (p.bloqueos.length) return res.status(409).json({ error: p.bloqueos.join(' ') });
    const r = await archivarConConstancia({ raiz: p.raiz, hijos: p.hijos, motivo, usuario: quien(req) });
    logAudit({ usuario: quien(req), accion: 'registro_archivado', entidad: p.raiz.etiqueta, detalle: `${p.def.tipo}: ${motivo}`, ip: clientIp(req), exito: true });
    res.json({ ok: true, grupo: r.grupo, tipo: p.def.tipo, etiqueta: p.raiz.etiqueta, arrastrados: p.hijos.length });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// Lo archivado desde el OS que aún se puede restaurar.
router.get('/lista', async (_req, res) => {
  try {
    const filas = await listarArchivados(200);
    res.json(filas.map(a => ({
      grupo: a.grupo, tabla: a.tabla,
      tipo: (Object.values(ENTIDADES).find(d => d.tabla === a.tabla) || {}).tipo || a.tabla,
      etiqueta: a.etiqueta, motivo: a.motivo, usuario: a.usuario, fecha: a.fecha, arrastrados: a.arrastrados,
    })));
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// Restaura todo un archivado (la raíz y lo que arrastró).
router.post('/restaurar/:grupo', async (req, res) => {
  try {
    const raiz = (await listarArchivados(500)).find(a => a.grupo === req.params.grupo);
    const r = await restaurarGrupo(req.params.grupo);
    logAudit({ usuario: quien(req), accion: 'registro_restaurado', entidad: raiz?.etiqueta || req.params.grupo, detalle: `${r.restaurados} registro(s) devueltos`, ip: clientIp(req), exito: true });
    res.json({ ok: true, restaurados: r.restaurados });
  } catch (err) {
    if (err.status === 409) return res.status(409).json({ error: 'No se puede restaurar: ya existe otro registro activo con el mismo número. Archiva o corrige ese primero.' });
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
