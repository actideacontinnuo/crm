require('dotenv').config();
// Forzar resolución IPv4 primero: Railway sale por IPv6 y las conexiones salientes
// (Notion, Resend, Anthropic) por IPv6 se caen con "Premature close".
require('dns').setDefaultResultOrder('ipv4first');
const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const path      = require('path');
const rateLimit = require('express-rate-limit');
const { authMiddleware } = require('./middleware/auth');
const { logAudit, clientIp } = require('./api/_audit');
const { esOficinaTotal, identidadRol, soloNatalia } = require('./api/_guard');

if (!process.env.JWT_SECRET) {
  console.warn('\n⚠️  ADVERTENCIA: JWT_SECRET no está configurada. Configúrala en .env / Railway antes de producción.\n');
}

const app = express();

// ── Confiar en el proxy de Railway — necesario para que el rate limit
//    identifique la IP real del visitante y no la del proxy interno.
//    "1" confía solo en el último salto (el edge de Railway) — un cliente
//    no puede falsificar su IP inyectando X-Forwarded-For adicionales. ──
app.set('trust proxy', 1);

// ── Cabeceras de seguridad estándar (Helmet) ──
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com'],
      scriptSrcAttr: ["'unsafe-inline'"], // el CRM usa onclick="" en cientos de botones — Helmet lo bloquea por defecto
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      // https: cubre el CDN de Higgsfield (cambia de dominio entre cuentas/regiones)
      // para el arte generado en Marketing — mismo criterio que el resto del CSP,
      // restringido a imágenes/video, no a scripts ni conexiones.
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      mediaSrc: ["'self'", 'https:'],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"], // nadie puede incrustar el CRM en un iframe (clickjacking)
    },
  },
}));

// No indexar en buscadores — es un CRM interno
app.use((req, res, next) => { res.setHeader('X-Robots-Tag', 'noindex, nofollow'); next(); });

// ── CORS — solo permite el propio dominio del CRM ──
const allowedOrigins = (process.env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error('Origen no permitido por CORS'));
  },
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Rate limit general — protege toda la API contra abuso/scraping ──
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones. Espera unos minutos.' },
});
app.use('/api', apiLimiter);

// ── Rate limit estricto en login: máximo 10 intentos fallidos cada 15 min por IP ──
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de inicio de sesión. Espera unos minutos.' },
});

