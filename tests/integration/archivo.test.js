/**
 * Integration tests — Archivar y restaurar registros desde el OS (solo oficina total)
 */
const request = require('supertest');
const mockDb  = require('../helpers/mock-db');

jest.mock('../../api/db', () => require('../helpers/mock-db'));
jest.mock('../../api/_audit', () => ({ logAudit: jest.fn(), clientIp: () => '127.0.0.1' }));

const { buildApp } = require('../helpers/test-app');
const { logAudit } = require('../../api/_audit');
const jwt = require('jsonwebtoken');
const { SECRET } = require('../../middleware/auth');

const tok = (id, nombre, role, ejec) => jwt.sign({ id, nombre, role, ejec }, SECRET, { expiresIn: '1h' });
const natalia = () => tok('natalia', 'Natalia', 'admin', 'Natalia Gama');
const oscar   = () => tok('oscar', 'Oscar', 'administracion', 'Oscar');
const eduardo = () => tok('eduardo', 'Eduardo', 'administracion', 'Eduardo Gama'); // socio: NO es oficina total
const alexia  = () => tok('alexia', 'Alexia', 'ejecutivo', 'Alexia');

let app;
beforeEach(() => {
  logAudit.mockClear();
  mockDb.resetStore();
  mockDb.addEjecutivo('Alexia', 'alexia-roster');
  require('../../api/_roles')._resetRosterCacheForTests();
  app = buildApp();
});

const A = t => ({ Authorization: `Bearer ${t}` });
const post = (ruta, body, t = natalia()) => request(app).post(ruta).set(A(t)).send(body || {});
const get  = (ruta, t = natalia()) => request(app).get(ruta).set(A(t));

async function cliente(extra = {}) {
  return (await post('/api/clientes', { nombre: 'Cliente ' + Math.random(), rfc: 'ABC123456XY1', propietario: 'Alexia', status: 'Activo', ...extra })).body;
}
async function opDe(cli, extra = {}) {
  return (await post('/api/ops', { desc: 'Evento', clienteId: cli.id, cotizado: 100000, status: 'En Producción', ...extra })).body;
}
async function proveedor(nombre = 'Prov SA') { return (await post('/api/proveedores', { nombre })).body; }
async function deuda(op, prov, concepto, montoConIva = 11600) {
  return (await post('/api/deudas', { provId: prov.id, opId: op.id, concepto, montoConIva })).body;
}
const archivar = (entidad, id, motivo = 'Duplicado, capturado por error', t = natalia()) => post(`/api/archivo/archivar/${entidad}/${id}`, { motivo }, t);

describe('Permisos', () => {
  test('Natalia y Oscar pueden archivar; Eduardo (socio) y los ejecutivos NO (403)', async () => {
    const p1 = (await post('/api/prospectos', { empresa: 'P1', propietario: 'Alexia' })).body;
    const p2 = (await post('/api/prospectos', { empresa: 'P2', propietario: 'Alexia' })).body;
    const p3 = (await post('/api/prospectos', { empresa: 'P3', propietario: 'Alexia' })).body;
    expect((await archivar('prospecto', p1.id, undefined, natalia())).status).toBe(200);
    expect((await archivar('prospecto', p2.id, undefined, oscar())).status).toBe(200);
    expect((await archivar('prospecto', p3.id, undefined, eduardo())).status).toBe(403);
    expect((await archivar('prospecto', p3.id, undefined, alexia())).status).toBe(403);
    expect((await get('/api/archivo/lista', alexia())).status).toBe(403);
    expect((await get(`/api/archivo/impacto/prospecto/${p3.id}`, eduardo())).status).toBe(403);
    expect((await post('/api/archivo/restaurar/x', {}, alexia())).status).toBe(403);
  });
});

