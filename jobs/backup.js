const { queryDB } = require('../api/notion');
const { logAudit } = require('../api/_audit');

// Entidades de negocio a respaldar. Usuarios se excluye su PasswordHash por seguridad.
const ENTIDADES = ['prospectos', 'clientes', 'ops', 'cotizaciones', 'pagos', 'proveedores', 'deudas', 'casos', 'tickets', 'objetivos'];

function simplifyPage(page) {
  const out = { id: page.id, created: page.created_time, lastEdited: page.last_edited_time, properties: {} };
  for (const [key, prop] of Object.entries(page.properties)) {
    switch (prop.type) {
      case 'title':      out.properties[key] = prop.title.map(t => t.plain_text).join(''); break;
      case 'rich_text':  out.properties[key] = prop.rich_text.map(t => t.plain_text).join(''); break;
      case 'number':     out.properties[key] = prop.number; break;
      case 'select':     out.properties[key] = prop.select?.name ?? null; break;
      case 'date':       out.properties[key] = prop.date?.start ?? null; break;
      case 'checkbox':   out.properties[key] = prop.checkbox; break;
      case 'email':      out.properties[key] = prop.email; break;
      case 'phone_number': out.properties[key] = prop.phone_number; break;
      default: break;
    }
  }
  return out;
}

async function buildBackupJson() {
  const data = { generadoEn: new Date().toISOString(), entidades: {} };
  for (const ent of ENTIDADES) {
    try {
      const pages = await queryDB(ent);
      data.entidades[ent] = pages.map(simplifyPage);
    } catch (err) {
      data.entidades[ent] = { error: err.message };
    }
  }

  // Usuarios: se incluye sin el hash de contraseña ni el secreto 2FA
  try {
    const userPages = await queryDB('usuarios');
    data.entidades['usuarios'] = userPages.map(p => {
      const s = simplifyPage(p);
      delete s.properties.PasswordHash;
      delete s.properties.TwoFASecret;
      return s;
    });
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
      html: `<p>Respaldo automático de las bases de datos de Notion del CRM Actidea.</p><p>Generado: ${jsonData.generadoEn}</p>`,
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
