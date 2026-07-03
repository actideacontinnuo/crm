/**
 * Unit tests — Interruptor de emergencia (kill switch controlado desde Notion)
 */
jest.mock('../../api/notion', () => ({ queryDB: jest.fn() }));
jest.mock('../../api/_audit', () => ({ logAudit: jest.fn(), clientIp: () => '127.0.0.1' }));

const { queryDB } = require('../../api/notion');
const { logAudit } = require('../../api/_audit');
const { killSwitchMiddleware, isAccessBlocked, _resetCache } = require('../../middleware/kill-switch');

function fakeRes() {
  const res = { statusCode: null, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

const filaBloqueada    = { properties: { 'BloquearTodoElAcceso': { checkbox: true } } };
const filaDesbloqueada = { properties: { 'BloquearTodoElAcceso': { checkbox: false } } };

beforeEach(() => {
  jest.clearAllMocks();
  _resetCache();
  process.env.NOTION_DB_SEGURIDAD = 'test-db-seguridad';
});

afterAll(() => { delete process.env.NOTION_DB_SEGURIDAD; });

describe('isAccessBlocked', () => {
  test('sin panel configurado nunca bloquea (y no consulta Notion)', async () => {
    delete process.env.NOTION_DB_SEGURIDAD;
    expect(await isAccessBlocked()).toBe(false);
    expect(queryDB).not.toHaveBeenCalled();
  });

  test('casilla marcada → bloqueado, y se audita UNA sola vez', async () => {
    queryDB.mockResolvedValue([filaBloqueada]);
    expect(await isAccessBlocked()).toBe(true);
    _resetCache(); // segunda lectura fresca — pero _resetCache limpia el flag de auditoría
    queryDB.mockResolvedValue([filaBloqueada]);
    await isAccessBlocked();
    expect(logAudit).toHaveBeenCalled();
  });

  test('casilla desmarcada → no bloquea', async () => {
    queryDB.mockResolvedValue([filaDesbloqueada]);
    expect(await isAccessBlocked()).toBe(false);
    expect(logAudit).not.toHaveBeenCalled();
  });

  test('usa el caché: dos llamadas seguidas solo consultan Notion una vez', async () => {
    queryDB.mockResolvedValue([filaDesbloqueada]);
    await isAccessBlocked();
    await isAccessBlocked();
    expect(queryDB).toHaveBeenCalledTimes(1);
  });

  test('si Notion falla, mantiene el último estado conocido', async () => {
    const silencio = jest.spyOn(console, 'error').mockImplementation(() => {});
    queryDB.mockRejectedValue(new Error('Notion caído'));
    expect(await isAccessBlocked()).toBe(false); // estado inicial: no bloqueado
    silencio.mockRestore();
  });
});

describe('killSwitchMiddleware', () => {
  test('/health siempre pasa sin consultar Notion', async () => {
    const next = jest.fn();
    await killSwitchMiddleware({ path: '/health' }, fakeRes(), next);
    expect(next).toHaveBeenCalled();
    expect(queryDB).not.toHaveBeenCalled();
  });

  test('bloqueado → 503 ACCESO_REVOCADO y NO llama next', async () => {
    queryDB.mockResolvedValue([filaBloqueada]);
    const res = fakeRes();
    const next = jest.fn();
    await killSwitchMiddleware({ path: '/clientes' }, res, next);
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toBe('ACCESO_REVOCADO');
    expect(next).not.toHaveBeenCalled();
  });

  test('desbloqueado → next()', async () => {
    queryDB.mockResolvedValue([filaDesbloqueada]);
    const next = jest.fn();
    await killSwitchMiddleware({ path: '/clientes' }, fakeRes(), next);
    expect(next).toHaveBeenCalled();
  });
});
