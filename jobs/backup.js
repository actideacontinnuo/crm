const { queryDB } = require('../api/db');
const { logAudit } = require('../api/_audit');

// Entidades de negocio a respaldar. Usuarios se excluye su PasswordHash por seguridad.
const ENTIDADES = ['prospectos', 'clientes', 'ops', 'cotizaciones', 'pagos', 'proveedores', 'deudas', 'casos', 'tickets', 'objetivos'];

async function buildBackupJson() {
  const data = { generadoEn: new Date().toISOString(), entidades: {} };
  for (const ent of ENTIDADES) {
    try {
      data.entidades[ent] = await queryDB(ent, null);
    } catch (err) {
      data.entidades[ent] = { error: err.message };
    }
  }

  // Usuarios: se incluye sin el hash de contraseña, el secreto 2FA ni el token de reseteo
  try {
    const usuarios = await queryDB('usuarios', null);
    data.entidades['usuarios'] = usuarios.map(({ passwordHash, twoFaSecret, resetToken, ...seguro }) => seguro);
  } catch (err) {
    data.entidades['usuarios'] = { error: err.message };
  }

  return data;
}

async function sendBackupEmail(jsonData) {
  const apiKey = process.env.RESEND_API_KEY;
  const to     = process.env.BACKUP_EMAIL_TO;
  if (!apiKey || !to) {
    return { sent: false, reason: 'RESEND_API_KEY o BACKUP_EMAIL_TO no configurados' };
  }

  const filename = `actidea-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const content  = Buffer.from(JSON.stringify(jsonData, null, 2)).toString('base64');

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || 'Actidea CRM <onboarding@resend.dev>',
      to: [to],
      subject: `Respaldo mensual Actidea CRM — ${new Date().toLocaleDateString('es-MX')}`,
      html: `<p>Respaldo automático de la base de datos del CRM Actidea.</p><p>Generado: ${jsonData.generadoEn}</p>`,
      attachments: [{ filename, content }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    return { sent: false, reason: `Resend respondió ${res.status}: ${text}` };
  }
  return { sent: true };
}

async function runBackup({ trigger = 'manual', usuario = 'sistema' } = {}) {
  const data = await buildBackupJson();
  const emailResult = await sendBackupEmail(data);

  await logAudit({
    usuario,
    accion: 'backup_generado',
    detalle: `trigger=${trigger} · email_enviado=${emailResult.sent} ${emailResult.reason || ''}`.trim(),
    exito: true,
  });

  return { data, emailResult };
}

module.exports = { runBackup, buildBackupJson, sendBackupEmail };
