const { createPage, prop_title, prop_text, prop_select, prop_checkbox, prop_date } = require('./notion');

// Horario laboral considerado normal: Lunes-Sábado 7:00–22:00 (hora del servidor)
function esFueraDeHorario(date = new Date()) {
  const day  = date.getDay();   // 0 = domingo
  const hour = date.getHours();
  if (day === 0) return true;           // domingo completo
  if (hour < 7 || hour >= 22) return true;
  return false;
}

// Registra un evento de auditoría. Nunca lanza error — un fallo de log no debe tumbar la petición real.
async function logAudit({ usuario, accion, entidad = '', detalle = '', ip = '', exito = true }) {
  try {
    const now = new Date();
    await createPage('auditoria', {
      'Evento':          prop_title(`${accion} · ${usuario || 'anónimo'} · ${now.toISOString()}`),
      'Usuario':         prop_text(usuario || ''),
      'Accion':          prop_select(accion),
      'Entidad':         prop_text(entidad),
      'Detalle':         prop_text(detalle),
      'IP':              prop_text(ip),
      'Exito':           prop_checkbox(exito),
      'FueraDeHorario':  prop_checkbox(esFueraDeHorario(now)),
      'Fecha':           prop_date(now.toISOString()),
    });
  } catch (err) {
    console.error('⚠️  No se pudo escribir en el log de auditoría:', err.message);
  }
}

function clientIp(req) {
  // req.ip ya resuelve la IP real del último salto con 'trust proxy' configurado;
  // no confiar en X-Forwarded-For crudo (el cliente puede falsificarlo).
  return (req.ip || '').trim() || 'desconocida';
}

module.exports = { logAudit, clientIp, esFueraDeHorario };