describe('Motivo obligatorio', () => {
  test('sin motivo, vacío o muy corto → 400, y el registro NO se archiva', async () => {
    const p = (await post('/api/prospectos', { empresa: 'P', propietario: 'Alexia' })).body;
    for (const motivo of [undefined, '', '   ', 'xx']) {
      const r = await post(`/api/archivo/archivar/prospecto/${p.id}`, { motivo });
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/motivo/i);
    }
    expect((await get(`/api/prospectos/${p.id}`)).status).toBe(200);
  });
  test('motivo larguísimo → 400', async () => {
    const p = (await post('/api/prospectos', { empresa: 'P', propietario: 'Alexia' })).body;
    expect((await archivar('prospecto', p.id, 'x'.repeat(301))).status).toBe(400);
  });
});

describe('Archivar un registro suelto y dejar constancia', () => {
  test('prospecto: desaparece del OS, queda en la lista de archivados con motivo, quién y cuándo, y en Auditoría', async () => {
    const p = (await post('/api/prospectos', { empresa: 'Empresa Duplicada', propietario: 'Alexia' })).body;
    const r = await archivar('prospecto', p.id, 'Está duplicado con otro registro');
    expect(r.status).toBe(200);
    expect((await get('/api/prospectos')).body.some(x => x.id === p.id)).toBe(false);
    const lista = (await get('/api/archivo/lista', oscar())).body;
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ tipo: 'Prospecto', etiqueta: 'Empresa Duplicada', motivo: 'Está duplicado con otro registro', usuario: 'Natalia Gama', arrastrados: 0 });
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ accion: 'registro_archivado', entidad: 'Empresa Duplicada' }));
  });

  test('id inexistente → 404 y tipo inventado → 400', async () => {
    expect((await archivar('prospecto', 'no-existe')).status).toBe(404);
    expect((await archivar('usuario', 'x')).status).toBe(400);
  });

  test('no se puede archivar dos veces el mismo registro', async () => {
    const p = (await post('/api/prospectos', { empresa: 'P', propietario: 'Alexia' })).body;
    await archivar('prospecto', p.id);
    expect((await archivar('prospecto', p.id)).status).toBe(404);
  });
});

describe('Impacto antes de archivar (no cambia nada)', () => {
  test('OP: cuenta lo que arrastra y explica el efecto en cobrado y costos', async () => {
    const cli = await cliente(); const op = await opDe(cli); const prov = await proveedor();
    await deuda(op, prov, 'Audio', 11600); await deuda(op, prov, 'Catering', 5800);
    await post('/api/pagos', { tipo: 'Cobro a cliente', concepto: 'Anticipo', opId: op.id, monto: 50000, status: 'Pagado' });
    const r = await get(`/api/archivo/impacto/op/${op.id}`);
    expect(r.status).toBe(200);
    expect(r.body.puedeArchivar).toBe(true);
    expect(r.body.arrastra.map(a => a.texto)).toEqual(expect.arrayContaining(['2 pago(s) a proveedor', '1 cobro(s)/pago(s)']));
    expect(r.body.efectos.join(' ')).toMatch(/\$50,000 de cobrado/);
    expect(r.body.efectos.join(' ')).toMatch(/\$15,000 de costos/); // (11600+5800)/1.16
    expect((await get(`/api/ops/${op.id}`)).status).toBe(200); // no se archivó
  });

  test('deuda con abonos: avisa que archivar no revierte el dinero ya pagado', async () => {
    const cli = await cliente(); const op = await opDe(cli); const prov = await proveedor();
    const d = await deuda(op, prov, 'Audio', 11600);
    await post(`/api/deudas/${d.id}/abonar`, { montoConIva: 5000 });
    const r = await get(`/api/archivo/impacto/deuda/${d.id}`);
    expect(r.body.efectos.join(' ')).toMatch(/Ya tiene \$5,000 abonados/);
    expect(r.body.efectos.join(' ')).toMatch(/utilidad subirá/);
  });
});

