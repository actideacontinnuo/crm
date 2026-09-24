// Migración única Notion → Postgres. Uso:
//   node scripts/migrar-notion-a-postgres.js            (simulación: NO escribe, hace ROLLBACK)
//   node scripts/migrar-notion-a-postgres.js --aplicar  (escribe de verdad, en UNA transacción)
// Aborta si alguna tabla destino ya tiene datos. Notion NO se modifica (solo lectura).
require('dotenv').config();
const notion = require('../api/notion');
const { pool, toSnake } = require('../api/db');

const APLICAR = process.argv.includes('--aplicar');
const advertencias = [];
const warn = m => advertencias.push(m);

const { read_title: title, read_text: text, read_number: num, read_select: sel, read_date: date,
        read_checkbox: chk, read_email: email, read_phone: phone } = notion;

const idMap = { clientes: {}, proveedores: {}, ops: {} };

async function insertar(client, tabla, data, createdAt) {
  const row = { ...data };
  if (createdAt) row.createdAt = createdAt;
  const cols = Object.keys(row).filter(k => row[k] !== undefined);
  const sql = `INSERT INTO ${tabla} (${cols.map(toSnake).join(',')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING id`;
  const r = await client.query(sql, cols.map(k => row[k]));
  return r.rows[0].id;
}

const ref = (mapa, notionId, ctx) => {
  if (!notionId || notionId === '__interno__') return null;
  if (mapa[notionId]) return mapa[notionId];
  warn(`${ctx}: referencia ${notionId} no existe en la tabla destino → se deja NULL`);
  return null;
};
const jsonOr = (s, fallback) => { try { const v = JSON.parse(s || ''); return v ?? fallback; } catch { return fallback; } };

