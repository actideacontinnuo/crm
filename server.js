require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const path      = require('path');
const rateLimit = require('express-rate-limit');
const { authMiddleware } = require('./middleware/auth');

if (!process.env.JWT_SECRET) {
  console.warn('\n⚠️  ADVERTENCIA: JWT_SECRET no está configurada. Configúrala en .env / Railway antes de producción.\n');
}

const app = express();

// ── CORS — solo permite el propio dominio del CRM ──
const allowedOrigins = (process.env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin(origin, callback) {
    // Sin origin = llamadas server-to-server o herramientas como curl; se permiten
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error('Origen no permitido por CORS'));
  },
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Rate limit en login: máximo 10 intentos cada 15 min por IP ──
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true, // solo cuenta intentos fallidos
  message: { error: 'Demasiados intentos de inicio de sesión. Espera unos minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
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

// ════════════════════════════════════════
// Helpers de roles
// ════════════════════════════════════════

// Solo admin puede pasar
function adminOnly(req, res, next) {
  if (req.user.role === 'admin') return next();
  return res.status(403).json({ error: 'Acceso restringido a Dirección' });
}

// Solo admin puede eliminar; todos los demás roles autenticados pasan de largo
function deleteAdminOnly(req, res, next) {
  if (req.method === 'DELETE' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Solo el Admin puede eliminar registros' });
  }
  next();
}

// Ejecutivos: en GET list, inyectar filtro por su nombre (lo aplican los routers + _guard.js)
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
