// Variables de entorno para tests — nunca toca producción
process.env.NODE_ENV       = 'test';
process.env.JWT_SECRET     = 'test-secret-qa-2026';
process.env.PORT           = '3099';
process.env.NOTION_TOKEN   = 'test-token';
process.env.RESEND_API_KEY = 'test-resend-key';

// DB IDs de prueba (strings, no importa el valor — Notion está mockeado)
const dbs = ['PROSPECTOS','CLIENTES','OPS','COTIZACIONES','PAGOS',
              'PROVEEDORES','DEUDAS','CASOS','TICKETS','USUARIOS','OBJETIVOS','AUDITORIA'];
dbs.forEach(db => { process.env[`NOTION_DB_${db}`] = `test-db-${db.toLowerCase()}`; });
