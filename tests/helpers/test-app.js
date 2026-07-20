/**
 * Crea una instancia del servidor Express con Notion mockeado.
 * Usar en pruebas de integración con supertest.
 */

// Parchear el módulo ANTES de que server.js o cualquier api/*.js lo requiera
const mockNotion = require('./mock-notion');
jest.mock('../../api/notion', () => mockNotion);
// Silenciar el audit log en tests
jest.mock('../../api/_audit', () => ({
  logAudit: jest.fn().mockResolvedValue(undefined),
  clientIp: () => '127.0.0.1',
}));

const express = require('express');
const path    = require('path');
const helmet  = require('helmet');
const rateLimit = require('express-rate-limit');
const { authMiddleware } = require('../../middleware/auth');
const { logAudit, clientIp } = require('../../api/_audit');

function buildApp() {
  const app = express();

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: '10mb' }));
  app.use(express.static(path.join(__dirname, '../../public')));

  // Rutas públicas
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', require('../../api/auth'));

  // Auth middleware
  app.use('/api', authMiddleware);

  // Enforce password change
  app.use('/api', (req, res, next) => {
    if (req.user?.mustChangePassword) {
      return res.status(403).json({ error: 'PASSWORD_CHANGE_REQUIRED' });
    }
    next();
  });

  // Roles
  function adminOnly(req, res, next) {
    if (req.user.role === 'admin') return next();
    return res.status(403).json({ error: 'Acceso restringido a Dirección' });
  }
  function roleFilter() {
    return (req, res, next) => {
      if (req.user.role === 'ejecutivo') {
        if (req.method === 'DELETE') return res.status(403).json({ error: 'Sin permiso' });
        req.ejecFilter = req.user.ejec;
      }
      if (req.user.role === 'administracion' && req.method === 'DELETE') {
        return res.status(403).json({ error: 'Sin permiso' });
      }
      next();
    };
  }

  function deleteAdminOnly(req, res, next) {
    if (req.method === 'DELETE' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Solo el Admin puede eliminar registros' });
    }
    next();
  }
  // Acceso por registro (3 roles) — espeja server.js
  function rolFilterCliente() {
    return (req, res, next) => {
      if (req.user.role !== 'admin') {
        if (req.method === 'DELETE') return res.status(403).json({ error: 'Solo el Admin puede eliminar registros' });
        req.rolFilter = req.user.ejec;
      }
      next();
    };
  }

  app.use('/api/prospectos',   rolFilterCliente());
  app.use('/api/clientes',     rolFilterCliente());
  app.use('/api/ops',          rolFilterCliente());
  app.use('/api/cotizaciones', roleFilter());
  app.use('/api/pagos',        adminOnly);
  app.use('/api/deudas',       adminOnly);
  app.use('/api/proveedores',  deleteAdminOnly);
  app.use('/api/auditoria',    adminOnly);
  app.use('/api/backup',       adminOnly);

  // Rutas API
  app.use('/api/prospectos',   require('../../api/prospectos'));
  app.use('/api/clientes',     require('../../api/clientes'));
  app.use('/api/ops',          require('../../api/ops'));
  app.use('/api/cotizaciones', require('../../api/cotizaciones'));
  app.use('/api/pagos',        require('../../api/pagos'));
  app.use('/api/proveedores',  require('../../api/proveedores'));
  app.use('/api/deudas',       require('../../api/deudas'));
  app.use('/api/casos',        require('../../api/casos'));
  app.use('/api/tickets',      require('../../api/tickets'));
  app.use('/api/vision',       require('../../api/vision'));
  app.use('/api/objetivos',    require('../../api/objetivos'));
  app.use('/api/auditoria',    require('../../api/auditoria'));
  app.use('/api/backup',       require('../../api/backup'));

  app.get('*', (_req, res) => res.sendFile(path.join(__dirname, '../../public/index.html')));

  app.use((err, _req, res, _next) => {
    res.status(500).json({ error: 'Error interno del servidor' });
  });

  return app;
}

module.exports = { buildApp };