describe('Bloqueos', () => {
  test('un cliente con OPs activas NO se puede archivar (409) y se explica por qué', async () => {
    const cli = await cliente(); const op = await opDe(cli);
    const imp = await get(`/api/archivo/impacto/cliente/${cli.id}`);
    expect(imp.body.puedeArchivar).toBe(false);
    expect(imp.body.bloqueos[0]).toContain(op.numero);
    const r = await archivar('cliente', cli.id);
    expect(r.status).toBe(409);
    expect((await get(`/api/clientes/${cli.id}`)).status).toBe(200);
  });

  test('tras archivar sus OPs, el cliente sí se puede archivar', async () => {
    const cli = await cliente(); const op = await opDe(cli);
    expect((await archivar('op', op.id)).status).toBe(200);
    expect((await archivar('cliente', cli.id)).status).toBe(200);
  });

  test('un proveedor con pagos registrados NO se puede archivar', async () => {
    const cli = await cliente(); const op = await opDe(cli); const prov = await proveedor();
    await deuda(op, prov, 'Audio');
    const r = await archivar('proveedor', prov.id);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/pago\(s\) a proveedor/);
  });

  test('un proveedor sin movimientos sí', async () => {
    const prov = await proveedor('Sin uso');
    expect((await archivar('proveedor', prov.id)).status).toBe(200);
  });
});

describe('Archivar una OP completa y restaurarla', () => {
  async function opConTodo() {
    const cli = await cliente(); const op = await opDe(cli); const prov = await proveedor();
    const d = await deuda(op, prov, 'Audio', 11600);
    await post('/api/pagos', { tipo: 'Cobro a cliente', concepto: 'Anticipo', opId: op.id, monto: 50000, status: 'Pagado' });
    const form = request(app).post('/api/cotizaciones').set(A(natalia())).field('cotId', 'COT-1').field('opId', op.id).field('clienteId', cli.id)
      .attach('pdf', Buffer.from('%PDF-1.4'), { filename: 'c.pdf', contentType: 'application/pdf' });
    const cot = (await form).body;
    await post('/api/casos', { titulo: 'Caso de la OP', clienteId: cli.id, opId: op.id, tipo: 'Queja' });
    await post('/api/tickets', { tipo: 'Ajuste', cotId: cot.id });
    return { cli, op, prov, d, cot };
  }

  test('arrastra deudas, cobros, cotizaciones, casos y tickets; las cifras globales dejan de contarla', async () => {
    const { op } = await opConTodo();
    const r = await archivar('op', op.id, 'OP creada por error');
    expect(r.status).toBe(200);
    expect(r.body.arrastrados).toBe(5); // 1 deuda + 1 cobro + 1 cotización + 1 caso + 1 ticket
    expect((await get('/api/ops')).body).toHaveLength(0);
    expect((await get('/api/deudas')).body).toHaveLength(0);
    expect((await get('/api/pagos')).body).toHaveLength(0);
    expect((await get('/api/cotizaciones')).body).toHaveLength(0);
    expect((await get('/api/casos')).body).toHaveLength(0);
    expect((await get('/api/tickets')).body).toHaveLength(0);
    const lista = (await get('/api/archivo/lista')).body;
    expect(lista).toHaveLength(1); // una sola fila visible: la OP
    expect(lista[0].arrastrados).toBe(5);
  });

  test('restaurar devuelve la OP y TODO lo que arrastró, y la quita de la lista', async () => {
    const { op } = await opConTodo();
    await archivar('op', op.id);
    const grupo = (await get('/api/archivo/lista')).body[0].grupo;
    const r = await post(`/api/archivo/restaurar/${grupo}`);
    expect(r.status).toBe(200);
    expect(r.body.restaurados).toBe(6);
    expect((await get('/api/ops')).body).toHaveLength(1);
    expect((await get('/api/deudas')).body).toHaveLength(1);
    expect((await get('/api/pagos')).body).toHaveLength(1);
    expect((await get('/api/cotizaciones')).body).toHaveLength(1);
    expect((await get('/api/casos')).body).toHaveLength(1);
    expect((await get('/api/tickets')).body).toHaveLength(1);
    expect((await get('/api/archivo/lista')).body).toHaveLength(0);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ accion: 'registro_restaurado' }));
  });

  test('restaurar dos veces el mismo archivado → 404', async () => {
    const { op } = await opConTodo();
    await archivar('op', op.id);
    const grupo = (await get('/api/archivo/lista')).body[0].grupo;
    await post(`/api/archivo/restaurar/${grupo}`);
    expect((await post(`/api/archivo/restaurar/${grupo}`)).status).toBe(404);
  });

  test('no restaura registros que ya estaban archivados ANTES (solo lo del mismo archivado)', async () => {
    const cli = await cliente(); const op = await opDe(cli); const prov = await proveedor();
    const dup = await deuda(op, prov, 'Duplicada', 11600);
    await deuda(op, prov, 'Buena', 5800);
    await archivar('deuda', dup.id, 'Pago duplicado'); // archivada aparte, antes
    await archivar('op', op.id);
    const lista = (await get('/api/archivo/lista')).body;
    const grupoOp = lista.find(a => a.tipo === 'OP').grupo;
    await post(`/api/archivo/restaurar/${grupoOp}`);
    const deudas = (await get('/api/deudas')).body;
    expect(deudas.map(d => d.concepto)).toEqual(['Buena']); // la duplicada sigue archivada
  });

  test('no se puede restaurar una OP si ya existe otra activa con el mismo número', async () => {
    const cli = await cliente(); const op = await opDe(cli);
    await archivar('op', op.id);
    const grupo = (await get('/api/archivo/lista')).body[0].grupo;
    const fila = mockDb.getStore().ops.find(o => o.id === op.id);
    mockDb.getStore().ops.push({ ...fila, id: 'otra-op', deletedAt: null }); // otra OP activa con el mismo número
    const r = await post(`/api/archivo/restaurar/${grupo}`);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/mismo número/);
  });
});

