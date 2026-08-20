/**
 * Integration tests — CRUD de Clientes
 * Cubre: creación, lectura, edición, docs JSON, ownership por ejecutivo, roles
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
function ejecToken(ejec = 'Alexia') {
  return jwt.sign({ id: 'alexia', nombre: 'Alexia', role: 'ejecutivo', ejec }, SECRET, { expiresIn: '1h' });
}

let app;
beforeEach(() => {
  mockNotion.resetStore();
  // Ximena y Alexia como ejecutivas reales del sistema (Rol=ejecutivo,
  // Activo=sí) — necesario para el roster dinámico de comisiones (Regla 2,
  // api/_roles.js obtenerRosterEjecutivos). Natalia ya viene por defecto (admin).
  mockNotion.addEjecutivo('Ximena', 'ximena');
  mockNotion.addEjecutivo('Alexia', 'alexia-roster');
  require('../../api/_roles')._resetRosterCacheForTests();
  app = buildApp();
});

const CLIENTE_VALIDO = {
  nombre:   'Grupo Modelo',
  codigo:   'GM-001',
  razon:    'Grupo Modelo SA de CV',
  rfc:      'GMO123456AB1',
  dir:      'Av. Reforma 100, CDMX',
  contacto: 'Laura Silva',
  cargo:    'Gerente de Eventos',
  tel:      '5511122233',
  email:    'laura@grupomodelo.com',
  ejec:     'Natalia Gama',
  pago:     '30 días',
  status:   'Activo',
};

describe('POST /api/clientes', () => {
  test('admin puede crear cliente con todos los campos', async () => {
    const res = await request(app).post('/api/clientes')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(CLIENTE_VALIDO);
    expect([200, 201]).toContain(res.status);
    expect(res.body.id).toBeDefined();
    expect(res.body.nombre).toBe('Grupo Modelo');
    expect(res.body.rfc).toBe('GMO123456AB1');
  });

  test('docs como objeto se serializa a JSON y se conserva', async () => {
    const docs = { csf: true, oc: { sentido: 'POSITIVO' }, ec: { banco: 'BBVA', clabe: '012180001234567895' } };
    const res = await request(app).post('/api/clientes')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ ...CLIENTE_VALIDO, docs });
    expect([200, 201]).toContain(res.status);
    expect(JSON.parse(res.body.docs)).toEqual(docs);
  });

  test('ejecutivo que crea un cliente queda como dueño aunque mande otro ejec', async () => {
    const res = await request(app).post('/api/clientes')
      .set('Authorization', `Bearer ${ejecToken('Alexia')}`)
      .send({ ...CLIENTE_VALIDO });
    expect([200, 201]).toContain(res.status);
    expect(res.body.propietario).toBe('Alexia'); // el creador queda como Propietario
  });
});

describe('Código de cliente — SIEMPRE RFC(3)-EJEC.CUENTA(3)-DDMMAA, generado por el servidor', () => {
  function hoyDDMMAA() {
    const d = new Date();
    return String(d.getDate()).padStart(2, '0') + String(d.getMonth() + 1).padStart(2, '0') + String(d.getFullYear()).slice(2);
  }

  test('se genera con el formato exacto RFC(3)-EJEC(3)-DDMMAA, con guiones', async () => {
    const res = await request(app).post('/api/clientes')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ ...CLIENTE_VALIDO, rfc: 'KTE130814368', propietario: 'Natalia Gama' });
    expect(res.body.codigo).toBe(`KTE-NAT-${hoyDDMMAA()}`);
  });

  test('el código que mande el cliente en el POST se IGNORA por completo (no se puede falsificar)', async () => {
    const res = await request(app).post('/api/clientes')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ ...CLIENTE_VALIDO, rfc: 'KTE130814368', propietario: 'Ximena', codigo: 'LO-QUE-SEA-YO-QUIERO' });
    expect(res.body.codigo).toBe(`KTE-XIM-${hoyDDMMAA()}`);
    expect(res.body.codigo).not.toBe('LO-QUE-SEA-YO-QUIERO');
  });

  test('usa el Ejecutivo de cuenta YA DERIVADO del propietario, no uno independiente', async () => {
    // 'Alexia' como ejecCuenta se ignora — el propietario es Ximena, así que
    // el ejec. de cuenta real (y las iniciales del código) son de Ximena.
    const res = await request(app).post('/api/clientes')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ ...CLIENTE_VALIDO, rfc: 'KTE130814368', propietario: 'Ximena', ejecCuenta: 'Alexia' });
    expect(res.body.codigo).toBe(`KTE-XIM-${hoyDDMMAA()}`);
  });

  test('propietario especial (Eduardo) → código usa NAT (Natalia), no ALF/EDU', async () => {
    const res = await request(app).post('/api/clientes')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ ...CLIENTE_VALIDO, rfc: 'KTE130814368', propietario: 'Eduardo Gama' });
    expect(res.body.codigo).toBe(`KTE-NAT-${hoyDDMMAA()}`);
  });

  test('RFC con guiones/espacios se limpia antes de tomar las 3 letras', async () => {
    const res = await request(app).post('/api/clientes')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ ...CLIENTE_VALIDO, rfc: ' kte-130814-368 ', propietario: 'Natalia Gama' });
    expect(res.body.codigo).toBe(`KTE-NAT-${hoyDDMMAA()}`);
  });

  test('PATCH JAMÁS puede cambiar el código, ni siquiera el admin', async () => {
    const creado = await request(app).post('/api/clientes')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ ...CLIENTE_VALIDO, rfc: 'KTE130814368', propietario: 'Natalia Gama' });
    const codigoOriginal = creado.body.codigo;

    const patch = await request(app).patch(`/api/clientes/${creado.body.id}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ codigo: 'INTENTO-DE-CAMBIO' });
    expect(patch.body.codigo).toBe(codigoOriginal);

    const get = await request(app).get(`/api/clientes/${creado.body.id}`)
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(get.body.codigo).toBe(codigoOriginal);
  });
});

describe('GET /api/clientes — filtro por ejecutivo', () => {
  test('ejecutivo solo ve sus propios clientes', async () => {
    await request(app).post('/api/clientes')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ ...CLIENTE_VALIDO, ejec: 'Natalia Gama' });
    await request(app).post('/api/clientes')
      .set('Authorization', `Bearer ${ejecToken('Alexia')}`)
      .send({ ...CLIENTE_VALIDO, nombre: 'Cliente de Alexia' });

    const res = await request(app).get('/api/clientes')
      .set('Authorization', `Bearer ${ejecToken('Alexia')}`);
    expect(res.status).toBe(200);
    expect(res.body.every(c => [c.propietario, c.ejecCuenta, c.ejecAsignado, c.ejec].includes('Alexia'))).toBe(true);
  });

  test('admin ve todos los clientes', async () => {
    await request(app).post('/api/clientes')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(CLIENTE_VALIDO);
    await request(app).post('/api/clientes')
      .set('Authorization', `Bearer ${ejecToken('Alexia')}`)
      .send({ ...CLIENTE_VALIDO, nombre: 'Otro' });

    const res = await request(app).get('/api/clientes')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.body.length).toBe(2);
  });
});

describe('PATCH /api/clientes/:id — ownership', () => {
  test('ejecutivo NO puede editar cliente de otro ejecutivo (403)', async () => {
    const creado = await request(app).post('/api/clientes')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ ...CLIENTE_VALIDO, ejec: 'Natalia Gama' });

    const res = await request(app).patch(`/api/clientes/${creado.body.id}`)
      .set('Authorization', `Bearer ${ejecToken('Alexia')}`)
      .send({ status: 'Inactivo' });
    expect(res.status).toBe(403);
  });

  test('ejecutivo NO puede reasignar el dueño de su propio cliente', async () => {
    const creado = await request(app).post('/api/clientes')
      .set('Authorization', `Bearer ${ejecToken('Alexia')}`)
      .send(CLIENTE_VALIDO);

    await request(app).patch(`/api/clientes/${creado.body.id}`)
      .set('Authorization', `Bearer ${ejecToken('Alexia')}`)
      .send({ status: 'Inactivo' });

    const res = await request(app).get(`/api/clientes/${creado.body.id}`)
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.body.propietario).toBe('Alexia'); // el propietario sigue siendo Alexia
    expect(res.body.status).toBe('Inactivo'); // el campo mutable sí cambió
  });
});

describe('PATCH /api/clientes/:id — el Propietario NUNCA cambia ni se reasigna', () => {
  test('intentar cambiar el propietario por PATCH no tiene efecto (se ignora)', async () => {
    const creado = await request(app).post('/api/clientes')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ ...CLIENTE_VALIDO, propietario: 'Natalia Gama', ejecCuenta: 'Natalia Gama' });

    const res = await request(app).patch(`/api/clientes/${creado.body.id}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ propietario: 'Ximena', ejecCuenta: 'Alexia' });
    expect(res.status).toBe(200);
    expect(res.body.propietario).toBe('Natalia Gama'); // no cambió
    expect(res.body.ejecCuenta).toBe('Natalia Gama');  // tampoco
  });

  test('propietario especial (Alfredo) también queda fijo — no se puede reasignar por edición', async () => {
    const creado = await request(app).post('/api/clientes')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ ...CLIENTE_VALIDO, propietario: 'Alfredo' });
    expect(creado.body.ejecCuenta).toBe('Natalia Gama');

    const res = await request(app).patch(`/api/clientes/${creado.body.id}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ propietario: 'Natalia Gama' }); // intento de reasignar
    expect(res.body.propietario).toBe('Alfredo'); // sigue igual
    expect(res.body.ejecCuenta).toBe('Natalia Gama');
  });

  test('editar el ejec. de cuenta directamente tampoco tiene efecto', async () => {
    const creado = await request(app).post('/api/clientes')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ ...CLIENTE_VALIDO, propietario: 'Ximena', ejecCuenta: 'Ximena' });

    const res = await request(app).patch(`/api/clientes/${creado.body.id}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ ejecCuenta: 'Alexia' }); // intento de romper la regla
    expect(res.body.propietario).toBe('Ximena'); // no cambió
    expect(res.body.ejecCuenta).toBe('Ximena');  // tampoco
  });
});

describe('Propietario "Externo" — comisión manual', () => {
  test('Externo con % capturado a mano se respeta tal cual', async () => {
    const res = await request(app).post('/api/clientes')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ ...CLIENTE_VALIDO, propietario: 'Externo', comision: 10 });
    expect(res.body.propietario).toBe('Externo');
    expect(res.body.ejecCuenta).toBe('Natalia Gama'); // default
    expect(res.body.comision).toBe(10);
  });

  test('Externo con ejec. de cuenta elegido a mano — SÍ se respeta (a diferencia de Regla 2/3)', async () => {
    const res = await request(app).post('/api/clientes')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ ...CLIENTE_VALIDO, propietario: 'Externo', ejecCuenta: 'Ximena', comision: 8 });
    expect(res.body.ejecCuenta).toBe('Ximena');
    expect(res.body.comision).toBe(8);
  });
});

describe('DELETE /api/clientes/:id — roles', () => {
  test('ejecutivo NO puede eliminar (403)', async () => {
    const creado = await request(app).post('/api/clientes')
      .set('Authorization', `Bearer ${ejecToken('Alexia')}`)
      .send(CLIENTE_VALIDO);
    const res = await request(app).delete(`/api/clientes/${creado.body.id}`)
      .set('Authorization', `Bearer ${ejecToken('Alexia')}`);
    expect(res.status).toBe(403);
  });

  test('admin SÍ puede eliminar', async () => {
    const creado = await request(app).post('/api/clientes')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(CLIENTE_VALIDO);
    const res = await request(app).delete(`/api/clientes/${creado.body.id}`)
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe('Autenticación', () => {
  test('sin token → 401', async () => {
    const res = await request(app).get('/api/clientes');
    expect(res.status).toBe(401);
  });

  test('token inválido → 401', async () => {
    const res = await request(app).get('/api/clientes')
      .set('Authorization', 'Bearer token-falso');
    expect(res.status).toBe(401);
  });
});

describe('Roster dinámico de ejecutivos — un usuario nuevo se habilita solo (Entrega 2)', () => {
  test('un propietario que NO es ejecutivo ni socio → sin comisión (Regla 4), aunque exista como texto', async () => {
    // "Nueva Ejecutiva" todavía no existe como usuario del sistema — no debe
    // ganar 15% solo por escribirse en el campo Propietario.
    const res = await request(app).post('/api/clientes')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ ...CLIENTE_VALIDO, propietario: 'Nueva Ejecutiva' });
    expect(res.body.propietario).toBe('Nueva Ejecutiva');
    expect(res.body.ejecCuenta).toBe(''); // no se deriva nada — no es un ejecutivo real
    expect(res.body.comision).toBeNull();
  });

  test('dar de alta a "Nueva Ejecutiva" como usuario Rol=ejecutivo la habilita SOLA, sin tocar código', async () => {
    mockNotion.addEjecutivo('Nueva Ejecutiva', 'nueva');
    require('../../api/_roles')._resetRosterCacheForTests(); // el roster real tarda ≤60s, aquí se fuerza al instante
    const res = await request(app).post('/api/clientes')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ ...CLIENTE_VALIDO, rfc: 'NEV130814368', propietario: 'Nueva Ejecutiva' });
    expect(res.body.propietario).toBe('Nueva Ejecutiva');
    expect(res.body.ejecCuenta).toBe('Nueva Ejecutiva'); // Regla 2 — ahora SÍ se deriva
    expect(res.body.comision).toBe(15);
  });

  test('desactivar a un ejecutivo (Activo=no) lo saca del roster — ya no gana 15%', async () => {
    mockNotion.addEjecutivo('Ex Ejecutiva', 'exejec');
    const store = mockNotion.getStore();
    const pagina = store.usuarios.find(u => u.properties['Nombre']?.rich_text?.[0]?.plain_text === 'Ex Ejecutiva');
    pagina.properties['Activo'] = { checkbox: false };
    require('../../api/_roles')._resetRosterCacheForTests();
    const res = await request(app).post('/api/clientes')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ ...CLIENTE_VALIDO, rfc: 'EXJ130814368', propietario: 'Ex Ejecutiva' });
    expect(res.body.ejecCuenta).toBe(''); // ya no cuenta como ejecutivo real
    expect(res.body.comision).toBeNull();
  });

  test('Natalia (Rol=admin) sigue contando como ejecutiva comercial — Regla 2 con 15%', async () => {
    const res = await request(app).post('/api/clientes')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ ...CLIENTE_VALIDO, rfc: 'NAT130814368', propietario: 'Natalia Gama' });
    expect(res.body.ejecCuenta).toBe('Natalia Gama');
    expect(res.body.comision).toBe(15);
  });
});