// ── Rutas públicas ───────────────────────
// Identificador de esta versión desplegada — cambia en cada deploy/reinicio.
// El frontend lo usa para auto-recargarse cuando hay una versión nueva.
const APP_BUILD = process.env.RAILWAY_GIT_COMMIT_SHA || String(Date.now());
app.get('/api/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString(), build: APP_BUILD }));

// ── Interruptor de emergencia (Notion → 🔐 Panel de Seguridad) ──
// Bloquea TODA la API (incluido login) si la casilla está marcada en Notion.
const { killSwitchMiddleware } = require('./middleware/kill-switch');
app.use('/api', killSwitchMiddleware);

app.use('/api/auth/login', loginLimiter);
app.use('/api/auth/olvide-password', loginLimiter);
app.use('/api/auth/verify-2fa', loginLimiter);
app.use('/api/auth', require('./api/auth'));

// ── Callback de OAuth de Meta — público por diseño (Facebook redirige aquí
//    directo desde el navegador, sin poder mandar nuestro JWT). El botón que
//    INICIA la conexión (/api/marketing/meta/auth) sí queda protegido abajo. ──
app.use('/api/marketing', require('./api/marketing').publicRouter);

// ── Middleware de autenticación (todo lo demás requiere token) ──
app.use('/api', authMiddleware);

// ── Si la cuenta debe cambiar su contraseña, no puede usar el resto de la API ──
app.use('/api', enforcePasswordChange);

// ── Log de auditoría automático en toda acción que modifica datos ──
app.use('/api', auditLogger);

// ── Middleware de roles ───────────────────
// Prospectos y Clientes: acceso por REGISTRO según los 3 roles comerciales
// (Propietario / Ejec. de cuenta / Ejec. asignado), para ejecutivos Y administración.
// El admin (Dirección) ve todo.
app.use('/api/prospectos',   rolFilterCliente());
app.use('/api/clientes',     rolFilterCliente());
// OPs: heredan los 3 roles del cliente (jerarquía Propietario/Ejec.cuenta/Ejec.asignado)
app.use('/api/ops',          rolFilterCliente());
// Cotizaciones: heredan los 3 roles de la OP (o del cliente si no tiene OP)
app.use('/api/cotizaciones', rolFilterCliente());
// Casos y Tickets: heredan los roles del cliente/OP/cotización al que están ligados
// (se resuelve dentro de cada router, ya que Casos/Tickets no tienen columnas de rol propias)
app.use('/api/casos',        rolFilterCliente());
app.use('/api/tickets',      rolFilterCliente());

// Pagos y control de pagos (deudas a proveedores): Dirección + Oscar (oficina total).
// Oscar gestiona todo desde el CRM sin entrar a Notion; eliminar sigue siendo solo admin.
app.use('/api/pagos',        oficinaOnly);
app.use('/api/deudas',       oficinaOnly);

// Proveedores: cualquiera ve/edita, pero solo Admin puede eliminar
app.use('/api/proveedores',  deleteAdminOnly);

// Auditoría y respaldos: solo admin
app.use('/api/auditoria',    adminOnly);
app.use('/api/backup',       adminOnly);

// Marketing y Prospección: EXCLUSIVO de la cuenta de Natalia (no todo el rol
// admin — ver soloNatalia en api/_guard.js), heredadas de herramientas que
// vivían fuera del CRM y ahora comparten el mismo servidor/sesión/login.
app.use('/api/marketing',    soloNatalia);
app.use('/api/prospeccion',  soloNatalia);

// ── Rutas API ────────────────────────────
app.use('/api/prospectos',   require('./api/prospectos'));
app.use('/api/clientes',     require('./api/clientes'));
app.use('/api/ops',          require('./api/ops'));
app.use('/api/cotizaciones', require('./api/cotizaciones'));
app.use('/api/pagos',        require('./api/pagos'));
app.use('/api/proveedores',  require('./api/proveedores'));
app.use('/api/deudas',       require('./api/deudas'));
app.use('/api/casos',        require('./api/casos'));
app.use('/api/tickets',      require('./api/tickets'));
app.use('/api/vision',       require('./api/vision'));
app.use('/api/objetivos',    require('./api/objetivos'));
app.use('/api/auditoria',    require('./api/auditoria'));
app.use('/api/backup',       require('./api/backup'));
app.use('/api/marketing',    require('./api/marketing').router);
app.use('/api/prospeccion',  require('./api/prospeccion'));

// ── SPA fallback ─────────────────────────
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── Manejador de errores global — nunca exponer detalles internos ──
app.use((err, req, res, next) => {
  console.error('Error no manejado:', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// ════════════════════════════════════════
// Helpers
// ════════════════════════════════════════

function adminOnly(req, res, next) {
  if (req.user.role === 'admin') return next();
  return res.status(403).json({ error: 'Acceso restringido a Dirección' });
}

function deleteAdminOnly(req, res, next) {
  if (req.method === 'DELETE' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Solo el Admin puede eliminar registros' });
  }
  next();
}

// Acceso por registro (3 roles) para Prospectos y Clientes. Ejecutivos y
// administración quedan filtrados a los registros donde su identidad aparece
// como Propietario, Ejec. de cuenta o Ejec. asignado. Solo el Admin elimina.
function rolFilterCliente() {
  return (req, res, next) => {
    // Oficina total (Natalia y Oscar): ven y editan todo; solo el admin elimina.
    if (esOficinaTotal(req.user)) {
      if (req.method === 'DELETE' && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Solo el Admin puede eliminar registros' });
      }
      return next();
    }
    // Resto (ejecutivos y administracion-especiales): acceso por fila.
    if (req.method === 'DELETE') return res.status(403).json({ error: 'Solo el Admin puede eliminar registros' });
    req.rolFilter = identidadRol(req.user); // identidad del usuario en los 3 roles
    next();
  };
}

// Dirección + Oscar (oficina total). Eliminar sigue restringido al admin.
function oficinaOnly(req, res, next) {
  if (esOficinaTotal(req.user)) {
    if (req.method === 'DELETE' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Solo el Admin puede eliminar registros' });
    }
    return next();
  }
  return res.status(403).json({ error: 'Acceso restringido a Dirección y Administración' });
}

// Bloquea toda la API si la cuenta tiene una contraseña pendiente de cambiar —
// solo /api/auth/cambiar-password (manejado en su propio router) queda accesible.
function enforcePasswordChange(req, res, next) {
  if (req.user.mustChangePassword) {
    return res.status(403).json({ error: 'PASSWORD_CHANGE_REQUIRED', message: 'Debes cambiar tu contraseña antes de continuar' });
  }
  next();
}

// Registra automáticamente cada acción que crea, edita o elimina datos
function auditLogger(req, res, next) {
  res.on('finish', () => {
    if (!['POST', 'PATCH', 'DELETE'].includes(req.method)) return;
    if (req.path.startsWith('/api/vision')) return; // ya no aporta valor de auditoría
    const entidad = req.path.split('/')[1] || '';
    const accion  = req.method === 'POST' ? 'crear' : req.method === 'PATCH' ? 'editar' : 'eliminar';
    logAudit({
      usuario: req.user?.id,
      accion,
      entidad,
      detalle: `${req.method} ${req.path}`,
      ip: clientIp(req),
      exito: res.statusCode < 400,
    });
  });
  next();
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  ACTIDEA CRM v1.0`);
  console.log(`  http://localhost:${PORT}\n`);
});

// ── Respaldo automático mensual de Notion (1ro de cada mes, 3:00 am) ──
require('./jobs/backup-scheduler');

// ── Prospección automática semanal (domingos 8:00 am, hora CDMX) ──
require('./jobs/prospeccion-scheduler');
