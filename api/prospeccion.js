// ════════════════════════════════════════════════════════════
// Prospección — Apollo (búsqueda) + Claude (verificación/redacción) + Notion
// (carga como Prospecto real de la CRM). Todo SÍNCRONO: sin cola de jobs ni
// dependencia de que un humano procese algo a mano — responde directo al
// request. Acceso restringido a Natalia (ver soloNatalia en server.js).
// ════════════════════════════════════════════════════════════
const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');
const { createPage, prop_title, prop_text, prop_phone, prop_email, prop_select, prop_number } = require('./notion');
const { aplicarReglasComision, obtenerRosterEjecutivos } = require('./_roles');

// q_keywords en Apollo exige que TODAS las palabras aparezcan en el perfil — por
// eso una sola palabra clave (en inglés, como Apollo indexa) por sector.
const SECTOR_MAP = {
  corp:    { apollo: 'corporate',      title: 'Corporativo'   },
  auto:    { apollo: 'automotive',     title: 'Automotriz'    },
  pharma:  { apollo: 'pharmaceutical', title: 'Farmacéutica'  },
  tech:    { apollo: 'technology',     title: 'Tecnología'    },
  fin:     { apollo: 'banking',        title: 'Financiero'    },
  retail:  { apollo: 'retail',         title: 'Retail'        },
  gov:     { apollo: 'government',     title: 'Gobierno'      },
  media:   { apollo: 'media',          title: 'Medios'        },
  logis:   { apollo: 'logistics',      title: 'Logística'     },
  salud:   { apollo: 'healthcare',     title: 'Salud'         },
  edu:     { apollo: 'education',      title: 'Educación'     },
  constr:  { apollo: 'construction',   title: 'Construcción'  },
  mfg:     { apollo: 'manufacturing',  title: 'Manufactura'   },
  hosp:    { apollo: 'hospitality',    title: 'Hospitalidad'  },
  agro:    { apollo: 'agriculture',    title: 'Agroindustria' },
  energia: { apollo: 'energy',         title: 'Energía'       },
  deporte: { apollo: 'sports',         title: 'Deportivo'     },
  ong:     { apollo: 'nonprofit',      title: 'ONG'           },
  food:    { apollo: 'food',           title: 'Alimentos'     },
  law:     { apollo: 'legal',          title: 'Legal'         },
};

router.get('/config/status', (req, res) => {
  res.json({
    apollo:    !!process.env.APOLLO_API_KEY,
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    notion:    !!process.env.NOTION_TOKEN,
  });
});

// POST /api/prospeccion/buscar  →  busca leads en Apollo por sectores
router.post('/buscar', async (req, res) => {
  const { sectors = ['corp', 'auto', 'pharma', 'tech'], perSector = 5 } = req.body;
  const apolloKey = process.env.APOLLO_API_KEY;
  if (!apolloKey) return res.status(400).json({ error: 'APOLLO_API_KEY no configurada en .env' });

  const results = [];
  const errors  = [];

  for (const sectorId of sectors) {
    const info = SECTOR_MAP[sectorId];
    if (!info) continue;

    try {
      const searchResp = await fetch('https://api.apollo.io/api/v1/mixed_people/api_search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': apolloKey },
        body: JSON.stringify({
          person_titles: ['Director de Eventos', 'Director de Marketing', 'Gerente de Eventos',
                          'VP Marketing', 'Director de Comunicación', 'Jefe de Eventos',
                          'Events Manager', 'Marketing Manager', 'Director Comercial'],
          person_locations: ['Mexico'],
          q_keywords: info.apollo,
          per_page: perSector * 3,
          page: 1,
        }),
      });

      if (!searchResp.ok) {
        const errText = await searchResp.text();
        errors.push({ sector: sectorId, error: `Apollo ${searchResp.status}: ${errText.slice(0, 200)}` });
        continue;
      }

      const searchData = await searchResp.json();
      const candidates = (searchData.people || []).filter(p => p.has_email === true).slice(0, perSector);

      if (!candidates.length) {
        errors.push({ sector: sectorId, error: 'No se encontraron contactos con email en Apollo para este sector' });
        continue;
      }

      const enrichResp = await fetch('https://api.apollo.io/api/v1/people/bulk_match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': apolloKey },
        body: JSON.stringify({
          details: candidates.map(p => ({ id: p.id, first_name: p.first_name, organization_name: p.organization?.name })),
          reveal_personal_emails: false,
        }),
      });

      let enrichedMap = {};
      if (enrichResp.ok) {
        const enrichData = await enrichResp.json();
        (enrichData.matches || []).forEach(m => { if (m.id) enrichedMap[m.id] = m; });
      }

      for (const p of candidates) {
        const enriched = enrichedMap[p.id] || {};
        results.push({
          id:          p.id,
          name:        `${p.first_name || ''} ${enriched.last_name || p.last_name_obfuscated || ''}`.trim(),
          title:       enriched.title || p.title || '',
          company:     enriched.organization?.name || p.organization?.name || '',
          email:       enriched.email || enriched.sanitized_email || '',
          linkedin:    enriched.linkedin_url || '',
          phone:       enriched.phone_numbers?.[0]?.raw_number || '',
          sector:      sectorId,
          sectorTitle: info.title,
          emailStatus: enriched.email_status || 'unknown',
          apolloId:    p.id,
          city:        enriched.city || '',
          country:     enriched.country || 'México',
          verified:    false,
        });
      }
    } catch (err) {
      errors.push({ sector: sectorId, error: err.message });
    }
  }

  res.json({ leads: results, errors, total: results.length });
});

