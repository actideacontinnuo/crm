require('dotenv').config();
const { Client } = require('@notionhq/client');
const https = require('https');

// Railway suele salir a internet por IPv6, y la conexión con Notion (Cloudflare)
// por IPv6 se cae a media respuesta ("Premature close"). Forzamos IPv4 y evitamos
// reutilizar conexiones keep-alive obsoletas — funciona igual en local.
const notionAgent = new https.Agent({ family: 4, keepAlive: false });

const notion = new Client({ auth: process.env.NOTION_TOKEN, agent: notionAgent });

const DBS = {
  prospectos:   process.env.NOTION_DB_PROSPECTOS,
  clientes:     process.env.NOTION_DB_CLIENTES,
  ops:          process.env.NOTION_DB_OPS,
  cotizaciones: process.env.NOTION_DB_COTIZACIONES,
  pagos:        process.env.NOTION_DB_PAGOS,
  proveedores:  process.env.NOTION_DB_PROVEEDORES,
  deudas:       process.env.NOTION_DB_DEUDAS,
  casos:        process.env.NOTION_DB_CASOS,
  tickets:      process.env.NOTION_DB_TICKETS,
  usuarios:     process.env.NOTION_DB_USUARIOS,
  objetivos:    process.env.NOTION_DB_OBJETIVOS,
  auditoria:    process.env.NOTION_DB_AUDITORIA,
  seguridad:    process.env.NOTION_DB_SEGURIDAD,
};

// ── Reintento automático para errores de red transitorios ──
// Notion ocasionalmente corta la conexión a media respuesta ("Premature close",
// socket hang up, ECONNRESET, fetch failed). Reintentamos con backoff en lugar
// de propagar el error al usuario (p. ej. bloqueando un login válido).
const TRANSIENT = /premature close|socket hang up|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|fetch failed|network/i;

function _isTransient(err) {
  const msg = String(err?.message || err || '');
  // 5xx de Notion y rate limit (429) también son reintentables
  if (err?.status && (err.status === 429 || err.status >= 500)) return true;
  return TRANSIENT.test(msg);
}

async function withRetry(fn, { retries = 3, baseDelay = 400 } = {}) {
  let lastErr;
  for (let intento = 0; intento <= retries; intento++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (intento === retries || !_isTransient(err)) throw err;
      const espera = baseDelay * Math.pow(2, intento); // 400ms, 800ms, 1600ms
      await new Promise(r => setTimeout(r, espera));
    }
  }
  throw lastErr;
}

async function queryDB(dbKey, filter = null, sorts = null) {
  const baseParams = { database_id: DBS[dbKey], page_size: 100 };
  if (filter) baseParams.filter = filter;
  if (sorts) baseParams.sorts = sorts;

  let results = [];
  let cursor;
  do {
    const params = { ...baseParams };
    if (cursor) params.start_cursor = cursor;
    const res = await withRetry(() => notion.databases.query(params));
    results = results.concat(res.results);
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor);

  return results;
}

async function createPage(dbKey, properties) {
  return withRetry(() => notion.pages.create({
    parent: { database_id: DBS[dbKey] },
    properties,
  }));
}

async function updatePage(pageId, properties) {
  return withRetry(() => notion.pages.update({ page_id: pageId, properties }));
}

async function getPage(pageId) {
  return withRetry(() => notion.pages.retrieve({ page_id: pageId }));
}

async function archivePage(pageId) {
  return withRetry(() => notion.pages.update({ page_id: pageId, archived: true }));
}

// ─── Property builders (write to Notion) ──────────────────
function prop_title(val) {
  return { title: [{ text: { content: String(val ?? '').substring(0, 2000) } }] };
}
function prop_text(val) {
  const s = String(val ?? '').substring(0, 2000);
  return { rich_text: s ? [{ text: { content: s } }] : [] };
}
function prop_number(val) {
  if (val === '' || val === null || val === undefined) return { number: null };
  const n = Number(val);
  return { number: isNaN(n) ? null : n };
}
function prop_select(val) {
  return val ? { select: { name: String(val) } } : { select: null };
}
function prop_date(val) {
  return val ? { date: { start: val } } : { date: null };
}
function prop_checkbox(val) {
  return { checkbox: Boolean(val) };
}
function prop_email(val) {
  return { email: val || null };
}
function prop_phone(val) {
  return { phone_number: val || null };
}
// Propiedad "files": recibe una lista de { id, name } (file_upload ya subidos).
function prop_files(list) {
  const arr = (list || []).filter(f => f && f.id).map(f => ({
    type: 'file_upload', name: f.name || 'archivo', file_upload: { id: f.id },
  }));
  return { files: arr };
}

// ─── Subida de archivos a Notion (Direct Upload) ──────────────
// El SDK 2.3.0 aún no expone `fileUploads`, así que usamos la API REST directa.
// Devuelve el id del file_upload listo para adjuntarse a una propiedad "files".
const NOTION_VERSION = '2022-06-28';
async function uploadFileToNotion(buffer, filename, contentType) {
  const authHeaders = {
    Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
    'Notion-Version': NOTION_VERSION,
  };
  return withRetry(async () => {
    // 1) Crear el file_upload (single_part, hasta 20 MB)
    const createRes = await fetch('https://api.notion.com/v1/file_uploads', {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'single_part', filename, content_type: contentType }),
    });
    const created = await createRes.json();
    if (!createRes.ok) throw new Error(created.message || 'No se pudo iniciar la subida a Notion');

    // 2) Enviar los bytes (multipart/form-data, campo "file")
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: contentType }), filename);
    const sendRes = await fetch(`https://api.notion.com/v1/file_uploads/${created.id}/send`, {
      method: 'POST', headers: authHeaders, body: form,
    });
    const sent = await sendRes.json();
    if (!sendRes.ok) throw new Error(sent.message || 'No se pudo subir el archivo a Notion');
    return created.id;
  });
}

// ─── Property readers (read from Notion) ──────────────────
function read_title(prop) {
  return prop?.title?.[0]?.plain_text ?? '';
}
function read_text(prop) {
  return prop?.rich_text?.map(r => r.plain_text).join('') ?? '';
}
function read_number(prop) {
  return prop?.number ?? 0;
}
function read_select(prop) {
  return prop?.select?.name ?? '';
}
function read_date(prop) {
  return prop?.date?.start ?? null;
}
function read_checkbox(prop) {
  return prop?.checkbox ?? false;
}
function read_email(prop) {
  return prop?.email ?? '';
}
function read_phone(prop) {
  return prop?.phone_number ?? '';
}
// Lee una propiedad "files" → [{ name, url }]. Las URLs de archivos subidos a
// Notion son temporales (caducan ~1h); el frontend siempre relee al abrir.
function read_files(prop) {
  return (prop?.files || []).map(f => ({
    name: f.name || 'archivo',
    url: f.type === 'external' ? f.external?.url : (f.file?.url || ''),
  })).filter(f => f.url);
}

module.exports = {
  notion,
  DBS,
  queryDB,
  createPage,
  updatePage,
  getPage,
  archivePage,
  prop_title, prop_text, prop_number, prop_select, prop_date, prop_checkbox, prop_email, prop_phone, prop_files,
  read_title, read_text, read_number, read_select, read_date, read_checkbox, read_email, read_phone, read_files,
  uploadFileToNotion,
};
