// Variables de entorno para tests — nunca toca producción
process.env.NODE_ENV       = 'test';
process.env.JWT_SECRET     = 'test-secret-qa-2026';
process.env.PORT           = '3099';
process.env.RESEND_API_KEY = 'test-resend-key';