// POST /api/prospeccion/verificar  →  Claude verifica y enriquece cada lead
router.post('/verificar', async (req, res) => {
  const { leads = [] } = req.body;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    const passthrough = leads.map(l => ({
      ...l,
      verified: l.emailStatus === 'verified' || l.emailStatus === 'likely to engage',
      confidence: l.emailStatus === 'verified' ? 8 : l.emailStatus === 'likely to engage' ? 6 : 5,
      verificationNotes: 'Verificación Claude pendiente — basada solo en Apollo',
      verifiedAt: new Date().toISOString(),
    }));
    return res.json({ leads: passthrough, total: passthrough.length, warning: 'Claude no disponible — usando solo datos de Apollo' });
  }

  const BATCH = 20;
  const verified = [];

  for (let i = 0; i < leads.length; i += BATCH) {
    const batch = leads.slice(i, i + BATCH);
    const today = new Date().toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 4096,
          system: `Eres un agente de verificación de datos de prospectos B2B para Actidea Continnuo, productora de eventos en México. Hoy es ${today}. Tu tarea: verificar y enriquecer datos de contactos obtenidos de Apollo.io. Evalúa si el nombre, puesto, empresa y sector son coherentes y reales. Corrige datos obviamente incorrectos. Asigna un score de confianza 1-10. Responde SIEMPRE en JSON válido, sin texto adicional.`,
          messages: [{
            role: 'user',
            content: `Verifica estos ${batch.length} prospectos obtenidos hoy de Apollo.io para Actidea Continnuo (productora de eventos corporativos en México). Para cada uno evalúa: nombre completo real, empresa conocida en México, puesto relevante para comprar eventos corporativos, email con dominio coherente con la empresa.

Leads a verificar:
${JSON.stringify(batch.map(l => ({ id: l.id, name: l.name, title: l.title, company: l.company, email: l.email, sector: l.sectorTitle })), null, 2)}

Responde con JSON array exacto:
[{"id":"...","verified":true/false,"confidence":1-10,"notes":"razón breve","suggestedTitle":"título corregido si aplica","suggestedCompany":"empresa corregida si aplica"}]`,
          }],
        }),
      });

      const data = await resp.json();
      const raw  = data.content?.[0]?.text || '[]';
      const clean = raw.replace(/```json|```/g, '').trim();
      const verifications = JSON.parse(clean);

      const vMap = {};
      for (const v of verifications) vMap[v.id] = v;

      for (const lead of batch) {
        const v = vMap[lead.id] || {};
        verified.push({
          ...lead,
          verified:        v.verified !== false,
          confidence:      v.confidence || 7,
          verificationNotes: v.notes || '',
          title:           v.suggestedTitle   || lead.title,
          company:         v.suggestedCompany || lead.company,
          verifiedAt:      new Date().toISOString(),
        });
      }
    } catch (err) {
      for (const lead of batch) verified.push({ ...lead, verified: true, confidence: 5, verificationNotes: 'Verificación automática no disponible' });
    }
  }

  res.json({ leads: verified, total: verified.length });
});

