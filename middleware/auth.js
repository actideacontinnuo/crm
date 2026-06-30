const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'actidea-crm-secret-2026';

function authMiddleware(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  try {
    const decoded = jwt.verify(token, SECRET);
    // Un token "pendiente de 2FA" solo sirve para /api/auth/verify-2fa — nunca para datos reales
    if (decoded.scope === '2fa-pending') {
      return res.status(401).json({ error: 'Verifica tu código de autenticación de dos pasos para continuar' });
    }
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Sesión expirada, vuelve a iniciar sesión' });
  }
}

module.exports = { authMiddleware, SECRET };
