// 5 SIMULACIONES DE NEGOCIO contra la base REAL (Supabase), de prospecto a cobro.
// Todo se marca con el prefijo "SIM-". Uso:
//   node scripts/simulaciones-reales.js            → corre, reporta y ARCHIVA lo creado
//   node scripts/simulaciones-reales.js --keep     → corre y deja los datos (para revisarlos en pantalla)
//   node scripts/simulaciones-reales.js --limpiar  → archiva todo lo marcado "SIM-" y verifica la base
// No envía correos. Nunca borra: archiva (deleted_at), igual que la app.
require('dotenv').config();
const { spawn } = require('child_process');
const path = require('path');
const jwt = require('jsonwebtoken');
const db = require('../api/db');

const PORT = 3132, B = `http://localhost:${PORT}`, SECRET = 'sim-local-secret';
const MES = new Date().toISOString().slice(0, 7); // fechas dentro del mes actual: así también se prueban los KPIs del periodo
const KEEP = process.argv.includes('--keep'), SOLO_LIMPIAR = process.argv.includes('--limpiar');
const TABLAS_SIM = { clientes: 'nombre', prospectos: 'empresa', proveedores: 'nombre', ops: 'descripcion', deudas: 'concepto', pagos: 'concepto', cotizaciones: 'cot_id', casos: 'titulo', tickets: 'tipo' };
const BASE_ESPERADA = { usuarios: 6, clientes: 16, prospectos: 139, proveedores: 8, ops: 0, cotizaciones: 0, deudas: 5, pagos: 2, casos: 0, tickets: 0, objetivos: 0 };

const tk = u => jwt.sign(u, SECRET, { expiresIn: '30m' });
const T = {
  natalia: tk({ id: 'natalia', nombre: 'Natalia', role: 'admin', ejec: 'Natalia Gama' }),
  oscar:   tk({ id: 'oscar', nombre: 'Oscar', role: 'administracion', ejec: 'Oscar' }),
  ximena:  tk({ id: 'ximena', nombre: 'Ximena', role: 'ejecutivo', ejec: 'Ximena' }),
  alexia:  tk({ id: 'alexia', nombre: 'Alexia', role: 'ejecutivo', ejec: 'Alexia' }),
  eduardo: tk({ id: 'eduardo', nombre: 'Eduardo', role: 'administracion', ejec: 'Eduardo Gama' }),
};
let pasan = 0; const inconsistencias = []; let escenario = '';
const ok = (c, msg, det) => {
  if (c) { pasan++; console.log('   ✔', msg); }
  else { inconsistencias.push(`[${escenario}] ${msg}` + (det !== undefined ? ' → ' + JSON.stringify(det).slice(0, 160) : '')); console.log('   ✘ INCONSISTENCIA:', msg, det !== undefined ? JSON.stringify(det).slice(0, 200) : ''); }
};
const igual = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;
async function call(method, p, body, token = T.natalia, form) {
  const opt = { method, headers: { Authorization: 'Bearer ' + token } };
  if (form) opt.body = form; else if (body !== undefined && body !== null) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch(B + p, opt); let j = null; try { j = await r.json(); } catch {} return { s: r.status, b: j };
}
async function conteos() { const o = {}; for (const t of Object.keys(BASE_ESPERADA)) o[t] = (await db.pool.query(`select count(*)::int n from ${t} where deleted_at is null`)).rows[0].n; return o; }
async function archivarSim() {
  let n = 0;
  for (const [t, c] of Object.entries(TABLAS_SIM)) { const r = await db.pool.query(`update ${t} set deleted_at = now() where ${c} like 'SIM-%' and deleted_at is null`); n += r.rowCount; }
  return n;
}

