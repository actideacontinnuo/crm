// ════════════════════════════════════════════════════════════
// Capa de acceso a datos — Postgres (Supabase). Reemplazó a la antigua capa de Notion.
// Mismo espíritu que aquel (funciones simples, sin ORM), pero con relaciones
// REALES (foreign keys) y transacciones — lo que Notion nunca pudo
// tener, y lo que hizo posible el bug de duplicación de pagos a proveedor
// que se corrigió antes de esta migración.
// ════════════════════════════════════════════════════════════
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
});

// snake_case (columnas de Postgres) ↔ camelCase (objetos JS del API) —
// automático, así cada api/*.js no tiene que repetir un mapeo campo por
// campo como antes hacía con prop_text/read_text para cada propiedad de la base de datos.
function toSnake(s) { return s.replace(/[A-Z]/g, l => '_' + l.toLowerCase()); }
function toCamel(s) { return s.replace(/_([a-z0-9])/g, (_, l) => l.toUpperCase()); }

function rowToCamel(row) {
  if (!row) return null;
  const out = {};
  for (const [k, v] of Object.entries(row)) out[toCamel(k)] = v;
  return out;
}
function dataToSnake(data) {
  const out = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (v !== undefined) out[toSnake(k)] = v;
  }
  return out;
}

// Nombres de tabla — lista blanca (nunca se interpola un nombre de tabla que
// no venga de aquí, para que no haya forma de inyectar SQL por esta vía).
const TABLES = new Set(['usuarios', 'clientes', 'prospectos', 'ops', 'cotizaciones',
  'proveedores', 'deudas', 'pagos', 'casos', 'tickets', 'objetivos', 'auditoria', 'seguridad']);
function _tabla(t) {
  if (!TABLES.has(t)) throw new Error(`Tabla desconocida: ${t}`);
  return t;
}

// ─── Lectura ────────────────────────────────────────────────
// where: { campo: valor } → igualdad simple (AND). Para filtros más
// complejos (IN, rangos) se usa whereRaw (ver queryDB con opts.whereRaw).
async function queryDB(table, where = null, orderBy = null, opts = {}) {
  const t = _tabla(table);
  const conds = ['deleted_at IS NULL'];
  const vals = [];
  for (const [k, v] of Object.entries(where || {})) {
    vals.push(v);
    conds.push(`${toSnake(k)} = $${vals.length}`);
  }
  if (opts.whereRaw) conds.push(opts.whereRaw);
  let sql = `SELECT * FROM ${t} WHERE ${conds.join(' AND ')}`;
  if (orderBy) {
    const campo = toSnake(orderBy.field);
    sql += ` ORDER BY ${campo} ${orderBy.direction === 'descending' ? 'DESC' : 'ASC'} NULLS LAST`;
  }
  const res = await pool.query(sql, vals);
  return res.rows.map(rowToCamel);
}

async function getRow(table, id) {
  const t = _tabla(table);
  const res = await pool.query(`SELECT * FROM ${t} WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!res.rows[0]) { const e = new Error('Registro no encontrado'); e.status = 404; throw e; }
  return rowToCamel(res.rows[0]);
}

async function createRow(table, data) {
  const t = _tabla(table);
  const snake = dataToSnake(data);
  const keys = Object.keys(snake);
  if (!keys.length) throw new Error('createRow: sin datos');
  const cols = keys.join(', ');
  const params = keys.map((_, i) => `$${i + 1}`).join(', ');
  const res = await pool.query(`INSERT INTO ${t} (${cols}) VALUES (${params}) RETURNING *`, Object.values(snake));
  return rowToCamel(res.rows[0]);
}

async function updateRow(table, id, data) {
  const t = _tabla(table);
  const snake = dataToSnake(data);
  const keys = Object.keys(snake);
  if (!keys.length) return getRow(table, id);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const res = await pool.query(
    `UPDATE ${t} SET ${sets} WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
    [id, ...Object.values(snake)]
  );
  if (!res.rows[0]) { const e = new Error('Registro no encontrado'); e.status = 404; throw e; }
  return rowToCamel(res.rows[0]);
}

