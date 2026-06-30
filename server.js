require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const { authMiddleware } = require('./middleware/auth');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Rutas públicas ───────────────────────
app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', require('./api/auth'));

// ── Middleware de autenticación (todo lo demás requiere token) ──
app.use('/api', authMiddleware);

// ── Middleware de roles ───────────────────
// Ejecutivos solo ven sus propios datos
app.use('/api/prospectos',   roleFilter('ejec'));
app.use('/api/clientes',     roleFilter('ejec'));
app.use('/api/ops',          roleFilter('ejec'));
app.use('/api/cotizaciones', roleFilter('ejec'));

// Pagos y comisiones: solo admin
app.use('/api/pagos',        adminOnly);
app.use('/api/deudas',       adminOnly);

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

// ── Health check ─────────────────────────
app.get('/api/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

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

// Ejecutivos: en GET list, inyectar filtro por su nombre; admins y administración pasan sin filtro
function roleFilter(field) {
  return (req, res, next) => {
    if (req.user.role === 'ejecutivo') {
      // Solo DELETE está bloqueado para ejecutivos
      if (req.method === 'DELETE') return res.status(403).json({ error: 'No tienes permiso para eliminar registros' });
      req.ejecFilter = req.user.ejec; // lo leen los routers
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
