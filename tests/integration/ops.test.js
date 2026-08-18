/**
 * Integration tests — OPs (Órdenes de Producción)
 * Cubre: CRUD, campos correctos, OP interna, desajustes frontend↔backend
 */
const request    = require('supertest');
const mockNotion = require('../helpers/mock-notion');

jest.mock('../../api/notion', () => require('../helpers/mock-notion'));
jest.mock('../../api/_audit', () => ({ logAudit: jest.fn(), clientIp: () => '127.0.0.1' }));

const { buildApp } = require('../helpers/test-app');
const jwt = require('jsonwebtoken');
const { SECRET } = require('../../middleware/auth');

function adminToken() {
  return jwt.sign({ id: 'natalia', nombre: 'Natalia', role: 'admin', ejec: 'Natalia Gama' }, SECRET, { expiresIn: '1h' });
}

let app;
beforeEach(() => {
  mockNotion.resetStore();
  app = buildApp();
});

const OP_VALIDA = {
  numero:      'OP-2026-001',
  desc:        'Congreso Nacional Tech 2026',
  clienteId:   'cliente-test-id',
  ejec:        'Natalia Gama',
  fechaEvento: '2026-08-15',
  cotizado:    150000,
  cobrado:     0,
  utilidad:    0,
  status:      'Cotización',
};

describe('POST /api/ops', () => {
  test('crea OP con campos correctos', async () => {
    const res = await request(app).post('/api/ops')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(OP_VALIDA);
    expect([200, 201]).toContain(res.status);
    expect(res.body.id).toBeDefined();
  });

  test('el objeto devuelto tiene id definido y status correcto', async () => {
    const res = await request(app).post('/api/ops')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(OP_VALIDA);
    expect(res.body.id).toBeDefined();
    expect(res.body.status).toBe('Cotización');
  });

  test('el objeto devuelto tiene clienteId mapeado desde el backend', async () => {
    const res = await request(app).post('/api/ops')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(OP_VALIDA);
    // clienteId se guarda en Notion como 'Cliente ID' y se lee como clienteId
    expect(res.body.clienteId).toBe('cliente-test-id');
  });

  test('el objeto devuelto tiene fechaEvento', async () => {
    const res = await request(app).post('/api/ops')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(OP_VALIDA);
    expect(res.body.fechaEvento).toBe('2026-08-15');
  });
});

describe('GET /api/ops', () => {
  test('devuelve array', async () => {
    const res = await request(app).get('/api/ops')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('OP creada aparece en la lista', async () => {
    await request(app).post('/api/ops')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(OP_VALIDA);
    const res = await request(app).get('/api/ops')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.body.length).toBe(1);
    expect(res.body[0].clienteId).toBe('cliente-test-id');
  });
});

describe('PATCH /api/ops/:id', () => {
  test('actualiza cotizado', async () => {
    const create = await request(app).post('/api/ops')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(OP_VALIDA);
    const id = create.body.id;

    const res = await request(app).patch(`/api/ops/${id}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ cotizado: 200000, status: 'En Producción' });
    expect(res.status).toBe(200);
  });
});

describe('Utilidad — ÚNICA fuente de verdad: cotizado − costos reales de proveedores', () => {
  test('sin costos registrados → utilidad = cotizado completo', async () => {
    const create = await request(app).post('/api/ops')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ ...OP_VALIDA, cotizado: 100000 });
    expect(create.body.utilidad).toBe(100000);
  });

  test('con costos de proveedores (deudas) registrados → utilidad = cotizado − costos', async () => {
    const create = await request(app).post('/api/ops')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ ...OP_VALIDA, cotizado: 100000 });
    const opId = create.body.id;

    await request(app).post('/api/deudas').set('Authorization', `Bearer ${adminToken()}`)
      .send({ concepto: 'Audio', provId: 'p1', opId, monto: 20000, status: 'pendiente' });
    await request(app).post('/api/deudas').set('Authorization', `Bearer ${adminToken()}`)
      .send({ concepto: 'Catering', provId: 'p2', opId, monto: 15000, status: 'pagado' });

    const get = await request(app).get(`/api/ops/${opId}`).set('Authorization', `Bearer ${adminToken()}`);
    expect(get.body.utilidad).toBe(100000 - 20000 - 15000); // 65000 — cuenta TODOS los costos, pagados o no

    const lista = await request(app).get('/api/ops').set('Authorization', `Bearer ${adminToken()}`);
    expect(lista.body.find(o => o.id === opId).utilidad).toBe(65000);
  });

  test('PATCH ignora cualquier utilidad enviada manualmente — nunca se captura directo', async () => {
    const create = await request(app).post('/api/ops')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ ...OP_VALIDA, cotizado: 100000 });
    const opId = create.body.id;

    const patch = await request(app).patch(`/api/ops/${opId}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ status: 'Ejecutado', utilidad: 999999 }); // intento de inventar un número
    expect(patch.body.utilidad).toBe(100000); // se ignora el 999999 — se recalcula real (sin costos = cotizado)
  });
});