// POST /api/prospeccion/generar-email  →  redacta un email frío con Claude
// (antes esto se llamaba directo desde el navegador a api.anthropic.com sin
// llave — nunca podía funcionar de forma segura. Ahora vive en el servidor.)
router.post('/generar-email', async (req, res) => {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return res.status(400).json({ error: 'ANTHROPIC_API_KEY no configurada en .env' });

  const { empresa = 'la empresa', sectorName = 'Corporativo' } = req.body;
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        system: `Eres el equipo de ventas de Actidea Continnuo, empresa mexicana con 25 años produciendo eventos corporativos e institucionales de alto nivel. Clientes reales: Disney, Microsoft, Porsche, HSBC, Danone, Bimbo, Colgate, Kimberly Clark, GSK, J&J, General Motors, Honda. Servicios: eventos corporativos, congresos, lanzamientos, activaciones de marca, stands y construcción especializada. NUNCA uses frases genéricas. Responde SOLO en JSON válido sin texto adicional ni markdown.`,
        messages: [{
          role: 'user',
          content: `Genera un email frío de prospección para:
- Empresa: ${empresa}
- Sector: ${sectorName}
- Remitente: Actidea Continnuo (productora de eventos, CDMX, 25 años)

Requisitos:
1. Asunto nuevo, impactante y personalizado (máx 9 palabras, sin emojis)
2. Apertura con referencia al sector o empresa
3. Menciona un cliente real de Actidea del mismo sector como credencial
4. Propuesta de valor específica en 2 líneas
5. CTA preguntando por 20 minutos esta semana
6. Firma fija: "Actidea Continnuo · Eventos que conectan\\ncontacto@actideacontinnuo.com"
7. Máximo 160 palabras

JSON exacto: {"asunto":"...","cuerpo":"..."}`,
        }],
      }),
    });
    const data = await resp.json();
    const raw  = data.content?.[0]?.text || '{}';
    const clean = raw.replace(/```json|```/g, '').trim();
    res.json(JSON.parse(clean));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Arma el texto de la nota que documenta el origen del lead
function _notaOrigen(lead) {
  const parts = [];
  if (lead.sectorTitle || lead.sector) parts.push(`Sector: ${lead.sectorTitle || lead.sector}`);
  if (lead.city)       parts.push(`Ciudad: ${lead.city}`);
  if (lead.linkedin)   parts.push(`LinkedIn: ${lead.linkedin}`);
  if (lead.confidence) parts.push(`Confianza IA: ${lead.confidence}/10`);
  if (lead.verified)   parts.push('Verificado por Claude');
  if (lead.verificationNotes) parts.push(`Nota: ${lead.verificationNotes}`);
  parts.push(`Prospectado: ${new Date().toISOString().split('T')[0]}`);
  return parts.join(' · ').slice(0, 1990);
}

// POST /api/prospeccion/notion/upload  →  crea cada lead como Prospecto REAL de
// la CRM (misma base "Prospectos", mismo esquema/roles que un alta manual) —
// usa exactamente las mismas reglas de comisión (Fuente="Apollo") que ya aplica
// POST /api/prospectos, para que no queden registros con roles/notas mal formados.
router.post('/notion/upload', async (req, res) => {
  const { leads = [] } = req.body;
  const created = [];
  const errors  = [];
  // Una sola lectura del roster para todo el lote (se cachea igual, pero evita
  // N llamadas redundantes cuando se suben muchos leads de golpe).
  const ejecutivosRoster = await obtenerRosterEjecutivos();

  for (const lead of leads) {
    try {
      const data = {
        empresa:  lead.company || '',
        contacto: lead.name || '',
        cargo:    lead.title || '',
        tel:      lead.phone || '',
        email:    lead.email || '',
        fuente:   'Apollo',
        status:   'Nuevo',
        notas:    [{ texto: _notaOrigen(lead), fecha: new Date().toISOString() }],
      };
      const r = aplicarReglasComision(data, { esApollo: true, ejecutivosRoster });
      data.propietario  = r.propietario;
      data.ejecCuenta   = r.ejecCuenta;
      data.ejecAsignado = r.ejecAsignado;
      data.comision     = r.comision;

      const props = {
        'Empresa':      prop_title(data.empresa),
        'Contacto':     prop_text(data.contacto),
        'Cargo':        prop_text(data.cargo),
        'Telefono':     prop_phone(data.tel),
        'Email':        prop_email(data.email),
        'Fuente':       prop_select(data.fuente),
        'Status':       prop_select(data.status),
        'Notas':        prop_text(JSON.stringify(data.notas).substring(0, 1990)),
        'Propietario':  prop_select(data.propietario),
        'EjecutivoCuenta':   prop_select(data.ejecCuenta),
        'EjecutivoAsignado': prop_select(data.ejecAsignado),
        'Comision':     prop_number(data.comision),
      };
      const page = await createPage('prospectos', props);
      created.push({ leadId: lead.id, notionPageId: page.id });
    } catch (err) {
      errors.push({ leadId: lead.id, error: err.message });
    }
  }

  res.json({ created: created.length, errors, total: leads.length });
});

module.exports = router;
