// ════════════════════════════════════════════════════════════
// Marketing — Higgsfield AI (generación de imagen/video) + Meta (publicación
// en Facebook/Instagram). Acceso restringido a Natalia (soloNatalia en
// server.js) salvo el callback de OAuth de Meta, que por diseño de OAuth debe
// quedar público (Facebook redirige ahí sin poder mandar nuestro JWT) — ver
// `publicRouter` abajo, montado SIN el gate.
// ════════════════════════════════════════════════════════════
const express = require('express');
const router = express.Router();       // protegido — requiere sesión de Natalia
const publicRouter = express.Router(); // callback de OAuth — sin auth, por diseño
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── HIGGSFIELD — generación de imagen (síncrono) ──────────────
// Formatos válidos de Higgsfield (Soul) para width_and_height:
const HF_SIZES = ['1152x2048', '2048x1152', '2048x1536', '1536x2048', '1344x2016',
  '2016x1344', '960x1696', '1536x1536', '1536x1152', '1696x960', '1152x1536',
  '1088x1632', '1632x1088', '1120x1680', '1680x1120', '2048x2048'];

function sizeFor(type) {
  if (type === 'reel' || type === 'story') return '1152x2048'; // 9:16
  return '1536x1536'; // 1:1 — post
}

// POST /api/marketing/higgsfield/generate  →  genera arte con Higgsfield y
// devuelve la URL directo (sin cola de jobs ni humano de por medio).
router.post('/higgsfield/generate', async (req, res) => {
  const { prompt, type } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt requerido' });

  const keyPair = process.env.HIGGSFIELD_API_KEY || '';
  const [hfKey, hfSecret] = keyPair.split(':');
  if (!hfKey || !hfSecret) return res.status(400).json({ error: 'HIGGSFIELD_API_KEY no configurada en .env (formato KEY_ID:KEY_SECRET)' });

  try {
    const resp = await fetch('https://platform.higgsfield.ai/v1/text2image/soul', {
      method: 'POST',
      headers: { 'hf-api-key': hfKey, 'hf-secret': hfSecret, 'Content-Type': 'application/json' },
      body: JSON.stringify({ params: { prompt, width_and_height: sizeFor(type) } }),
    });
    const data = await resp.json();

    if (!resp.ok) {
      // "Not enough credits" y demás errores de negocio de Higgsfield llegan aquí tal cual.
      return res.status(resp.status).json({ error: data.detail || data.error || JSON.stringify(data) });
    }

    // Higgsfield puede responder con la URL directa, o con un job para consultar
    // después — se manejan ambos casos sin asumir cuál es (no hay forma de
    // probar el camino de éxito hasta que la cuenta tenga crédito).
    const directUrl = data.url || data.image_url || data.output?.[0]?.url || data.images?.[0]?.url;
    if (directUrl) return res.json({ status: 'completed', url: directUrl });

    const jobId = data.id || data.job_id || data.job_set_id;
    if (jobId) return res.json({ status: 'processing', jobId, raw: data });

    // Forma de respuesta desconocida — se regresa completa para poder diagnosticar
    // en vez de fallar en silencio.
    return res.status(502).json({ error: 'Respuesta de Higgsfield en formato inesperado', raw: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/marketing/higgsfield/status/:jobId  →  consulta un job asíncrono,
// solo aplica si /generate devolvió status:'processing'.
router.get('/higgsfield/status/:jobId', async (req, res) => {
  const keyPair = process.env.HIGGSFIELD_API_KEY || '';
  const [hfKey, hfSecret] = keyPair.split(':');
  try {
    const resp = await fetch(`https://platform.higgsfield.ai/v1/job-sets/${req.params.jobId}`, {
      headers: { 'hf-api-key': hfKey, 'hf-secret': hfSecret },
    });
    const data = await resp.json();
    if (!resp.ok) return res.status(resp.status).json({ error: data.detail || JSON.stringify(data) });
    const url = data.url || data.image_url || data.output?.[0]?.url || data.images?.[0]?.url;
    res.json(url ? { status: 'completed', url } : { status: data.status || 'processing', raw: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── META — OAuth flow ──────────────────────────────────────────

// GET /api/marketing/meta/auth  →  devuelve la URL de login de Facebook (no
// redirige directo: esta ruta requiere el header Authorization del CRM, que
// un simple window.open() del navegador no manda — el frontend pide esta URL
// vía fetch autenticado y LUEGO navega ahí con window.location).
router.get('/meta/auth', (req, res) => {
  const scopes = ['pages_manage_posts', 'pages_read_engagement', 'instagram_basic',
    'instagram_content_publish', 'business_management'].join(',');
  const url = `https://www.facebook.com/v20.0/dialog/oauth?` +
    `client_id=${process.env.META_APP_ID}` +
    `&redirect_uri=${encodeURIComponent(process.env.APP_URL + '/api/marketing/meta/callback')}` +
    `&scope=${scopes}&response_type=code`;
  res.json({ url });
});

// GET /api/marketing/meta/callback  →  Facebook redirige aquí con ?code=...
// Público por diseño de OAuth (Facebook no puede mandar nuestro JWT).
publicRouter.get('/meta/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('No code recibido de Meta');

  try {
    const tokenRes = await fetch(
      `https://graph.facebook.com/v20.0/oauth/access_token?` +
      `client_id=${process.env.META_APP_ID}&client_secret=${process.env.META_APP_SECRET}` +
      `&redirect_uri=${encodeURIComponent(process.env.APP_URL + '/api/marketing/meta/callback')}&code=${code}`
    );
    const tokenData = await tokenRes.json();
    if (tokenData.error) return res.status(400).json(tokenData);

    const longTokenRes = await fetch(
      `https://graph.facebook.com/v20.0/oauth/access_token?grant_type=fb_exchange_token` +
      `&client_id=${process.env.META_APP_ID}&client_secret=${process.env.META_APP_SECRET}` +
      `&fb_exchange_token=${tokenData.access_token}`
    );
    const longTokenData = await longTokenRes.json();
    const userToken = longTokenData.access_token || tokenData.access_token;

    const pagesRes  = await fetch(`https://graph.facebook.com/v20.0/me/accounts?access_token=${userToken}`);
    const pagesData = await pagesRes.json();
    const pages     = pagesData.data || [];

    if (pages.length === 0) return res.send('<h2>No se encontraron páginas de Facebook vinculadas a esta cuenta.</h2>');

    const pageLinks = pages.map(p =>
      `<a href="/api/marketing/meta/select-page?page_id=${p.id}&page_token=${p.access_token}">
        <strong>${p.name}</strong> (ID: ${p.id})
      </a>`
    ).join('<br><br>');

    res.send(`<html><body style="font-family:sans-serif;padding:40px">
      <h2>✅ Autenticación exitosa</h2>
      <p>Selecciona la página de Facebook que quieres usar:</p>
      ${pageLinks}
      </body></html>`);
  } catch (err) {
    console.error('[Meta OAuth]', err);
    res.status(500).send(err.message);
  }
});

// GET /api/marketing/meta/select-page  →  guarda el page token elegido.
// Público por el mismo motivo que el callback (viene de un link de Facebook).
publicRouter.get('/meta/select-page', async (req, res) => {
  const { page_id, page_token } = req.query;
  let igId = '';
  try {
    const igRes  = await fetch(`https://graph.facebook.com/v20.0/${page_id}?fields=instagram_business_account&access_token=${page_token}`);
    const igData = await igRes.json();
    igId = igData.instagram_business_account?.id || '';
  } catch {}

  updateEnv({ META_PAGE_ACCESS_TOKEN: page_token, META_PAGE_ID: page_id, META_INSTAGRAM_ID: igId });

  res.send(`<html><body style="font-family:sans-serif;padding:40px">
    <h2>✅ Página conectada correctamente</h2>
    <p><strong>Página ID:</strong> ${page_id}</p>
    <p><strong>Instagram ID:</strong> ${igId || '(no encontrado — verifica que la cuenta IG esté vinculada a esta página)'}</p>
    <p>Ya puedes cerrar esta ventana y volver a Actidea Continnuo.</p>
    </body></html>`);
});

// GET /api/marketing/meta/status
router.get('/meta/status', (req, res) => {
  res.json({
    connected: !!(process.env.META_PAGE_ACCESS_TOKEN && process.env.META_PAGE_ID),
    page_id:   process.env.META_PAGE_ID || null,
    ig_id:     process.env.META_INSTAGRAM_ID || null,
  });
});

// ── META — Publicación ─────────────────────────────────────────

async function waitForIgContainer(containerId, token, maxWaitMs = 90_000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const res  = await fetch(`https://graph.facebook.com/v20.0/${containerId}?fields=status_code&access_token=${token}`);
    const data = await res.json();
    if (data.status_code === 'FINISHED') return true;
    if (data.status_code === 'ERROR')    return false;
    await sleep(3000);
  }
  return false;
}

async function checkIgRateLimit(igId, token) {
  try {
    const res  = await fetch(`https://graph.facebook.com/v20.0/${igId}/content_publishing_limit?fields=config,quota_usage&access_token=${token}`);
    const data = await res.json();
    const usage = data.data?.[0]?.quota_usage ?? 0;
    const cap   = data.data?.[0]?.config?.quota_total ?? 25;
    return usage >= cap;
  } catch {
    return false;
  }
}

// POST /api/marketing/meta/publish — Body: { copy, cta, image_url, type }
router.post('/meta/publish', async (req, res) => {
  const { copy, cta, image_url, type } = req.body;
  const fullCaption = `${copy}\n\n${cta}`;
  const token   = process.env.META_PAGE_ACCESS_TOKEN;
  const pageId  = process.env.META_PAGE_ID;
  const igId    = process.env.META_INSTAGRAM_ID;

  if (!token || !pageId) return res.status(400).json({ error: 'Meta no conectado. Ve a Marketing > Conectar con Meta primero.' });

  const results = {};

  if (igId && image_url) {
    try {
      const overLimit = await checkIgRateLimit(igId, token);
      if (overLimit) {
        results.instagram = { success: false, error: 'Límite de 25 publicaciones/24h de Instagram alcanzado. Espera antes de publicar más.' };
      } else {
        const isVideo = type === 'reel';
        const mediaBody = isVideo
          ? { video_url: image_url, caption: fullCaption, media_type: 'REELS', access_token: token }
          : { image_url, caption: fullCaption, access_token: token };

        const createRes  = await fetch(`https://graph.facebook.com/v20.0/${igId}/media`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(mediaBody),
        });
        const createData = await createRes.json();

        if (createData.id) {
          const containerReady = isVideo ? await waitForIgContainer(createData.id, token) : true;
          if (!containerReady) {
            results.instagram = { success: false, error: 'El container de video no terminó de procesar a tiempo (Meta)' };
          } else {
            const pubRes  = await fetch(`https://graph.facebook.com/v20.0/${igId}/media_publish`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ creation_id: createData.id, access_token: token }),
            });
            const pubData = await pubRes.json();
            results.instagram = pubData.id
              ? { success: true, post_id: pubData.id }
              : { success: false, error: pubData.error?.message || 'Error al publicar' };
          }
        } else {
          results.instagram = { success: false, error: createData.error?.message || 'Error desconocido' };
        }
      }
    } catch (err) {
      results.instagram = { success: false, error: err.message };
    }
  }

  if (pageId) {
    try {
      const fbEndpoint = image_url
        ? `https://graph.facebook.com/v20.0/${pageId}/photos`
        : `https://graph.facebook.com/v20.0/${pageId}/feed`;
      const fbBody = image_url
        ? { url: image_url, message: fullCaption, access_token: token }
        : { message: fullCaption, access_token: token };

      const fbRes  = await fetch(fbEndpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fbBody),
      });
      const fbData = await fbRes.json();
      results.facebook = fbData.id
        ? { success: true, post_id: fbData.id }
        : { success: false, error: fbData.error?.message || 'Error desconocido' };
    } catch (err) {
      results.facebook = { success: false, error: err.message };
    }
  }

  results.linkedin = { success: false, note: 'LinkedIn requiere app aprobada por LinkedIn — configurar por separado' };

  res.json({ results });
});

// Persiste el token/página de Meta en el .env del servidor en disco.
// NOTA: en Railway el filesystem es efímero — un redeploy borra este cambio y
// hay que volver a conectar Meta desde el panel. Es una limitación conocida,
// no un bug nuevo introducido aquí.
function updateEnv(updates) {
  const envPath = path.join(__dirname, '..', '.env');
  let content = '';
  try { content = fs.readFileSync(envPath, 'utf8'); } catch {}
  for (const [key, val] of Object.entries(updates)) {
    const regex = new RegExp(`^${key}=.*`, 'm');
    const line  = `${key}=${val}`;
    if (regex.test(content)) content = content.replace(regex, line);
    else content += `\n${line}`;
  }
  fs.writeFileSync(envPath, content);
  Object.assign(process.env, updates);
}

module.exports = { router, publicRouter };
