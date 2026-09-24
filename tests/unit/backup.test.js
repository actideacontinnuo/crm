/**
 * Unit tests — Respaldo de la base (jobs/backup.js)
 * La base y fetch mockeados: no toca servicios reales.
 */
const mockDb = require('../helpers/mock-db');

jest.mock('../../api/db', () => require('../helpers/mock-db'));
jest.mock('../../api/_audit', () => ({ logAudit: jest.fn().mockResolvedValue(undefined), clientIp: () => '127.0.0.1' }));

const { runBackup, buildBackupJson, sendBackupEmail } = require('../../jobs/backup');
const { logAudit } = require('../../api/_audit');

const ENV_ORIGINAL = { ...process.env };

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ENV_ORIGINAL };
  mockDb.resetStore({
    clientes: [{ id: 'cli-1', nombre: 'Grupo Modelo', rfc: 'GMO123456AB1', status: 'Activo', deletedAt: null }],
  });
});

afterAll(() => { process.env = ENV_ORIGINAL; });

describe('buildBackupJson', () => {
  test('incluye todas las entidades y simplifica propiedades', async () => {
    const data = await buildBackupJson();
    expect(data.generadoEn).toBeDefined();
    expect(data.entidades.clientes.length).toBe(1);
    const c = data.entidades.clientes[0];
    expect(c.nombre).toBe('Grupo Modelo');
    expect(c.rfc).toBe('GMO123456AB1');
    expect(c.status).toBe('Activo');
  });

  test('NUNCA incluye passwordHash, twoFaSecret ni resetToken de usuarios', async () => {
    const data = await buildBackupJson();
    const usuarios = data.entidades.usuarios;
    expect(Array.isArray(usuarios)).toBe(true);
    for (const u of usuarios) {
      expect(u.passwordHash).toBeUndefined();
      expect(u.twoFaSecret).toBeUndefined();
      expect(u.resetToken).toBeUndefined();
    }
  });
});

describe('sendBackupEmail', () => {
  test('sin RESEND_API_KEY → no envía y explica por qué', async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.BACKUP_EMAIL_TO;
    const result = await sendBackupEmail({ generadoEn: 'x', entidades: {} });
    expect(result.sent).toBe(false);
    expect(result.reason).toMatch(/no configurados/);
  });

  test('con key válida → envía el adjunto a BACKUP_EMAIL_TO', async () => {
    process.env.RESEND_API_KEY = 're_test_falso';
    process.env.BACKUP_EMAIL_TO = 'ngama@actideacontinnuo.com';
    global.fetch = jest.fn().mockResolvedValue({ ok: true });

    const result = await sendBackupEmail({ generadoEn: '2026-07-02', entidades: {} });
    expect(result.sent).toBe(true);

    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    const body = JSON.parse(opts.body);
    expect(body.to).toEqual(['ngama@actideacontinnuo.com']);
    expect(body.attachments[0].filename).toMatch(/actidea-backup-.*\.json/);
  });

  test('Resend responde error → sent:false con detalle', async () => {
    process.env.RESEND_API_KEY = 're_test_falso';
    process.env.BACKUP_EMAIL_TO = 'ngama@actideacontinnuo.com';
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 422, text: async () => 'domain not verified' });

    const result = await sendBackupEmail({ generadoEn: 'x', entidades: {} });
    expect(result.sent).toBe(false);
    expect(result.reason).toMatch(/422/);
  });
});

describe('runBackup', () => {
  test('genera datos, intenta email y registra en auditoría', async () => {
    delete process.env.RESEND_API_KEY;
    const { data, emailResult } = await runBackup({ trigger: 'test', usuario: 'natalia' });
    expect(data.entidades).toBeDefined();
    expect(emailResult.sent).toBe(false);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ accion: 'backup_generado', usuario: 'natalia' }));
  });
});