describe('Propietario = Ejecutivo de cuenta SIEMPRE — se re-deriva también al editar la OP', () => {
  test('oficina total cambia el Propietario → el ejec. de cuenta se deriva, no el que se mande', async () => {
    const create = await request(app).post('/api/ops')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(OP_VALIDA);
    const opId = create.body.id;

    const patch = await request(app).patch(`/api/ops/${opId}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ propietario: 'Ximena', ejecCuenta: 'Alexia' }); // 'Alexia' se ignora
    expect(patch.status).toBe(200);
    expect(patch.body.propietario).toBe('Ximena');
    expect(patch.body.ejecCuenta).toBe('Ximena');
  });

  test('propietario especial (Eduardo) → ejec. de cuenta se fuerza a Natalia también al editar', async () => {
    const create = await request(app).post('/api/ops')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(OP_VALIDA);
    const opId = create.body.id;

    const patch = await request(app).patch(`/api/ops/${opId}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ propietario: 'Eduardo Gama' });
    expect(patch.body.propietario).toBe('Eduardo Gama');
    expect(patch.body.ejecCuenta).toBe('Natalia Gama');
  });
});

describe('Cobrado — ÚNICA fuente de verdad: suma de Pagos "Cobro a cliente" con status "Pagado"', () => {
  test('sin pagos registrados → cobrado = 0', async () => {
    const create = await request(app).post('/api/ops')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(OP_VALIDA);
    expect(create.body.cobrado).toBe(0);
  });

  test('cuenta solo los pagos tipo Cobro a cliente con status Pagado, ignora pendientes y pagos a proveedor', async () => {
    const create = await request(app).post('/api/ops')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(OP_VALIDA);
    const opId = create.body.id;

    await request(app).post('/api/pagos').set('Authorization', `Bearer ${adminToken()}`)
      .send({ concepto: 'Anticipo', tipo: 'Cobro a cliente', opId, monto: 50000, status: 'Pagado', fechaAcordada: '2026-01-01' });
    await request(app).post('/api/pagos').set('Authorization', `Bearer ${adminToken()}`)
      .send({ concepto: 'Finiquito', tipo: 'Cobro a cliente', opId, monto: 30000, status: 'Pendiente', fechaAcordada: '2026-01-01' });
    await request(app).post('/api/pagos').set('Authorization', `Bearer ${adminToken()}`)
      .send({ concepto: 'Pago a proveedor', tipo: 'Pago a proveedor', opId, monto: 99999, status: 'Pagado', fechaAcordada: '2026-01-01' });

    const get = await request(app).get(`/api/ops/${opId}`).set('Authorization', `Bearer ${adminToken()}`);
    expect(get.body.cobrado).toBe(50000); // solo el cobro pagado — no el pendiente ni el pago a proveedor
  });

  test('PATCH ignora cualquier cobrado enviado manualmente — nunca se captura directo', async () => {
    const create = await request(app).post('/api/ops')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(OP_VALIDA);
    const opId = create.body.id;

    const patch = await request(app).patch(`/api/ops/${opId}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ status: 'Ejecutado', cobrado: 999999 }); // intento de inventar un número
    expect(patch.body.cobrado).toBe(0); // se ignora — se recalcula real (sin pagos = 0)
  });
});

describe('Roles (Propietario/EjecCuenta/EjecAsignado) — SIEMPRE heredados del cliente al crear la OP', () => {
  async function crearCliente(rfc, propietario, ejecAsignado) {
    const res = await request(app).post('/api/clientes')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({
        nombre: 'Cliente Test', razon: 'Cliente Test SA', rfc,
        dir: 'CDMX', contacto: 'Juan', cargo: 'Gerente', tel: '5500000000',
        email: 'juan@test.com', propietario, ejecAsignado, pago: '30 días', status: 'Activo',
      });
    return res.body;
  }

  test('la OP hereda propietario/ejecCuenta/ejecAsignado del cliente — no de lo que mande el request', async () => {
    const cliente = await crearCliente('HER130814368', 'Ximena', 'Alexia');
    const res = await request(app).post('/api/ops')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ ...OP_VALIDA, clienteId: cliente.id, propietario: 'Inventado', ejecCuenta: 'Otro', ejecAsignado: 'Otro Más', ejec: 'Otro Más' });
    expect(res.status).toBe(200);
    expect(res.body.propietario).toBe('Ximena');
    expect(res.body.ejecCuenta).toBe('Ximena'); // propietario = ejec.cuenta siempre
    expect(res.body.ejecAsignado).toBe('Alexia');
    expect(res.body.ejec).toBe('Alexia'); // 'ejec' operativo = ejec. asignado heredado
  });

  test('OP interna (sin cliente) NO hereda nada — conserva el ejec enviado a mano', async () => {
    const res = await request(app).post('/api/ops')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ ...OP_VALIDA, clienteId: '__interno__', ejec: 'Natalia Gama' });
    expect(res.status).toBe(200);
    expect(res.body.ejec).toBe('Natalia Gama');
    expect(res.body.propietario).toBe('');
  });

  test('un ejecutivo con acceso a la OP (por asignación) la ve, aunque no la haya creado', async () => {
    const cliente = await crearCliente('HER230814368', 'Natalia Gama', 'Alexia');
    const creada = await request(app).post('/api/ops')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ ...OP_VALIDA, clienteId: cliente.id });
    const ejecToken = jwt.sign({ id: 'alexia', nombre: 'Alexia', role: 'ejecutivo', ejec: 'Alexia' }, SECRET, { expiresIn: '1h' });
    const res = await request(app).get(`/api/ops/${creada.body.id}`).set('Authorization', `Bearer ${ejecToken}`);
    expect(res.status).toBe(200); // participa como Ejecutivo asignado, aunque Natalia la haya creado
  });
});

describe('Comisión — heredada del cliente al crear la OP (Regla 2 = 15%, Regla 3 = 7.5%)', () => {
  async function crearCliente(rfc, propietario) {
    const res = await request(app).post('/api/clientes')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({
        nombre: 'Cliente Test', razon: 'Cliente Test SA', rfc,
        dir: 'CDMX', contacto: 'Juan', cargo: 'Gerente', tel: '5500000000',
        email: 'juan@test.com', propietario, pago: '30 días', status: 'Activo',
      });
    return res.body;
  }

  test('propietario = ejecutivo real (Regla 2) → la OP hereda 15%', async () => {
    const cliente = await crearCliente('COM130814368', 'Ximena');
    expect(cliente.comision).toBe(15); // confirma la premisa: el cliente ya trae 15
    const res = await request(app).post('/api/ops')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ ...OP_VALIDA, clienteId: cliente.id });
    expect(res.body.comision).toBe(15);
  });

  test('propietario especial Eduardo/Alfredo (Regla 3) → la OP hereda 7.5%', async () => {
    const cliente = await crearCliente('COM230814368', 'Eduardo Gama');
    expect(cliente.comision).toBe(7.5);
    const res = await request(app).post('/api/ops')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ ...OP_VALIDA, clienteId: cliente.id });
    expect(res.body.comision).toBe(7.5);
  });

  test('lo que mande el request en comision se IGNORA — siempre se hereda del cliente', async () => {
    const cliente = await crearCliente('COM330814368', 'Ximena');
    const res = await request(app).post('/api/ops')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ ...OP_VALIDA, clienteId: cliente.id, comision: 999 });
    expect(res.body.comision).toBe(15);
  });

  test('OP interna (sin cliente) no tiene comisión', async () => {
    const res = await request(app).post('/api/ops')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ ...OP_VALIDA, clienteId: '__interno__' });
    expect(res.body.comision).toBe(null);
  });

  test('PATCH no puede editar la comisión directamente, ni el admin', async () => {
    const cliente = await crearCliente('COM430814368', 'Ximena');
    const creada = await request(app).post('/api/ops')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ ...OP_VALIDA, clienteId: cliente.id });
    const res = await request(app).patch(`/api/ops/${creada.body.id}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ comision: 50 });
    expect(res.status).toBe(200);
    expect(res.body.comision).toBe(15); // se ignora el 50 — se conserva la heredada
  });

  test('PATCH SÍ re-deriva la comisión cuando oficina total reasigna el propietario', async () => {
    const clienteXimena = await crearCliente('COM530814368', 'Ximena');
    const creada = await request(app).post('/api/ops')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ ...OP_VALIDA, clienteId: clienteXimena.id });
    expect(creada.body.comision).toBe(15);

    const res = await request(app).patch(`/api/ops/${creada.body.id}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ propietario: 'Eduardo Gama' }); // reasignación → cuenta como nueva asignación
    expect(res.status).toBe(200);
    expect(res.body.comision).toBe(7.5);
    expect(res.body.ejecCuenta).toBe('Natalia Gama'); // Regla 3
  });
});

describe('Número de OP = código del cliente + consecutivo — generado por el servidor', () => {
  async function crearCliente(rfc) {
    const res = await request(app).post('/api/clientes')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({
        nombre: 'Cliente Test', razon: 'Cliente Test SA', rfc,
        dir: 'CDMX', contacto: 'Juan', cargo: 'Gerente', tel: '5500000000',
        email: 'juan@test.com', propietario: 'Natalia Gama', pago: '30 días', status: 'Activo',
      });
    return res.body; // { id, codigo, ... }
  }

  test('primera OP del cliente → {codigo}-01', async () => {
    const cliente = await crearCliente('KTE130814368');
    const res = await request(app).post('/api/ops')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ ...OP_VALIDA, clienteId: cliente.id, numero: 'LO-QUE-SEA' }); // se ignora
    expect(res.body.numero).toBe(`${cliente.codigo}-01`);
    expect(res.body.numero).not.toBe('LO-QUE-SEA');
  });

  test('segunda y tercera OP del mismo cliente → -02, -03 (consecutivo real)', async () => {
    const cliente = await crearCliente('KTE130814368');
    await request(app).post('/api/ops').set('Authorization', `Bearer ${adminToken()}`)
      .send({ ...OP_VALIDA, clienteId: cliente.id, desc: 'Casa del Terror' });
    await request(app).post('/api/ops').set('Authorization', `Bearer ${adminToken()}`)
      .send({ ...OP_VALIDA, clienteId: cliente.id, desc: 'Reinauguración' });
    const tercera = await request(app).post('/api/ops').set('Authorization', `Bearer ${adminToken()}`)
      .send({ ...OP_VALIDA, clienteId: cliente.id, desc: 'Netagg Fest' });
    expect(tercera.body.numero).toBe(`${cliente.codigo}-03`);
  });

  test('clientes distintos llevan su propio consecutivo independiente', async () => {
    const clienteA = await crearCliente('AAA100000000');
    const clienteB = await crearCliente('BBB200000000');
    await request(app).post('/api/ops').set('Authorization', `Bearer ${adminToken()}`)
      .send({ ...OP_VALIDA, clienteId: clienteA.id });
    const primeraB = await request(app).post('/api/ops').set('Authorization', `Bearer ${adminToken()}`)
      .send({ ...OP_VALIDA, clienteId: clienteB.id });
    expect(primeraB.body.numero).toBe(`${clienteB.codigo}-01`); // no arrastra el conteo de A
  });

  test('OP interna (sin cliente) no se ve afectada — conserva el número enviado', async () => {
    const res = await request(app).post('/api/ops')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ ...OP_VALIDA, clienteId: '__interno__', numero: 'OP-INTERNA-01' });
    expect(res.body.numero).toBe('OP-INTERNA-01');
  });

  test('PATCH sigue sin poder renumerar la OP salvo oficina total', async () => {
    const cliente = await crearCliente('KTE130814368');
    // OP_VALIDA.ejec = 'Natalia Gama' → un ejecutivo con esa misma identidad SÍ
    // participa en el registro (pasa assertRolAccess), pero no es oficina total.
    const creada = await request(app).post('/api/ops').set('Authorization', `Bearer ${adminToken()}`)
      .send({ ...OP_VALIDA, clienteId: cliente.id });
    const numeroOriginal = creada.body.numero;

    const ejecToken = jwt.sign({ id: 'natalia-ejec', nombre: 'Natalia Gama', role: 'ejecutivo', ejec: 'Natalia Gama' }, SECRET, { expiresIn: '1h' });
    const patch = await request(app).patch(`/api/ops/${creada.body.id}`)
      .set('Authorization', `Bearer ${ejecToken}`)
      .send({ numero: 'INTENTO-DE-CAMBIO', desc: 'Cambio permitido' });
    expect(patch.status).toBe(200); // el PATCH en sí se permite (participa en la OP)...
    expect(patch.body.numero).toBe(numeroOriginal); // ...pero el número no se toca

    const get = await request(app).get(`/api/ops/${creada.body.id}`).set('Authorization', `Bearer ${adminToken()}`);
    expect(get.body.numero).toBe(numeroOriginal);
  });
});
