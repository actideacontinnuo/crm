// Interruptor de emergencia — controlado desde la tabla 'seguridad' (columna bloquear_todo_el_acceso).
// Si la casilla BloquearTodoElAcceso está marcada, TODA la API queda bloqueada
// (incluido el login), sin importar que existan sesiones JWT válidas.
// El estado se cachea 30 segundos para no consultar la base en cada petición.
const { queryDB } = require('../api/db');
const { logAudit } = require('../api/_audit');

const CACHE_MS = 30 * 1000;
let _cache = { blocked: false, ts: 0 };
let _yaAuditado = false;

async function isAccessBlocked() {
  if (!process.env.DATABASE_URL) return false; // sin base configurada → no bloquear
  if (Date.now() - _cache.ts < CACHE_MS) return _cache.blocked;
  try {
    const rows = await queryDB('seguridad');
    const blocked = rows.some(r => r.bloquearTodoElAcceso === true);
    _cache = { blocked, ts: Date.now() };
    if (blocked && !_yaAuditado) {
      _yaAuditado = true;
      logAudit({ usuario: 'sistema', accion: 'acceso_revocado_global', detalle: 'Interruptor de emergencia activado desde la base de datos', exito: true });
    }
    if (!blocked) _yaAuditado = false;
    return blocked;
  } catch (err) {
    // Si la base no responde, se mantiene el último estado conocido
    console.error('⚠️  No se pudo leer el Panel de Seguridad:', err.message);
    return _cache.blocked;
  }
}

async function killSwitchMiddleware(req, res, next) {
  if (req.path === '/health') return next(); // health check siempre disponible
  if (await isAccessBlocked()) {
    return res.status(503).json({
      error: 'ACCESO_REVOCADO',
      message: 'El acceso al sistema fue revocado por el administrador. Contacta a Dirección.',
    });
  }
  next();
}

// Para tests: resetear el caché
function _resetCache() { _cache = { blocked: false, ts: 0 }; _yaAuditado = false; }

module.exports = { killSwitchMiddleware, isAccessBlocked, _resetCache };
