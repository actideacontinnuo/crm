require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const path      = require('path');
const rateLimit = require('express-rate-limit');
const { authMiddleware } = require('./middleware/auth');

if (!process.env.JWT_SECRET) {
  console.warn('\n⚠️  ADVERTENCIA: JWT_SECRET no está configurada. Configúrala en .env / Railway antes de producción.\n');
}

const app = express();

// ── Confiar en el proxy de Railway — necesario para que el rate limit
//    identifique la IP real del visitante y no la del proxy interno ──
app.set('trust proxy', 1);

// ── Cabeceras de seguridad estándar (Helmet) ──
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:'],
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
  max: 600, // 600 peticiones / 15 min por IP — generoso para uso normal, bloquea scripts automatizados
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
app.get('/api/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth', require('./api/auth'));

// ── Middleware de autenticación (todo lo demás requiere token) ──
app.use('/api', authMiddleware);

// ── Middleware de roles ───────────────────
// Ejecutivos solo ven/modifican sus propios datos (filtro real en cada router + _guard.js)
app.use('/api/prospectos',   roleFilter());
app.use('/api/clientes',     roleFilter());
app.use('/api/ops',          roleFilter());
app.use('/api/cotizaciones', roleFilter());

// Pagos y comisiones: solo admin
app.use('/api/pagos',        adminOnly);
app.use('/api/deudas',       adminOnly);

// Proveedores: cualquiera ve/edita, pero solo Admin puede eliminar
app.use('/api/proveedores',  deleteAdminOnly);

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

// ── SPA fallback ─────────────────────────
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── Manejador de errores global — nunca exponer detalles internos ──
app.use((err, req, res, next) => {
  console.error('Error no manejado:', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// ════════════════════════════════════════
// Helpers de roles
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

function roleFilter() {
  return (req, res, next) => {
    if (req.user.role === 'ejecutivo') {
      if (req.method === 'DELETE') return res.status(403).json({ error: 'No tienes permiso para eliminar registros' });
      req.ejecFilter = req.user.ejec;
    }
    if (req.user.role === 'administracion' && req.method === 'DELETE') {
      return res.status(403).json({ error: 'Solo el Admin puede eliminar registros' });
    }
    next();
  };
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  ACTIDEA CRM v1.0`);
  console.log(`  http://localhost:${PORT}\n`);
});
