const jwt = require('jsonwebtoken');
// En producción JWT_SECRET es OBLIGATORIA: sin ella, un secreto aleatorio por
// arranque cerraría la sesión de todos en cada reinicio del servidor.
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET no está configurada. Es obligatoria en producción — configúrala antes de desplegar.');
}
// Fuera de producción, sin JWT_SECRET no hay fallback fijo: se genera uno aleatorio
// por arranque. Nadie puede forjar tokens con un secreto conocido públicamente.
const SECRET = process.env.JWT_SECRET || require('crypto').randomBytes(32).toString('hex');

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
