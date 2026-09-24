// PRUEBA E2E REAL — levanta el servidor local contra la base de Supabase real, recorre
// todo el flujo del negocio con datos marcados "E2E", los archiva al final y verifica que
// los conteos activos queden idénticos. Uso: node scripts/e2e-real.js   (no envía correos)
require('dotenv').config();
const { spawn } = require('child_process');
const jwt = require('jsonwebtoken');
const db = require('../api/db');
const PORT = 3131, B = `http://localhost:${PORT}`, SECRET = 'e2e-local-secret';
const tk = (u) => jwt.sign(u, SECRET, { expiresIn: '20m' });
const ADM = tk({ id: 'natalia', nombre: 'Natalia', role: 'admin', ejec: 'Natalia Gama' });
const EJEC = tk({ id: 'zz', nombre: 'Zoe E2E', role: 'ejecutivo', ejec: 'Zoe E2E' });
let pass = 0, fail = 0; const creados = []; // [tabla,id]
const ok = (c, m, extra) => { if (c) { pass++; console.log('  ✔', m); } else { fail++; console.log('  ✘ FALLA:', m, extra !== undefined ? JSON.stringify(extra).slice(0, 200) : ''); } };
async function call(method, path, body, token = ADM, form) {
  const opt = { method, headers: { Authorization: 'Bearer ' + token } };
  if (form) opt.body = form; else if (body) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch(B + path, opt); let j; try { j = await r.json(); } catch { j = null; } return { s: r.status, b: j };
}
const track = (t, id) => { if (id) creados.push([t, id]); };
async function counts() { const o = {}; for (const t of ['usuarios','clientes','prospectos','proveedores','ops','cotizaciones','deudas','pagos','casos','tickets','objetivos']) o[t] = (await db.pool.query(`select count(*)::int n from ${t} where deleted_at is null`)).rows[0].n; return o; }