async function main() {
  const client = await pool.connect();
  try {
    for (const t of ['usuarios','clientes','prospectos','proveedores','ops','cotizaciones','deudas','pagos','casos','tickets','objetivos','auditoria']) {
      const { rows } = await client.query(`SELECT count(*)::int n FROM ${t}`);
      if (rows[0].n > 0) throw new Error(`La tabla destino "${t}" ya tiene ${rows[0].n} filas — abortado, no se toca nada.`);
    }
    const leer = t => notion.queryDB(t, null);
    const N = {};
    for (const t of ['usuarios','clientes','prospectos','proveedores','ops','cotizaciones','deudas','pagos','casos','tickets','objetivos','auditoria','seguridad']) N[t] = await leer(t);
    console.log('Leído de Notion:', Object.fromEntries(Object.entries(N).map(([k, v]) => [k, v.length])));

    await client.query('BEGIN');
    const cuenta = {};
    const inc = t => { cuenta[t] = (cuenta[t] || 0) + 1; };

    for (const pg of N.usuarios) {
      const p = pg.properties;
      await insertar(client, 'usuarios', {
        usuario: title(p['Usuario']), nombre: text(p['Nombre']), email: email(p['Email']) || null,
        passwordHash: text(p['PasswordHash']), rol: sel(p['Rol']), ejec: text(p['Ejecutivo']) || null,
        activo: chk(p['Activo']), mustChangePassword: chk(p['DebeCambiarPassword']),
        twoFaSecret: text(p['TwoFASecret']) || null, twoFaEnabled: chk(p['TwoFAEnabled']),
        resetToken: text(p['ResetToken']) || null, resetTokenExpira: date(p['ResetExpira']),
        intentosFallidos: num(p['IntentosFallidos']), bloqueadoHasta: date(p['BloqueadoHasta']),
      }, pg.created_time); inc('usuarios');
    }

    for (const pg of N.clientes) {
      const p = pg.properties;
      idMap.clientes[pg.id] = await insertar(client, 'clientes', {
        nombre: title(p['Nombre']), codigo: text(p['Codigo']), razon: text(p['Razon Social']), rfc: text(p['RFC']),
        dir: text(p['Direccion']), contacto: text(p['Contacto']), cargo: text(p['Cargo']),
        tel: phone(p['Telefono']), email: email(p['Email']),
        ejec: sel(p['Ejecutivo']), propietario: sel(p['Propietario']), ejecCuenta: sel(p['EjecutivoCuenta']),
        ejecAsignado: sel(p['EjecutivoAsignado']), comision: p['Comision']?.number ?? null,
        pago: sel(p['Condiciones de Pago']), status: sel(p['Status']), docs: text(p['Docs']),
      }, pg.created_time); inc('clientes');
    }

    for (const pg of N.proveedores) {
      const p = pg.properties;
      idMap.proveedores[pg.id] = await insertar(client, 'proveedores', {
        nombre: title(p['Nombre']), razon: text(p['Razón Social']), rfc: text(p['RFC']), banco: sel(p['Banco']),
        clabe: text(p['CLABE']), servicio: text(p['Servicio']), cond: sel(p['Condiciones de Pago']),
        emiteFactura: chk(p['Emite Factura']), contacto: text(p['Contacto']), tel: phone(p['Tel']),
        email: email(p['Email']), notas: text(p['Notas']),
      }, pg.created_time); inc('proveedores');
    }

    for (const pg of N.prospectos) {
      const p = pg.properties;
      await insertar(client, 'prospectos', {
        empresa: title(p['Empresa']), contacto: text(p['Contacto']), cargo: text(p['Cargo']),
        telefono: phone(p['Telefono']), email: email(p['Email']), evento: text(p['Evento']),
        estimado: p['Estimado']?.number ?? null,
        ejec: sel(p['Ejecutivo']), propietario: sel(p['Propietario']), ejecCuenta: sel(p['EjecutivoCuenta']),
        ejecAsignado: sel(p['EjecutivoAsignado']), comision: p['Comision']?.number ?? null,
        fuente: sel(p['Fuente']), status: sel(p['Status']) || 'Nuevo', seguimiento: date(p['Seguimiento']),
        notas: JSON.stringify(jsonOr(text(p['Notas']), [])),
        sector: sel(p['Sector']) || null, confianzaIa: p['ConfianzaIA']?.number ?? null,
        verificacionIa: sel(p['VerificacionIA']) || 'Pendiente', numEmpleados: p['NumEmpleados']?.number ?? null,
        tamanoEmpresa: sel(p['TamanoEmpresa']) || null, origenCarga: sel(p['OrigenCarga']) || null,
        correoGenerado: chk(p['CorreoGenerado']),
      }, pg.created_time); inc('prospectos');
    }

    for (const pg of N.ops) {
      const p = pg.properties;
      idMap.ops[pg.id] = await insertar(client, 'ops', {
        numero: title(p['Número OP']), descripcion: text(p['Descripción']),
        clienteId: ref(idMap.clientes, text(p['Cliente ID']), `OP ${title(p['Número OP'])}`),
        ejec: sel(p['Ejecutivo']), propietario: sel(p['Propietario']), ejecCuenta: sel(p['EjecutivoCuenta']),
        ejecAsignado: sel(p['EjecutivoAsignado']), fechaEvento: date(p['Fecha Evento']),
        cotizado: num(p['Cotizado']),
        status: sel(p['Status']), bono: text(p['Bono']), comision: p['Comision']?.number ?? null,
      }, pg.created_time); inc('ops');
    }

    for (const pg of N.deudas) {
      const p = pg.properties;
      const conIva = p['Monto con IVA']?.number ?? null;
      await insertar(client, 'deudas', {
        concepto: title(p['Concepto']),
        proveedorId: ref(idMap.proveedores, text(p['Proveedor ID']), `Deuda ${title(p['Concepto'])} (proveedor)`),
        opId: ref(idMap.ops, text(p['OP ID']), `Deuda ${title(p['Concepto'])} (OP)`),
        monto: num(p['Monto']), montoConIva: conIva, pagado: num(p['Pagado']), pagadoConIva: num(p['Pagado con IVA']),
        fechaAcordada: date(p['Fecha Acordada']), status: sel(p['Status']) || 'pendiente',
      }, pg.created_time); inc('deudas');
    }

    for (const pg of N.pagos) {
      const p = pg.properties;
      await insertar(client, 'pagos', {
        concepto: title(p['Concepto']), tipo: sel(p['Tipo']),
        opId: ref(idMap.ops, text(p['OP ID']), `Pago ${title(p['Concepto'])}`),
        monto: num(p['Monto']), fechaAcordada: date(p['Fecha Acordada']), fechaReal: date(p['Fecha Real']),
        status: sel(p['Status']), forma: sel(p['Forma de Pago']), ref: text(p['Referencia']),
        comprobante: chk(p['Comprobante']), extra: chk(p['Extra']),
      }, pg.created_time); inc('pagos');
    }

    for (const pg of N.auditoria) {
      const p = pg.properties;
      await insertar(client, 'auditoria', {
        usuario: text(p['Usuario']), accion: sel(p['Accion']) || 'desconocida', entidad: text(p['Entidad']),
        detalle: text(p['Detalle']), ip: text(p['IP']), exito: chk(p['Exito']),
        fueraDeHorario: chk(p['FueraDeHorario']), fecha: date(p['Fecha']) || pg.created_time,
      }); inc('auditoria');
    }

    if (N.seguridad[0]) {
      const bloq = chk(N.seguridad[0].properties['BloquearTodoElAcceso']);
      await client.query('UPDATE seguridad SET bloquear_todo_el_acceso = $1', [bloq]);
    }

    // ── Verificación numérica contra lo leído de Notion ──
    const esperado = {
      usuarios: N.usuarios.length, clientes: N.clientes.length, proveedores: N.proveedores.length,
      prospectos: N.prospectos.length, ops: N.ops.length, deudas: N.deudas.length, pagos: N.pagos.length,
      auditoria: N.auditoria.length,
    };
    for (const [t, n] of Object.entries(esperado)) {
      const { rows } = await client.query(`SELECT count(*)::int n FROM ${t}`);
      if (rows[0].n !== n) throw new Error(`Verificación falló en ${t}: Notion=${n} Postgres=${rows[0].n}`);
    }
    const suma = async (t, c) => Number((await client.query(`SELECT COALESCE(SUM(${c}),0) s FROM ${t}`)).rows[0].s);
    const sumaN = (arr, f) => Math.round(arr.reduce((a, pg) => a + (f(pg.properties) || 0), 0) * 100) / 100;
    const checks = [
      ['deudas.monto', await suma('deudas', 'monto'), sumaN(N.deudas, p => p['Monto']?.number)],
      ['deudas.pagado', await suma('deudas', 'pagado'), sumaN(N.deudas, p => p['Pagado']?.number)],
      ['deudas.pagado_con_iva', await suma('deudas', 'pagado_con_iva'), sumaN(N.deudas, p => p['Pagado con IVA']?.number)],
      ['pagos.monto', await suma('pagos', 'monto'), sumaN(N.pagos, p => p['Monto']?.number)],
      ['ops.cotizado', await suma('ops', 'cotizado'), sumaN(N.ops, p => p['Cotizado']?.number)],
    ];
    for (const [nombre, pgv, nv] of checks) {
      console.log(`  suma ${nombre}: Notion=${nv}  Postgres=${pgv}  ${Math.abs(pgv - nv) < 0.005 ? 'OK' : 'DIFERENTE'}`);
      if (Math.abs(pgv - nv) >= 0.005) throw new Error(`Suma distinta en ${nombre}`);
    }

    console.log('Filas insertadas:', cuenta);
    if (advertencias.length) console.log('ADVERTENCIAS:\n - ' + advertencias.join('\n - '));
    if (APLICAR) { await client.query('COMMIT'); console.log('\n✔ APLICADO: datos escritos en Postgres.'); }
    else { await client.query('ROLLBACK'); console.log('\n(Simulación completa: ROLLBACK, no se escribió nada. Usa --aplicar para escribir.)'); }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\n✘ ERROR — nada se escribió:', err.message);
    process.exitCode = 1;
  } finally { client.release(); await pool.end(); }
}
main();