// Archiva (soft-delete) — recuperable, nunca borra de verdad. Mismo criterio
// que el archivado de páginas de Notion.
async function archiveRow(table, id) {
  const t = _tabla(table);
  const res = await pool.query(`UPDATE ${t} SET deleted_at = now() WHERE id = $1 RETURNING *`, [id]);
  return rowToCamel(res.rows[0]);
}

// ─── Transacciones ──────────────────────────────────────────
// Para operaciones que deben ser atómicas (p. ej. abonar a una deuda: leer
// el Pagado actual + sumar + escribir, sin que otra petición se cruce en
// medio — algo que la base de datos nunca pudo garantizar). 'fn' recibe un cliente de
// Postgres con los mismos helpers, ya dentro de BEGIN/COMMIT.
async function transaccion(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const helpers = {
      // SELECT ... FOR UPDATE — bloquea la fila hasta que termine la transacción,
      // así dos abonos simultáneos a la misma deuda nunca se pisan.
      async getForUpdate(table, id) {
        const t = _tabla(table);
        const res = await client.query(`SELECT * FROM ${t} WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [id]);
        if (!res.rows[0]) { const e = new Error('Registro no encontrado'); e.status = 404; throw e; }
        return rowToCamel(res.rows[0]);
      },
      async update(table, id, data) {
        const t = _tabla(table);
        const snake = dataToSnake(data);
        const keys = Object.keys(snake);
        const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
        const res = await client.query(`UPDATE ${t} SET ${sets} WHERE id = $1 RETURNING *`, [id, ...Object.values(snake)]);
        return rowToCamel(res.rows[0]);
      },
    };
    const resultado = await fn(helpers);
    await client.query('COMMIT');
    return resultado;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─── Agregaciones (SUM) — usadas por Utilidad/Cobrado reales ──
async function sumWhere(table, sumField, where = {}) {
  const t = _tabla(table);
  const conds = ['deleted_at IS NULL'];
  const vals = [];
  for (const [k, v] of Object.entries(where)) { vals.push(v); conds.push(`${toSnake(k)} = $${vals.length}`); }
  const res = await pool.query(`SELECT COALESCE(SUM(${toSnake(sumField)}), 0) AS total FROM ${t} WHERE ${conds.join(' AND ')}`, vals);
  return Number(res.rows[0].total);
}


// ── Archivos (Supabase Storage, bucket PRIVADO) ─────────────
// Se guarda la RUTA en la base; el navegador solo recibe URLs firmadas que caducan.
const _sbHeaders = () => ({ Authorization: 'Bearer ' + process.env.SUPABASE_SECRET_KEY, apikey: process.env.SUPABASE_SECRET_KEY });
async function subirArchivo(bucket, buffer, filename, mimetype) {
  const limpio = String(filename || 'archivo').replace(/[^A-Za-z0-9._-]/g, '_');
  const ruta = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${limpio}`;
  const r = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/${bucket}/${ruta}`, {
    method: 'POST', headers: { ..._sbHeaders(), 'Content-Type': mimetype || 'application/octet-stream' }, body: buffer,
  });
  if (!r.ok) throw new Error('No se pudo subir el archivo: ' + (await r.text()));
  return ruta;
}
async function urlFirmada(bucket, ruta, segundos = 3600) {
  if (!ruta) return null;
  const r = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/sign/${bucket}/${ruta}`, {
    method: 'POST', headers: { ..._sbHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: segundos }),
  });
  if (!r.ok) return null;
  const { signedURL } = await r.json();
  return `${process.env.SUPABASE_URL}/storage/v1${signedURL}`;
}

module.exports = { subirArchivo, urlFirmada,
  pool, queryDB, getRow, createRow, updateRow, archiveRow, transaccion, sumWhere,
  toCamel, toSnake,
};
