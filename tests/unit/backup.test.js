/**
 * Unit tests — Respaldo de Notion (jobs/backup.js)
 * Notion y fetch mockeados: no toca servicios reales.
 */
const mockNotion = require('../helpers/mock-notion');

jest.mock('../../api/notion', () => require('../helpers/mock-notion'));
jest.mock('../../api/_audit', () => ({ logAudit: jest.fn().mockResolvedValue(undefined), clientIp: () => '127.0.0.1' }));

const { runBackup, buildBackupJson, sendBackupEmail } = require('../../jobs/backup');
const { logAudit } = require('../../api/_audit');

const ENV_ORIGINAL = { ...process.env };

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ENV_ORIGINAL };
  mockNotion.resetStore({
    clientes: [{
      id: 'cli-1',
      created_time: '2026-01-01T00:00:00Z',
      last_edited_time: '2026-06-01T00:00:00Z',
      properties: {
        'Nombre': { type: 'title', title: [{ plain_text: 'Grupo Modelo' }] },
        'RFC':    { type: 'rich_text', rich_text: [{ plain_text: 'GMO123456AB1' }] },
        'Status': { type: 'select', select: { name: 'Activo' } },
        'Email':  { type: 'email', email: 'x@y.com' },
        'Tel':    { type: 'phone_number', phone_number: '555' },
        'Monto':  { type: 'number', number: 100 },
        'Activo': { type: 'checkbox', checkbox: true },
        'Fecha':  { type: 'date', date: { start: '2026-06-01' } },
      },
    }],
  });
});

afterAll(() => { process.env = ENV_ORIGINAL; });

describe('buildBackupJson', () => {
  test('incluye todas las entidades y simplifica propiedades', async () => {
    const data = await buildBackupJson();
    expect(data.generadoEn).toBeDefined();
    expect(data.entidades.clientes.length).toBe(1);
    const c = data.entidades.clientes[0];
    expect(c.properties['Nombre']).toBe('Grupo Modelo');
    expect(c.properties['RFC']).toBe('GMO123456AB1');
    expect(c.properties['Status']).toBe('Activo');
    expect(c.properties['Monto']).toBe(100);
    expect(c.properties['Activo']).toBe(true);
    expect(c.properties['Fecha']).toBe('2026-06-01');
  });

  test('NUNCA incluye PasswordHash ni TwoFASecret de usuarios', async () => {
    const data = await buildBackupJson();
    const usuarios = data.entidades.usuarios;
    expect(Array.isArray(usuarios)).toBe(true);
    for (const u of usuarios) {
      expect(u.properties.PasswordHash).toBeUndefined();
      expect(u.properties.TwoFASecret).toBeUndefined();
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