describe('Cotización, cobro, pago a proveedor y caso', () => {
  test('cotización arrastra sus tickets; cobro y deuda se archivan solos', async () => {
    const cli = await cliente(); const op = await opDe(cli); const prov = await proveedor();
    const cot = (await request(app).post('/api/cotizaciones').set(A(natalia())).field('cotId', 'C9').field('opId', op.id).field('clienteId', cli.id)
      .attach('pdf', Buffer.from('%PDF-1.4'), { filename: 'c.pdf', contentType: 'application/pdf' })).body;
    await post('/api/tickets', { tipo: 'T', cotId: cot.id });
    const rc = await archivar('cotizacion', cot.id);
    expect(rc.body.arrastrados).toBe(1);
    const pago = (await post('/api/pagos', { tipo: 'Cobro a cliente', concepto: 'Cobro dup', opId: op.id, monto: 10, status: 'Pagado' })).body;
    expect((await archivar('pago', pago.id)).status).toBe(200);
    const d = await deuda(op, prov, 'Dup', 1160);
    expect((await archivar('deuda', d.id)).status).toBe(200);
    expect(((await get(`/api/ops/${op.id}`)).body).costosReales).toBe(0);
  });
});

describe('Atomicidad y errores', () => {
  test('si la base falla a medio camino, no se archiva nada y responde 500', async () => {
    const p = (await post('/api/prospectos', { empresa: 'P', propietario: 'Alexia' })).body;
    // 'plan' consulta primero (1 llamada); la falla se simula en el archivado
    mockDb.setFailNext('Postgres caído (simulado)', 1);
    const r = await post(`/api/archivo/archivar/prospecto/${p.id}`, { motivo: 'Motivo válido' });
    expect(r.status).toBe(500);
    expect((await get(`/api/prospectos/${p.id}`)).status).toBe(200);
  });
  test('la lista responde 500 si la base falla', async () => {
    mockDb.setFailNext('Postgres caído (simulado)', 1);
    expect((await get('/api/archivo/lista')).status).toBe(500);
  });
});