(async () => {
  const base = await counts(); console.log('Base antes:', JSON.stringify(base));
  const srv = spawn('node', ['server.js'], { cwd: require('path').join(__dirname, '..'), env: { ...process.env, PORT, JWT_SECRET: SECRET, NODE_ENV: 'test', RESEND_API_KEY: '', BACKUP_EMAIL_TO: '' }, stdio: 'ignore' });
  for (let i = 0; i < 30; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
  try {
    console.log('\n[1] Salud, seguridad y estáticos');
    ok((await fetch(B + '/api/health')).ok, 'health');
    ok((await call('GET', '/api/clientes', null, 'basura')).s === 401, 'token inválido → 401');
    ok((await fetch(B + '/')).status === 200 && (await (await fetch(B + '/js/app.js')).text()).length > 1000, 'index y app.js se sirven');
    for (const f of ['db.js','auth.js']) ok((await fetch(`${B}/js/${f}`)).status === 200, `js/${f}`);

    console.log('\n[2] Cliente → OP (herencia de roles y número)');
    let r = await call('POST', '/api/clientes', { nombre: 'E2E Cliente', razon: 'E2E SA', rfc: 'EEE123456AB1', dir: 'CDMX', contacto: 'X', cargo: 'Y', tel: '5500000000', email: 'e2e@test.com', propietario: 'Natalia Gama', pago: '30 días', status: 'Activo' });
    const cli = r.b; track('clientes', cli?.id);
    ok(r.s === 200 && /^EEE-NAT-\d{6}$/.test(cli.codigo), 'cliente creado con código', cli?.codigo);
    ok(cli.propietario === 'Natalia Gama' && cli.comision === 15, 'propietario y comisión 15%', [cli.propietario, cli.comision]);
    r = await call('POST', '/api/ops', { desc: 'E2E Evento', clienteId: cli.id, fechaEvento: '2099-01-01', cotizado: 100000, status: 'En Producción' });
    const op = r.b; track('ops', op?.id);
    ok(r.s === 200 && op.numero === `${cli.codigo}-01`, 'OP con número código-01', r.b);
    ok(op.propietario === 'Natalia Gama' && op.comision === 15 && op.utilidad === 100000, 'OP hereda roles/comisión, utilidad = cotizado');
    r = await call('POST', '/api/ops', { desc: 'E2E 2', clienteId: cli.id, cotizado: 1 }); track('ops', r.b?.id);
    ok(r.b?.numero === `${cli.codigo}-02`, 'segunda OP → -02', r.b?.numero);

    console.log('\n[2b] Robustez');
    const sim = await Promise.all([1, 2, 3].map(i => call('POST', '/api/ops', { desc: 'E2E sim ' + i, clienteId: cli.id, cotizado: 1, status: 'En Producción' })));
    sim.forEach(x => track('ops', x.b?.id));
    const nums = sim.map(x => x.b?.numero);
    ok(sim.every(x => x.s === 200) && new Set(nums).size === 3, '3 OPs simultáneas del mismo cliente → 3 números distintos (reintento)', nums);
    r = await call('GET', '/api/ops/no-es-uuid'); ok(r.s === 400 && !/uuid|syntax/i.test(r.b.error), 'id con formato inválido → 400 sin filtrar SQL', r.b);
    r = await call('POST', '/api/deudas', { concepto: 'E2E mala ref', provId: 'no-es-uuid', montoConIva: 1 }); ok(r.s === 400 && !/uuid/i.test(r.b.error), 'referencia inválida → 400 amigable', r.b);
    r = await call('POST', '/api/ops', { desc: 'E2E estatus malo', clienteId: cli.id, status: 'Inventado' }); ok(r.s === 400 && /no permitido/.test(r.b.error), 'estatus no permitido → 400 amigable', r.b);

    console.log('\n[3] Proveedor → Deuda → abonos (transacciones y bloqueo)');
    r = await call('POST', '/api/proveedores', { nombre: 'E2E Proveedor', rfc: 'PPP010101AA1', emiteFactura: true, cond: 'Contado' }); const prov = r.b; track('proveedores', prov?.id);
    ok(r.s === 200 && prov.factura.startsWith('Sí'), 'proveedor creado');
    r = await call('POST', '/api/deudas', { concepto: 'E2E Audio', provId: prov.id, opId: op.id, montoConIva: 11600, fechaAcordada: '2099-01-02' }); const de = r.b; track('deudas', de?.id);
    ok(r.s === 200 && de.monto === 10000 && de.status === 'pendiente' && de.provId === prov.id, 'deuda 11,600 con IVA → neto 10,000', de);
    let g = await call('GET', `/api/ops/${op.id}`); ok(g.b.utilidad === 90000 && g.b.costosReales === 10000, 'utilidad OP = 100,000 − 10,000', g.b);
    // concurrencia: dos abonos de 8,000 sobre 11,600 al mismo tiempo → solo uno debe entrar
    const [a1, a2] = await Promise.all([call('POST', `/api/deudas/${de.id}/abonar`, { montoConIva: 8000 }), call('POST', `/api/deudas/${de.id}/abonar`, { montoConIva: 8000 })]);
    ok([a1.s, a2.s].sort().join() === '200,400', 'abonos simultáneos: uno pasa y otro se rechaza (sin sobrepago)', [a1.s, a2.s]);
    r = await call('POST', `/api/deudas/${de.id}/abonar`, { montoConIva: 3600 });
    ok(r.s === 200 && r.b.status === 'pagado' && r.b.pagadoConIva === 11600 && r.b.debemosConIva === 0, 'abono final → pagado exacto 11,600', r.b);
    g = await call('GET', '/api/deudas'); ok(g.b.filter(d => d.concepto === 'E2E Audio').length === 1, 'sigue habiendo UNA sola deuda (sin duplicados)');
    g = await call('GET', `/api/ops/${op.id}`); ok(g.b.utilidad === 90000, 'utilidad no se movió al pagar');
    r = await call('PATCH', `/api/deudas/${de.id}`, { status: 'pendiente' }); ok(r.b.status === 'pagado', 'status no se puede forzar por PATCH');

    console.log('\n[4] Cobros a cliente');
    r = await call('POST', '/api/pagos', { concepto: 'E2E Anticipo', tipo: 'Cobro a cliente', opId: op.id, monto: 50000, status: 'Pagado', fechaAcordada: '2099-01-01' }); track('pagos', r.b?.id);
    ok(r.s === 200 && r.b.monto === 50000, 'cobro registrado');
    r = await call('POST', '/api/pagos', { concepto: 'E2E Pend', tipo: 'Cobro a cliente', opId: op.id, monto: 999, status: 'Pendiente', fechaAcordada: '2000-01-01' }); track('pagos', r.b?.id);
    ok(r.b.status === 'Vencido', 'pendiente con fecha pasada → Vencido efectivo', r.b.status);
    g = await call('GET', `/api/ops/${op.id}`); ok(g.b.cobrado === 50000, 'cobrado OP = solo cobros Pagado', g.b.cobrado);

    console.log('\n[5] Cotización con archivo (Storage privado, URL firmada)');
    const pdf = Buffer.from('%PDF-1.4 e2e-contenido-unico');
    const form = new FormData(); form.append('cotId', 'E2E-COT'); form.append('opId', op.id); form.append('clienteId', cli.id); form.append('pdf', new Blob([pdf], { type: 'application/pdf' }), 'e2e.pdf');
    r = await call('POST', '/api/cotizaciones', null, ADM, form); const cot = r.b; track('cotizaciones', cot?.id);
    ok(r.s === 200 && cot.pdf.length === 1 && cot.propietario === 'Natalia Gama', 'cotización creada, hereda roles', r.b);
    if (cot?.pdf?.[0]) { const f = await fetch(cot.pdf[0].url); ok(f.status === 200 && Buffer.from(await f.arrayBuffer()).equals(pdf), 'URL firmada devuelve el mismo PDF'); const u = cot.pdf[0].url.split('?')[0]; ok((await fetch(u)).status !== 200, 'sin firma NO se puede abrir (bucket privado)'); }
    r = await call('PATCH', `/api/cotizaciones/${cot.id}`, null, ADM, (() => { const f = new FormData(); f.append('status', 'Aprobada'); return f; })()); ok(r.s === 200 && r.b.status === 'Aprobada', 'PATCH cotización');

    console.log('\n[6] Casos y tickets');
    r = await call('POST', '/api/casos', { titulo: 'E2E Caso', clienteId: cli.id, opId: op.id, tipo: 'Queja', prio: 'Alta', historial: [{ t: 'x' }] }); const caso = r.b; track('casos', caso?.id);
    ok(r.s === 200 && caso.historial.length === 1, 'caso con historial JSON');
    r = await call('PATCH', `/api/casos/${caso.id}`, { status: 'Cerrado' }); ok(r.b.status === 'Cerrado', 'PATCH caso');
    r = await call('POST', '/api/tickets', { tipo: 'E2E Ticket', cotId: cot.id, monto: '100', status: 'Abierto' }); track('tickets', r.b?.id);
    ok(r.s === 200 && r.b.cotId === cot.id, 'ticket ligado a cotización');

    console.log('\n[7] Prospectos y objetivos');
    r = await call('POST', '/api/prospectos', { empresa: 'E2E Prospecto SA', contacto: 'Z', email: 'p@e2e.com', fuente: 'Referido', notas: [{ texto: 'n' }] }); const pr = r.b; track('prospectos', pr?.id);
    ok(r.s === 200 && pr.notas.length === 1 && pr.creado, 'prospecto creado con notas y fecha de alta', pr);
    r = await call('PATCH', `/api/prospectos/${pr.id}`, { status: 'Contactado' }); ok(r.b.status === 'Contactado', 'PATCH prospecto');
    r = await call('PUT', '/api/objetivos/2099', { metaVentas: 5000000, objetivosIndividuales: { Ximena: 1000 } }); ok(r.s === 200, 'PUT objetivos 2099', r.b);
    g = await call('GET', '/api/objetivos/2099'); ok(g.b.metaVentas === 5000000 && g.b.objetivosIndividuales.Ximena === 1000, 'GET objetivos');
    const ob = await db.queryDB('objetivos', { anio: 2099 }); ob.forEach(o => track('objetivos', o.id));

    console.log('\n[8] Permisos por rol');
    g = await call('GET', `/api/ops/${op.id}`, null, EJEC); ok(g.s === 403, 'ejecutivo ajeno NO ve la OP (403)', g.s);
    g = await call('GET', '/api/ops', null, EJEC); ok(g.s === 200 && !g.b.some(o => o.id === op.id), 'ejecutivo no la ve en listados');
    g = await call('GET', '/api/deudas', null, EJEC); ok(g.s === 403, 'ejecutivo no ve deudas (403)');
    g = await call('GET', '/api/auditoria', null, EJEC); ok(g.s === 403, 'ejecutivo no ve auditoría (403)');
    g = await call('DELETE', `/api/clientes/${cli.id}`, null, EJEC); ok(g.s === 403, 'ejecutivo no puede eliminar (403)');
    g = await call('GET', '/api/ops/00000000-0000-0000-0000-000000000000'); ok(g.s === 404, 'id inexistente → 404', g.s);

    console.log('\n[9] Usuarios, login real, cambio de contraseña');
    const uname = 'e2e' + Date.now();
    r = await call('POST', '/api/auth/usuarios', { usuario: uname, nombre: 'E2E Usuario', email: `${uname}@example.com`, rol: 'ejecutivo' });
    ok(r.s === 201 && r.b.passwordTemporal, 'admin crea usuario con contraseña temporal');
    const ur = await db.queryDB('usuarios', { usuario: uname }); ur.forEach(u => track('usuarios', u.id));
    let lg = await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario: uname, password: r.b.passwordTemporal }) }); lg = await lg.json();
    ok(lg.token && lg.mustChangePassword === true, 'login real con temporal → debe cambiar contraseña', lg);
    let bad = await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario: uname, password: 'mala' }) }); ok(bad.status === 401, 'contraseña mala → 401');
    g = await call('GET', '/api/clientes', null, lg.token); ok(g.s === 403 && g.b.error === 'PASSWORD_CHANGE_REQUIRED', 'bloquea la API hasta cambiar contraseña');
    const nueva = 'E2eClave!2026xyz';
    g = await call('POST', '/api/auth/cambiar-password', { passwordActual: r.b.passwordTemporal, passwordNuevo: nueva }, lg.token); ok(g.s === 200 && g.b.token, 'cambio de contraseña');
    g = await call('GET', '/api/clientes', null, g.b.token); ok(g.s === 200, 'con contraseña nueva ya accede');
    g = await call('POST', `/api/auth/usuarios/${uname}/activar`, { activo: false }); ok(g.s === 200, 'admin desactiva usuario');
    bad = await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario: uname, password: nueva }) }); ok(bad.status === 401, 'usuario desactivado no entra');

    console.log('\n[10] Auditoría, respaldo, roster');
    g = await call('GET', '/api/auditoria?limit=50'); ok(g.s === 200 && g.b.some(e => e.accion === 'op_creada') && g.b.some(e => e.accion === 'login_exitoso'), 'auditoría registra op_creada y login_exitoso');
    g = await call('POST', '/api/backup/export'); ok(g.s === 200 && g.b.backup.entidades.clientes.length >= 17 && !JSON.stringify(g.b.backup.entidades.usuarios).includes('passwordHash'), 'respaldo completo sin hashes');
    g = await call('GET', '/api/auth/roster-ejecutivos', null, EJEC); ok(g.s === 200 && g.b.includes('Natalia Gama'), 'roster de ejecutivos', g.b);
    g = await call('GET', '/api/dashboard-inexistente'); ok(g.s === 404 || g.s === 200, 'ruta inexistente no revienta el servidor', g.s);
  } catch (e) { fail++; console.log('  ✘ EXCEPCIÓN:', e.stack); }
  finally {
    console.log('\n[Limpieza] archivando datos E2E (borrado lógico)…');
    for (const [t, id] of creados.reverse()) await db.pool.query(`update ${t} set deleted_at = now() where id = $1`, [id]);
    const s3 = (await db.pool.query("select pdf_url from cotizaciones where cot_id='E2E-COT'")).rows;
    await db.pool.query("update auditoria set deleted_at = now() where usuario in ('e2e')").catch(() => {});
    const after = await counts();
    ok(JSON.stringify(after) === JSON.stringify(base), 'la base quedó EXACTAMENTE como antes (conteos activos)', { base, after });
    console.log(`\nRESULTADO: ${pass} correctas, ${fail} fallas`);
    srv.kill(); await db.pool.end(); process.exit(fail ? 1 : 0);
  }
})();