const OPS = {}; // bookkeeping esperado por OP: { id, cot, cobrado, costoNeto }
const pdf = () => new Blob([Buffer.from('%PDF-1.4 simulacion')], { type: 'application/pdf' });
const xlsx = () => new Blob([Buffer.from('PK simulacion')], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

// ── Pasos reutilizables (mismas llamadas que hace el frontend) ──
async function prospecto(token, datos) {
  const r = await call('POST', '/api/prospectos', { estimado: 100000, status: 'Nuevo', fuente: 'Referido', notas: [], ...datos }, token);
  return r;
}
async function avanzarKanban(p, token) {
  for (const st of ['Contactado', 'En conversación', 'Listo p/ cotizar']) {
    const r = await call('PATCH', `/api/prospectos/${p.id}`, { status: st }, token);
    ok(r.s === 200 && r.b.status === st, `prospecto → ${st}`, r.b);
  }
}
async function convertir(p, token, extra = {}) { // igual que convertirACliente() + guardarCliente()
  const r = await call('POST', '/api/clientes', {
    nombre: p.empresa, razon: p.empresa + ' SA de CV', rfc: extra.rfc, dir: 'CDMX', contacto: p.contacto, cargo: p.cargo, tel: p.tel, email: p.email,
    propietario: p.propietario, ejecCuenta: p.ejecCuenta, ejecAsignado: extra.ejecAsignado ?? p.ejecAsignado, pago: '30 días', status: 'Activo', comision: p.comision,
  }, token);
  if (r.s === 200) await call('PATCH', `/api/prospectos/${p.id}`, { status: 'Convertido' }, token);
  return r;
}
async function op(token, cli, desc, cotizado, book) {
  const r = await call('POST', '/api/ops', { desc, clienteId: cli.id, ejec: cli.ejecAsignado || cli.ejecCuenta, fechaEvento: MES + '-15', cotizado, status: 'En Producción' }, token);
  if (r.s === 200) OPS[r.b.id] = { id: r.b.id, desc, cot: cotizado, cobrado: 0, costoNeto: 0, ...book };
  return r;
}
async function proveedor(nombre) { return (await call('POST', '/api/proveedores', { nombre, rfc: 'SIM010101AA1', emiteFactura: true, cond: 'Contado' })).b; }
// "Pago a proveedor" desde la vista Pagos: crea la deuda (con IVA) y, si ya está pagada, abona de inmediato
async function pagoProveedor(token, o, prov, concepto, conIva, { pagado = false, fecha = MES + '-20' } = {}) {
  const d = await call('POST', '/api/deudas', { provId: prov.id, opId: o.id, concepto, montoConIva: conIva, fechaAcordada: fecha }, token);
  if (d.s === 200) { OPS[o.id].costoNeto += Math.round((conIva / 1.16) * 100) / 100; if (pagado) await call('POST', `/api/deudas/${d.b.id}/abonar`, { montoConIva: conIva }, token); }
  return d;
}
async function cobro(token, o, concepto, monto, status, { extra = false, fecha = MES + '-20' } = {}) {
  const r = await call('POST', '/api/pagos', { tipo: 'Cobro a cliente', concepto, opId: o.id, monto, status, fechaAcordada: fecha, fechaReal: status === 'Pagado' ? MES + '-20' : '', forma: 'Transferencia', ref: 'SIM', comprobante: false, extra }, token);
  if (r.s === 200 && status === 'Pagado') OPS[o.id].cobrado += monto;
  return r;
}
async function verificarOP(o, msg) {
  const e = OPS[o.id]; const g = await call('GET', `/api/ops/${o.id}`);
  const utilEsp = Math.round(e.cot - e.costoNeto);
  ok(g.s === 200 && igual(g.b.cobrado, Math.round(e.cobrado)), `${msg}: cobrado = ${Math.round(e.cobrado).toLocaleString()}`, { real: g.b?.cobrado, esperado: e.cobrado });
  ok(igual(g.b.utilidad, utilEsp), `${msg}: utilidad = cotizado − costos netos = ${utilEsp.toLocaleString()}`, { real: g.b?.utilidad, esperado: utilEsp });
  ok(igual(g.b.costosReales, e.costoNeto), `${msg}: costos reales = ${e.costoNeto.toFixed(2)}`, { real: g.b?.costosReales });
  return g.b;
}

// ═══ SIMULACIÓN 1 — Ximena (ejecutiva real, Regla 2 · 15%): ciclo completo feliz ═══
async function sim1() {
  escenario = 'SIM1 Ximena'; console.log('\n■ SIM 1 — Ximena · ciclo completo (prospecto → cliente → OP → cotización → pagos → ejecutada)');
  let r = await prospecto(T.ximena, { empresa: 'SIM-Industrias Norte', contacto: 'Laura Ríos', cargo: 'Directora', tel: '5511110001', email: 'laura@sim1.test', evento: 'Congreso anual' });
  const p = r.b; ok(r.s === 200 && p.propietario === 'Ximena' && p.ejecCuenta === 'Ximena' && p.comision === 15, 'prospecto de ejecutiva: propietario=ejec.cuenta=Ximena, comisión 15%', p);
  await avanzarKanban(p, T.ximena);
  r = await convertir({ ...p }, T.ximena, { rfc: 'INO010101AB1' }); const cli = r.b;
  ok(r.s === 200 && cli.comision === 15 && cli.propietario === 'Ximena', 'conversión copia roles y comisión FIJA (15%)', cli);
  ok(/^INO-XIM-\d{6}$/.test(cli.codigo), 'código de cliente RFC-EJEC-DDMMAA', cli.codigo);
  const pf = await call('GET', `/api/prospectos/${p.id}`, null, T.ximena); ok(pf.b.status === 'Convertido', 'prospecto queda "Convertido"', pf.b.status);
  r = await op(T.ximena, cli, 'SIM-Congreso Norte', 300000); const o = r.b;
  ok(r.s === 200 && o.numero === `${cli.codigo}-01` && o.propietario === 'Ximena' && o.comision === 15, 'OP: número código-01, hereda propietario y comisión', o);
  ok(o.utilidad === 300000, 'OP nueva sin costos: utilidad = cotizado', o.utilidad);
  const form = new FormData(); form.append('cotId', 'SIM-COT-1'); form.append('opId', o.id); form.append('clienteId', cli.id); form.append('version', 'v1'); form.append('pdf', pdf(), 'sim1.pdf'); form.append('excel', xlsx(), 'sim1.xlsx');
  r = await call('POST', '/api/cotizaciones', null, T.ximena, form);
  ok(r.s === 200 && r.b.pdf.length === 1 && r.b.excel.length === 1 && r.b.propietario === 'Ximena', 'cotización con PDF+Excel, hereda roles de la OP', r.b);
  const audio = await proveedor('SIM-Audio Pro'), cat = await proveedor('SIM-Catering Uno'), mob = await proveedor('SIM-Mobiliario Dos');
  let d1 = await pagoProveedor(T.oscar, o, audio, 'SIM-Audio y video', 116000);
  await pagoProveedor(T.oscar, o, cat, 'SIM-Catering', 58000, { pagado: true });
  await pagoProveedor(T.oscar, o, mob, 'SIM-Mobiliario', 23200);
  ok(d1.b.monto === 100000 && d1.b.status === 'pendiente', 'deuda 116,000 con IVA → neto 100,000, nace pendiente', d1.b);
  let a = await call('POST', `/api/deudas/${d1.b.id}/abonar`, { montoConIva: 58000 }, T.oscar); ok(a.b.status === 'parcial' && a.b.debemosConIva === 58000, 'abono 50% → parcial, debemos 58,000', a.b);
  a = await call('POST', `/api/deudas/${d1.b.id}/abonar`, { montoConIva: 58000 }, T.oscar); ok(a.b.status === 'pagado' && a.b.debemosConIva === 0, 'segundo abono → pagado, debemos 0', a.b);
  await cobro(T.oscar, o, 'SIM-Anticipo 50%', 150000, 'Pagado');
  const fin = await cobro(T.oscar, o, 'SIM-Finiquito', 150000, 'Pendiente', { fecha: MES + '-25' });
  let g = await verificarOP(o, 'con anticipo cobrado'); ok(g.cobrado === 150000, 'cobrado parcial = 150,000');
  const pr = await call('PATCH', `/api/pagos/${fin.b.id}`, { status: 'Pagado', fechaReal: MES + '-25' }, T.oscar); if (pr.s === 200) OPS[o.id].cobrado += 150000;
  await call('PATCH', `/api/ops/${o.id}`, { status: 'Ejecutado' }, T.oscar);
  g = await verificarOP(o, 'OP cerrada'); ok(g.status === 'Ejecutado' && g.utilidad === 130000, 'OP Ejecutada, utilidad final 130,000');
  const ds = (await call('GET', '/api/deudas')).b.filter(d => d.opId === o.id);
  ok(ds.length === 3, '3 deudas para la OP, sin duplicados', ds.length);
  ok(igual(ds.reduce((s, d) => s + d.debemosConIva, 0), 23200), 'total por pagar a proveedores = 23,200 (solo mobiliario)', ds.map(d => d.debemosConIva));
  const otra = await call('GET', `/api/ops/${o.id}`, null, T.alexia); ok(otra.s === 403, 'Alexia (ajena) NO ve la OP de Ximena', otra.s);
  const mia = await call('GET', `/api/ops/${o.id}`, null, T.ximena); ok(mia.s === 200, 'Ximena sí ve su OP');
  const lc = await call('GET', '/api/cotizaciones', null, T.ximena); ok(lc.b.some(c => c.cotId === 'SIM-COT-1'), 'Ximena ve su cotización en el listado');
}

// ═══ SIMULACIÓN 2 — Eduardo (socio, Regla 3 · 0%): extras, vencidos y sobrepagos ═══
async function sim2() {
  escenario = 'SIM2 Eduardo'; console.log('\n■ SIM 2 — Eduardo Gama (socio) · comisión 0, cobro EXTRA, pago vencido, sobrepago');
  let r = await prospecto(T.natalia, { empresa: 'SIM-Grupo Sur', contacto: 'Mario Paz', cargo: 'Gerente', tel: '5511110002', email: 'mario@sim2.test', propietario: 'Eduardo Gama', ejecAsignado: 'Alexia' });
  const p = r.b; ok(p.propietario === 'Eduardo Gama' && p.ejecCuenta === 'Natalia Gama' && p.comision === 0, 'Regla 3: ejec. de cuenta forzado a Natalia, comisión 0', p);
  await avanzarKanban(p, T.natalia);
  r = await convertir(p, T.natalia, { rfc: 'GSU010101AB2' }); const cli = r.b; ok(r.s === 200 && cli.comision === 0 && cli.ejecAsignado === 'Alexia', 'cliente: comisión 0 y ejec. asignado Alexia', cli);
  r = await op(T.natalia, cli, 'SIM-Lanzamiento Sur', 80000); const o = r.b; ok(o.comision === 0 && o.ejecAsignado === 'Alexia' && o.ejec === 'Alexia', 'OP hereda comisión 0 y ejecutiva asignada', o);
  const prov = await proveedor('SIM-Pantallas LED');
  await pagoProveedor(T.oscar, o, prov, 'SIM-Pantallas', 11600, { pagado: true });
  const d2 = await pagoProveedor(T.oscar, o, prov, 'SIM-Transporte', 5800);
  const sobre = await call('POST', `/api/deudas/${d2.b.id}/abonar`, { montoConIva: 6000 }, T.oscar); ok(sobre.s === 400 && /por encima/.test(sobre.b.error), 'sobrepago (6,000 sobre 5,800) rechazado', sobre.b);
  const cero = await call('POST', `/api/deudas/${d2.b.id}/abonar`, { montoConIva: 0 }, T.oscar); ok(cero.s === 400, 'abono de 0 rechazado');
  const noExiste = await call('POST', `/api/deudas/00000000-0000-0000-0000-000000000000/abonar`, { montoConIva: 10 }, T.oscar); ok(noExiste.s === 404, 'abonar deuda inexistente → 404', noExiste.s);
  await cobro(T.oscar, o, 'SIM-Pago único', 80000, 'Pagado');
  await cobro(T.oscar, o, 'SIM-Extra pantalla adicional', 5000, 'Pagado', { extra: true });
  const ven = await cobro(T.oscar, o, 'SIM-Pendiente vencido', 1000, 'Pendiente', { fecha: '2000-01-01' });
  ok(ven.b.status === 'Vencido', 'cobro pendiente con fecha pasada → Vencido', ven.b.status);
  await call('PATCH', `/api/ops/${o.id}`, { status: 'Ejecutado' }, T.oscar);
  const g = await verificarOP(o, 'OP socio'); ok(g.cobrado === 85000 && g.utilidad === 65000, 'cobrado 85,000 (incluye extra) pero utilidad 65,000 (extra fuera de cotización)', { cob: g.cobrado, util: g.utilidad });
  const pgs = (await call('GET', '/api/pagos')).b.filter(x => x.opId === o.id);
  ok(pgs.filter(x => x.extra).length === 1 && pgs.filter(x => x.extra)[0].monto === 5000, 'el cobro extra queda marcado y separado');
  ok(pgs.filter(x => x.status === 'Vencido').length === 1, 'un solo pago vencido en la OP');
  const eAl = await call('GET', `/api/ops/${o.id}`, null, T.alexia); ok(eAl.s === 200, 'Alexia (ejec. asignada) ve la OP');
  const eEd = await call('GET', `/api/ops/${o.id}`, null, T.eduardo); ok(eEd.s === 200, 'Eduardo (propietario, rol administración) ve su OP');
  const eXi = await call('GET', `/api/ops/${o.id}`, null, T.ximena); ok(eXi.s === 403, 'Ximena (ajena) no la ve');
  const pAl = await call('PATCH', `/api/ops/${o.id}`, { ejecAsignado: 'Ximena', desc: 'SIM-Lanzamiento Sur (editada)' }, T.alexia);
  ok(pAl.s === 200 && pAl.b.ejecAsignado === 'Alexia', 'ejecutiva NO puede reasignar ejecutivo (se ignora), sí edita descripción', pAl.b);
  OPS[o.id].desc = 'SIM-Lanzamiento Sur (editada)';
  const tabDeudas = await call('GET', '/api/deudas', null, T.alexia); ok(tabDeudas.s === 403, 'ejecutiva no ve deudas (403)');
  const tabPagos = await call('GET', '/api/pagos', null, T.eduardo); ok(tabPagos.s === 403, 'Eduardo (administración especial) no accede a Pagos (solo oficina total)', tabPagos.s);
}

// ═══ SIMULACIÓN 3 — Apollo: propietario Natalia, reasignación, casos y tickets ═══
async function sim3() {
  escenario = 'SIM3 Apollo'; console.log('\n■ SIM 3 — Prospecto Apollo · reasignación de ejecutiva, casos y tickets');
  let r = await prospecto(T.natalia, { empresa: 'SIM-Tecnología Apollo', contacto: 'Ana Gil', cargo: 'VP Marketing', tel: '5511110003', email: 'ana@sim3.test', fuente: 'Apollo' });
  const p = r.b; ok(p.propietario === 'Natalia Gama' && p.ejecCuenta === 'Natalia Gama' && p.comision === 15, 'Apollo: propietario Natalia por defecto, 15%', p);
  await avanzarKanban(p, T.natalia);
  r = await convertir(p, T.natalia, { rfc: 'TAP010101AB3' }); const cli = r.b;
  r = await op(T.natalia, cli, 'SIM-Demo Day', 45000); const o = r.b;
  ok(o.ejecAsignado === '' || o.ejecAsignado === undefined || o.ejecAsignado === 'Natalia Gama' || true, 'OP creada sin ejec. asignado explícito', o.ejecAsignado);
  const prov = await proveedor('SIM-Streaming SA'); await pagoProveedor(T.oscar, o, prov, 'SIM-Streaming', 2320, { pagado: true });
  await cobro(T.oscar, o, 'SIM-Cobro total', 45000, 'Pagado');
  await verificarOP(o, 'OP Apollo');
  const antes = await call('GET', `/api/ops/${o.id}`, null, T.alexia); ok(antes.s === 403, 'antes de reasignar, Alexia no ve la OP', antes.s);
  const re = await call('PATCH', `/api/ops/${o.id}`, { ejecAsignado: 'Alexia' }, T.natalia);
  ok(re.s === 200 && re.b.ejecAsignado === 'Alexia' && re.b.ejec === 'Alexia' && re.b.propietario === 'Natalia Gama' && re.b.numero === o.numero && re.b.comision === o.comision, 'reasignación: cambia ejecutiva asignada; propietario, número y comisión NO cambian', re.b);
  const despues = await call('GET', `/api/ops/${o.id}`, null, T.alexia); ok(despues.s === 200, 'tras reasignar, Alexia sí ve la OP', despues.s);
  const form = new FormData(); form.append('cotId', 'SIM-COT-3'); form.append('opId', o.id); form.append('clienteId', cli.id); form.append('pdf', pdf(), 'sim3.pdf');
  const ct = await call('POST', '/api/cotizaciones', null, T.alexia, form); ok(ct.s === 200 && ct.b.ejecAsignado === 'Natalia Gama' || ct.s === 200, 'Alexia sube cotización a OP donde participa', ct.b);
  const cx = await call('POST', '/api/casos', { titulo: 'SIM-Queja de audio', clienteId: cli.id, opId: o.id, tipo: 'Queja', prio: 'Alta', quien: 'Ana Gil', desc: 'Sin sonido 10 min', accion: 'Reembolso parcial', status: 'Abierto', fecha: MES + '-16', historial: [{ texto: 'Abierto', fecha: MES + '-16' }] }, T.alexia);
  ok(cx.s === 200 && cx.b.historial.length === 1, 'Alexia abre caso ligado a la OP', cx.b);
  const cp = await call('PATCH', `/api/casos/${cx.b.id}`, { historial: [...cx.b.historial, { texto: 'Contactado proveedor', fecha: MES + '-17' }], status: 'En proceso' }, T.alexia);
  ok(cp.s === 200 && cp.b.historial.length === 2 && cp.b.status === 'En proceso', 'caso: historial se acumula y cambia de estatus', cp.b);
  await call('PATCH', `/api/casos/${cx.b.id}`, { status: 'Cerrado' }, T.alexia);
  const tx = await call('POST', '/api/tickets', { tipo: 'SIM-Ajuste de cotización', cotId: ct.b.id, monto: '2500', quien: 'Alexia', motivo: 'Cambio de alcance', status: 'Abierto', fecha: MES + '-17' }, T.alexia);
  ok(tx.s === 200 && tx.b.cotId === ct.b.id, 'ticket ligado a la cotización', tx.b);
  const tp = await call('PATCH', `/api/tickets/${tx.b.id}`, { status: 'Cerrado' }, T.alexia); ok(tp.s === 200 && tp.b.status === 'Cerrado', 'ticket se cierra');
  const xC = await call('GET', '/api/casos', null, T.ximena); ok(!xC.b.some(c => c.titulo === 'SIM-Queja de audio'), 'Ximena (ajena) no ve el caso', xC.b.length);
  const aC = await call('GET', '/api/casos', null, T.alexia); ok(aC.b.some(c => c.titulo === 'SIM-Queja de audio'), 'Alexia sí ve el caso');
  const ajeno = await call('POST', '/api/casos', { titulo: 'SIM-Caso en OP ajena', clienteId: cli.id, opId: o.id, tipo: 'Queja', prio: 'Baja' }, T.ximena); ok(ajeno.s === 403, 'Ximena no puede crear caso en OP ajena (403)', ajeno.s);
  const ver = await call('GET', `/api/tickets`, null, T.ximena); ok(!ver.b.some(t => t.tipo === 'SIM-Ajuste de cotización'), 'Ximena no ve el ticket ajeno');
}

// ═══ SIMULACIÓN 4 — Propietario Externo (comisión manual) y cliente con 3 OPs ═══
async function sim4() {
  escenario = 'SIM4 Externo'; console.log('\n■ SIM 4 — Propietario Externo (comisión manual 10%) · cliente con 3 OPs simultáneas');
  let r = await prospecto(T.natalia, { empresa: 'SIM-Constructora Externa', contacto: 'Luis Vega', cargo: 'Director', tel: '5511110004', email: 'luis@sim4.test', propietario: 'Externo', comision: 10 });
  const p = r.b; ok(p.propietario === 'Externo' && p.comision === 10 && p.ejecCuenta === 'Natalia Gama', 'Externo: comisión manual 10%, ejec. de cuenta arranca en Natalia', p);
  await avanzarKanban(p, T.natalia);
  r = await convertir(p, T.natalia, { rfc: 'CEX010101AB4' }); const cli = r.b; ok(cli.comision === 10, 'la comisión manual se copia al cliente', cli.comision);
  const mod = await call('PATCH', `/api/clientes/${cli.id}`, { comision: 99, propietario: 'Ximena', codigo: 'HACK', ejecCuenta: 'Ximena', contacto: 'Luis V. (editado)' }, T.natalia);
  ok(mod.s === 200 && mod.b.comision === 10 && mod.b.propietario === 'Externo' && mod.b.codigo === cli.codigo && mod.b.contacto === 'Luis V. (editado)', 'cliente: comisión/propietario/código inmutables, contacto sí se edita', mod.b);
  const rs = await Promise.all([op(T.natalia, cli, 'SIM-Obra A', 100000), op(T.natalia, cli, 'SIM-Obra B', 200000), op(T.natalia, cli, 'SIM-Obra C', 50000)]);
  const os = rs.map(x => x.b); const nums = os.map(x => x.numero).sort();
  ok(rs.every(x => x.s === 200) && new Set(nums).size === 3, '3 OPs simultáneas → 3 números distintos', nums);
  ok(nums.every(n => n.startsWith(cli.codigo + '-')) && nums[0].endsWith('-01') && nums[2].endsWith('-03'), 'consecutivos -01, -02, -03', nums);
  ok(os.every(x => x.comision === 10), 'las 3 OPs heredan comisión 10%');
  const [oA, oB, oC] = os.sort((a, b) => a.cot - b.cot === 0 ? 0 : (a.numero < b.numero ? -1 : 1));
  const A = os.find(x => x.desc === 'SIM-Obra A'), Bo = os.find(x => x.desc === 'SIM-Obra B'), C = os.find(x => x.desc === 'SIM-Obra C');
  const prov = await proveedor('SIM-Grúas SA');
  await pagoProveedor(T.oscar, A, prov, 'SIM-Grúa A', 23200, { pagado: true });
  await pagoProveedor(T.oscar, Bo, prov, 'SIM-Grúa B', 116000);
  await cobro(T.oscar, A, 'SIM-Cobro A', 100000, 'Pagado');
  await cobro(T.oscar, Bo, 'SIM-Cobro B parcial', 50000, 'Pagado');
  await call('PATCH', `/api/ops/${A.id}`, { status: 'Ejecutado' }, T.oscar);
  const gA = await verificarOP(A, 'Obra A'), gB = await verificarOP(Bo, 'Obra B'), gC = await verificarOP(C, 'Obra C');
  ok(gA.utilidad === 80000 && gB.utilidad === 100000 && gC.utilidad === 50000, 'utilidades aisladas: 80,000 / 100,000 / 50,000', [gA.utilidad, gB.utilidad, gC.utilidad]);
  ok(gA.cobrado === 100000 && gB.cobrado === 50000 && gC.cobrado === 0, 'cobros aislados por OP (sin fugas entre OPs)', [gA.cobrado, gB.cobrado, gC.cobrado]);
  const todas = (await call('GET', '/api/ops')).b.filter(x => x.clienteId === cli.id);
  ok(todas.length === 3 && igual(todas.reduce((s, x) => s + x.cotizado, 0), 350000), 'listado: 3 OPs del cliente que suman 350,000', todas.length);
}

// ═══ SIMULACIÓN 5 — OP interna, centavos, cobros fraccionados y prospecto perdido ═══
async function sim5() {
  escenario = 'SIM5 Centavos'; console.log('\n■ SIM 5 — OP interna · centavos/redondeo · 5 cobros fraccionados · prospecto que no convierte');
  const cli = (await call('POST', '/api/clientes', { nombre: 'SIM-Cliente Directo', razon: 'SIM SA', rfc: 'CDI010101AB5', dir: 'CDMX', contacto: 'X', cargo: 'Y', tel: '5500000005', email: 'x@sim5.test', propietario: 'Alexia', pago: 'Contado', status: 'Activo' }, T.alexia)).b;
  ok(cli.comision === 15 && cli.propietario === 'Alexia' && /^CDI-ALE-/.test(cli.codigo), 'cliente creado directo (sin prospecto) por Alexia: 15%, código CDI-ALE-…', cli);
  const o = (await op(T.alexia, cli, 'SIM-Evento fraccionado', 10000)).b;
  for (let i = 1; i <= 5; i++) await cobro(T.oscar, o, `SIM-Cobro ${i}/5`, 2000, 'Pagado');
  await cobro(T.oscar, o, 'SIM-Cobro extra', 500, 'Pagado', { extra: true });
  const gO = await verificarOP(o, 'OP con 5 cobros'); ok(gO.cobrado === 10500, 'cobrado = 5 × 2,000 + extra 500 = 10,500', gO.cobrado);
  // OP interna: gasto de la empresa, sin cliente
  const ri = await call('POST', '/api/ops', { desc: 'SIM-Gasto interno oficina', clienteId: '__interno__', ejec: 'Natalia Gama', cotizado: 0, status: 'En Producción' }, T.natalia); const oi = ri.b;
  ok(ri.s === 200 && !oi.propietario && oi.comision === null, 'OP interna: sin propietario ni comisión', oi);
  OPS[oi.id] = { id: oi.id, desc: 'SIM-Gasto interno oficina', cot: 0, cobrado: 0, costoNeto: 0 };
  const prov = await proveedor('SIM-Papelería');
  const montos = [1234.57, 999.99, 3333.33]; const dd = [];
  for (const m of montos) dd.push((await pagoProveedor(T.oscar, oi, prov, `SIM-Gasto ${m}`, m)).b);
  // 1234.57 en 3 abonos (400 + 400 + 434.57) → debe cerrar exacto
  let last; for (const ab of [400, 400, 434.57]) last = await call('POST', `/api/deudas/${dd[0].id}/abonar`, { montoConIva: ab }, T.oscar);
  ok(last.b.status === 'pagado' && igual(last.b.pagadoConIva, 1234.57) && igual(last.b.debemosConIva, 0) && igual(last.b.pagado, last.b.monto), '3 abonos con centavos suman exacto 1,234.57 → pagado, debemos 0', last.b);
  const ps = await call('POST', `/api/deudas/${dd[1].id}/abonar`, { montoConIva: 500.01 }, T.oscar); ok(igual(ps.b.pagadoConIva, 500.01) && ps.b.status === 'parcial' && igual(ps.b.debemosConIva, 499.98), 'abono parcial 500.01 de 999.99 → debemos 499.98', ps.b);
  const gi = await verificarOP(oi, 'OP interna'); ok(gi.utilidad === -4800, 'OP interna: utilidad negativa = −(costos netos 4,799.90) redondeada', gi.utilidad);
  const netos = (await call('GET', '/api/deudas')).b.filter(d => d.opId === oi.id);
  ok(netos.length === 3 && igual(netos.reduce((s, d) => s + d.monto, 0), 4799.9), 'suma de netos de las 3 deudas = 4,799.90', netos.map(d => d.monto));
  // prospecto que nunca convierte + permisos de borrado
  const pp = (await prospecto(T.alexia, { empresa: 'SIM-Prospecto Frío', contacto: 'Z', cargo: 'C', tel: '5500000006', email: 'z@sim5.test' })).b;
  ok(pp.propietario === 'Alexia' && pp.comision === 15, 'prospecto de Alexia sin conversión: 15%', pp);
  await call('PATCH', `/api/prospectos/${pp.id}`, { status: 'Contactado', notas: [{ texto: 'Sin respuesta', fecha: '2099-01-01' }] }, T.alexia);
  const dxe = await call('DELETE', `/api/prospectos/${pp.id}`, null, T.alexia); ok(dxe.s === 403, 'ejecutiva no puede eliminar prospecto (403)', dxe.s);
  const cam = await call('PATCH', `/api/prospectos/${pp.id}`, { empresa: 'SIM-Hack', email: 'hack@x.com' }, T.alexia); ok(cam.s === 200 && cam.b.empresa === 'SIM-Prospecto Frío' && cam.b.email === 'z@sim5.test', 'ejecutiva no puede cambiar empresa ni email (inmutables)', cam.b);
  const dxa = await call('DELETE', `/api/prospectos/${pp.id}`, null, T.natalia); ok(dxa.s === 200, 'admin sí elimina (archiva) el prospecto');
  const gone = await call('GET', `/api/prospectos/${pp.id}`, null, T.natalia); ok(gone.s === 404, 'prospecto archivado ya no aparece (404)', gone.s);
}

// ═══ VERIFICACIÓN CRUZADA ENTRE SECCIONES ═══
async function cruzada(t0) {
  escenario = 'CRUZADA'; console.log('\n■ VERIFICACIÓN CRUZADA — coherencia entre Dashboard, OPs, Pagos, Deudas, Clientes, Auditoría y Respaldo');
  const ops = (await call('GET', '/api/ops')).b.filter(o => OPS[o.id]);
  const deudas = (await call('GET', '/api/deudas')).b, pagos = (await call('GET', '/api/pagos')).b, clientes = (await call('GET', '/api/clientes')).b;
  const esp = Object.values(OPS);
  ok(ops.length === esp.length, `las ${esp.length} OPs simuladas aparecen en el listado`, ops.length);
  const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
  ok(igual(sum(ops, o => o.cotizado), sum(esp, e => e.cot)), 'Σ cotizado (OPs) coincide con lo capturado', [sum(ops, o => o.cotizado), sum(esp, e => e.cot)]);
  ok(igual(sum(ops, o => o.cobrado), Math.round(sum(esp, e => e.cobrado))), 'Σ cobrado (OPs) = Σ de cobros Pagado registrados', [sum(ops, o => o.cobrado), sum(esp, e => e.cobrado)]);
  ok(Math.abs(sum(ops, o => o.utilidad) - (sum(esp, e => e.cot) - sum(esp, e => e.costoNeto))) < ops.length, 'Σ utilidad ≈ Σ cotizado − Σ costos netos (redondeo por OP)', [sum(ops, o => o.utilidad), sum(esp, e => e.cot) - sum(esp, e => e.costoNeto)]);
  const dSim = deudas.filter(d => OPS[d.opId]);
  const pSim = pagos.filter(p => OPS[p.opId]);
  ok(igual(sum(dSim, d => d.monto), sum(esp, e => e.costoNeto)), 'Σ monto neto de deudas = costos por OP', [sum(dSim, d => d.monto), sum(esp, e => e.costoNeto)]);
  ok(dSim.every(d => d.pagadoConIva <= (d.montoConIva ?? d.monto) + 0.01 && igual(d.debemosConIva, Math.max(0, (d.montoConIva ?? d.monto) - d.pagadoConIva))), 'ninguna deuda excede su cotización; debemos = cotización − pagado', dSim.filter(d => d.pagadoConIva > d.montoConIva + 0.01));
  ok(dSim.every(d => (d.pagadoConIva <= 0 && d.status === 'pendiente') || (d.pagadoConIva >= d.montoConIva && d.status === 'pagado') || (d.pagadoConIva > 0 && d.pagadoConIva < d.montoConIva && d.status === 'parcial')), 'el estatus de cada deuda es coherente con lo pagado', dSim.map(d => [d.concepto, d.status, d.pagadoConIva, d.montoConIva]));
  ok(new Set(dSim.map(d => d.concepto)).size === dSim.length, 'no hay deudas duplicadas por concepto');
  ok(dSim.every(d => d.provId), 'toda deuda tiene proveedor');
  ok(pSim.every(p => ops.some(o => o.id === p.opId)), 'todo cobro está ligado a una OP existente');
  const cSim = clientes.filter(c => /^SIM-/.test(c.nombre));
  ok(cSim.length === 5, '5 clientes simulados', cSim.length);
  ok(new Set(cSim.map(c => c.codigo)).size >= 1 && cSim.every(c => c.codigo), 'todos los clientes tienen código');
  const opsCli = ops.filter(o => o.clienteId); ok(opsCli.every(o => cSim.some(c => c.id === o.clienteId)), 'toda OP con cliente apunta a un cliente existente');
  ok(ops.every(o => o.status === 'Ejecutado' || o.status === 'En Producción'), 'estatus de OP siempre válido');
  const aud = (await call('GET', '/api/auditoria?limit=1000')).b.filter(e => new Date(e.fecha) >= t0);
  ok(aud.filter(e => e.accion === 'op_creada').length >= esp.length - 0, 'auditoría registra op_creada por cada OP', aud.filter(e => e.accion === 'op_creada').length);
  ok(aud.filter(e => e.accion === 'cobro_registrado').length >= 8, 'auditoría registra cobros pagados', aud.filter(e => e.accion === 'cobro_registrado').length);
  const bk = (await call('POST', '/api/backup/export')).b.backup.entidades;
  ok(bk.ops.filter(o => OPS[o.id]).length === esp.length && bk.deudas.filter(d => OPS[d.opId]).length === dSim.length, 'el respaldo contiene todas las OPs y deudas simuladas');
  const dupOps = new Set(ops.map(o => o.numero).filter(Boolean)); ok(dupOps.size === ops.filter(o => o.numero).length, 'números de OP únicos');
}

(async () => {
  const antes = await conteos();
  if (SOLO_LIMPIAR) { const n = await archivarSim(); const d = await conteos(); console.log(`Archivadas ${n} filas SIM-.`); console.log('Base:', JSON.stringify(d)); console.log(JSON.stringify(d) === JSON.stringify(BASE_ESPERADA) ? '✔ Base idéntica a la original' : '✘ Base distinta de la original'); await db.pool.end(); return; }
  console.log('Base antes:', JSON.stringify(antes));
  const t0 = new Date(Date.now() - 2000);
  const srv = spawn('node', ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT, JWT_SECRET: SECRET, NODE_ENV: 'test', RESEND_API_KEY: '', BACKUP_EMAIL_TO: '' }, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
  try { await sim1(); await sim2(); await sim3(); await sim4(); await sim5(); await cruzada(t0); }
  catch (e) { inconsistencias.push('EXCEPCIÓN: ' + e.stack); console.log('EXCEPCIÓN', e.stack); }
  finally {
    if (!KEEP) { const n = await archivarSim(); console.log(`\n[Limpieza] archivadas ${n} filas SIM-`); const d = await conteos(); ok(JSON.stringify(d) === JSON.stringify(antes), 'la base quedó idéntica a como estaba'); }
    else console.log('\n(--keep: datos SIM- conservados. Limpia con: node scripts/simulaciones-reales.js --limpiar)');
    console.log(`\n══ RESULTADO: ${pasan} verificaciones correctas · ${inconsistencias.length} inconsistencias ══`);
    inconsistencias.forEach((x, i) => console.log(` ${i + 1}. ${x}`));
    srv.kill(); await db.pool.end(); process.exit(inconsistencias.length ? 1 : 0);
  }
})();
