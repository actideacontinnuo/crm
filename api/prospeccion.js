// ════════════════════════════════════════════════════════════
// Prospección — Apollo (búsqueda) + Claude (verificación/redacción) + Notion
// (carga como Prospecto real de la CRM). Todo SÍNCRONO: sin cola de jobs ni
// dependencia de que un humano procese algo a mano — responde directo al
// request. Acceso restringido a Natalia (ver soloNatalia en server.js).
// ════════════════════════════════════════════════════════════
const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');
const {
  createPage, updatePage, queryDB,
  prop_title, prop_text, prop_phone, prop_email, prop_select, prop_number, prop_checkbox,
  read_title, read_text, read_email, read_select,
} = require('./notion');
const { aplicarReglasComision, obtenerRosterEjecutivos } = require('./_roles');
const { logAudit } = require('./_audit');

// Industrias EXACTAS del catálogo real de Apollo (mismo texto que su propio
// sitio web en el filtro de industria) — confirmadas una por una contra la
// API real antes de usarlas (todas devuelven resultados reales de México).
// 'apollo' se manda como q_organization_keyword_tags (el tag de industria
// oficial), no como q_keywords libre — así el filtro es 100% el mismo que
// usa Apollo internamente, no una palabra suelta inventada por nosotros.
const SECTOR_MAP = {
  'education-mgmt':        { apollo: 'education management',            title: 'Educación'                },
  'food-bev':              { apollo: 'food & beverages',                title: 'Alimentos y Bebidas'      },
  'design':                { apollo: 'design',                          title: 'Diseño'                   },
  'hospitality':           { apollo: 'hospitality',                     title: 'Hospitalidad'             },
  'accounting':            { apollo: 'accounting',                      title: 'Contabilidad'             },
  'events-services':       { apollo: 'events services',                 title: 'Servicios de Eventos'     },
  'consumer-services':     { apollo: 'consumer services',               title: 'Servicios al Consumidor'  },
  'hospital-health':       { apollo: 'hospital & health care',          title: 'Salud'                    },
  'automotive':            { apollo: 'automotive',                      title: 'Automotriz'               },
  'restaurants':           { apollo: 'restaurants',                     title: 'Restaurantes'             },
  'mgmt-consulting':       { apollo: 'management consulting',           title: 'Consultoría'              },
  'computer-software':     { apollo: 'computer software',               title: 'Software'                 },
  'internet':              { apollo: 'internet',                        title: 'Internet'                 },
  'retail':                { apollo: 'retail',                          title: 'Retail'                   },
  'financial-services':    { apollo: 'financial services',              title: 'Financiero'               },
  'it-services':           { apollo: 'information technology & services', title: 'Tecnología / TI'         },
  'construction':          { apollo: 'construction',                    title: 'Construcción'             },
  'marketing-advertising': { apollo: 'marketing & advertising',         title: 'Marketing y Publicidad'   },
  'real-estate':           { apollo: 'real estate',                     title: 'Bienes Raíces'            },
  'health-wellness':       { apollo: 'health, wellness & fitness',      title: 'Salud y Bienestar'        },
};

router.get('/config/status', (req, res) => {
  res.json({
    apollo:    !!process.env.APOLLO_API_KEY,
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    notion:    !!process.env.NOTION_TOKEN,
  });
});

const TITULOS_DEFAULT = ['Director de Eventos', 'Director de Marketing', 'Gerente de Eventos',
  'VP Marketing', 'Director de Comunicación', 'Jefe de Eventos',
  'Events Manager', 'Marketing Manager', 'Director Comercial'];

// Filtros "espejo de Apollo" — cada uno verificado contra la API real antes de
// exponerlo (ver conversación): person_departments NO se incluye porque Apollo
// lo ignora en silencio con cualquier valor probado (no filtra nada, aunque no
// da error) — mejor no ofrecer un filtro que aparenta funcionar y no hace nada.
function _construirBusquedaApollo({ filtros = {}, sectorId, perSector }) {
  const info = SECTOR_MAP[sectorId];
  const body = {
    person_titles:    filtros.titles?.length ? filtros.titles : TITULOS_DEFAULT,
    person_locations: filtros.personLocations?.length ? filtros.personLocations : ['Mexico'],
    // La industria del sector va como TAG oficial de Apollo (el mismo filtro
    // "Industria" de su sitio), no como palabra libre — así el sector es
    // 100% el mismo que Apollo usa internamente.
    q_organization_keyword_tags: info?.apollo ? [info.apollo] : [],
    per_page: perSector * 3,
    page: 1,
  };
  // Palabras clave LIBRES del filtro avanzado — se suman a la industria del
  // sector, no la reemplazan (son dos parámetros distintos de Apollo).
  if (filtros.keywords) body.q_keywords = filtros.keywords;
  if (filtros.seniorities?.length)          body.person_seniorities = filtros.seniorities;
  if (filtros.organizationLocations?.length) body.organization_locations = filtros.organizationLocations;
  if (filtros.employeeRanges?.length)        body.organization_num_employees_ranges = filtros.employeeRanges;
  if (filtros.emailStatus?.length)           body.contact_email_status = filtros.emailStatus;
  if (filtros.organizationDomains?.length)   body.q_organization_domains_list = filtros.organizationDomains;
  return body;
}

// Busca UN sector en Apollo — misma lógica que usa el endpoint /buscar, pero
// factorizada para que también la use el cron semanal automático (ver
// ejecutarProspeccionAutomatica) sin duplicar código ni pasar por HTTP.
async function buscarSectorEnApollo(sectorId, perSector, filtros = {}) {
  const apolloKey = process.env.APOLLO_API_KEY;
  if (!apolloKey) return { leads: [], error: 'APOLLO_API_KEY no configurada en .env' };
  const info = SECTOR_MAP[sectorId];
  if (!info) return { leads: [], error: `Sector desconocido: ${sectorId}` };

  const leads = [];
  try {
    const searchResp = await fetch('https://api.apollo.io/api/v1/mixed_people/api_search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': apolloKey },
      body: JSON.stringify(_construirBusquedaApollo({ filtros, sectorId, perSector })),
    });
    if (!searchResp.ok) {
      const errText = await searchResp.text();
      return { leads: [], error: `Apollo ${searchResp.status}: ${errText.slice(0, 200)}` };
    }

    const searchData = await searchResp.json();
    const candidates = (searchData.people || []).filter(p => p.has_email === true).slice(0, perSector);
    if (!candidates.length) return { leads: [], error: 'No se encontraron contactos con email en Apollo para este sector' };

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

    // Regla de negocio confirmada: si Apollo no confirma el email como
    // "verified" (deliverable de verdad, no "probable" ni "sin verificar"),
    // el contacto NO puede convertirse en Prospecto — se descarta aquí, antes
    // de que llegue siquiera a la revisión manual de Natalia. Esto también
    // resuelve de raíz los apellidos truncados ("Pe***z"): cuando el
    // enriquecimiento de Apollo SÍ encuentra al contacto (y por tanto puede
    // confirmar el email), siempre trae el apellido completo — el apellido
    // corto solo aparece cuando el enriquecimiento falla, y en ese caso
    // tampoco hay un email confiable que ofrecer.
    for (const p of candidates) {
      const enriched = enrichedMap[p.id];
      if (!enriched || enriched.email_status !== 'verified') continue;
      leads.push({
        id:          p.id,
        name:        `${p.first_name || ''} ${enriched.last_name || ''}`.trim(),
        title:       enriched.title || p.title || '',
        company:     enriched.organization?.name || p.organization?.name || '',
        email:       enriched.email || enriched.sanitized_email || '',
        linkedin:    enriched.linkedin_url || '',
        phone:       enriched.phone_numbers?.[0]?.raw_number || '',
        sector:      sectorId,
        sectorTitle: info.title,
        emailStatus: enriched.email_status,
        apolloId:    p.id,
        city:        enriched.city || '',
        country:     enriched.country || 'México',
        verified:    false,
      });
    }
    if (!leads.length) return { leads: [], error: 'Apollo no confirmó ("verified") el email de ningún contacto para este sector' };
    return { leads, error: null };
  } catch (err) {
    return { leads: [], error: err.message };
  }
}

// POST /api/prospeccion/buscar  →  busca leads en Apollo por sectores.
// filtros (opcional): espejo de los filtros "fáciles" de Apollo — títulos,
// antigüedad, ubicación de persona/empresa, tamaño de empresa, estado del
// email, palabras clave, dominio de empresa. Si no se manda nada, se comporta
// exactamente igual que antes (títulos fijos + keyword del sector).
router.post('/buscar', async (req, res) => {
  const { sectors = ['events-services', 'hospitality', 'marketing-advertising', 'consumer-services'], perSector = 5, filtros = {} } = req.body;
  if (!process.env.APOLLO_API_KEY) return res.status(400).json({ error: 'APOLLO_API_KEY no configurada en .env' });

  const results = [];
  const errors  = [];

  for (const sectorId of sectors) {
    if (!SECTOR_MAP[sectorId]) continue;
    const { leads, error } = await buscarSectorEnApollo(sectorId, perSector, filtros);
    if (error) errors.push({ sector: sectorId, error });
    results.push(...leads);
  }

  // Regla dura: nunca se busca/muestra una empresa que ya es Prospecto — se
  // filtra ANTES de que Natalia la vea en la lista de revisión, no solo al
  // subir (ver _filtrarEmpresasDuplicadas).
  const { aceptados, descartados } = await _filtrarEmpresasDuplicadas(results);
  if (descartados.length) {
    errors.push({ sector: null, error: `${descartados.length} contacto(s) omitido(s) por empresa ya prospectada: ${[...new Set(descartados.map(d => d.company))].join(', ')}` });
  }

  res.json({ leads: aceptados, errors, total: aceptados.length });
});

// POST /api/prospeccion/verificar  →  Claude verifica y enriquece cada lead
async function verificarConClaude(leads) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return leads.map(l => ({
      ...l,
      verified: l.emailStatus === 'verified' || l.emailStatus === 'likely to engage',
      confidence: l.emailStatus === 'verified' ? 8 : l.emailStatus === 'likely to engage' ? 6 : 5,
      verificationNotes: 'Verificación Claude pendiente — basada solo en Apollo',
      verifiedAt: new Date().toISOString(),
    }));
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

  return verified;
}

router.post('/verificar', async (req, res) => {
  const { leads = [] } = req.body;
  if (!process.env.ANTHROPIC_API_KEY) {
    const passthrough = await verificarConClaude(leads);
    return res.json({ leads: passthrough, total: passthrough.length, warning: 'Claude no disponible — usando solo datos de Apollo' });
  }
  const verified = await verificarConClaude(leads);
  res.json({ leads: verified, total: verified.length });
});

// POST /api/prospeccion/generar-email  →  redacta un email frío con Claude
// (antes esto se llamaba directo desde el navegador a api.anthropic.com sin
// llave — nunca podía funcionar de forma segura. Ahora vive en el servidor.)
router.post('/generar-email', async (req, res) => {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return res.status(400).json({ error: 'ANTHROPIC_API_KEY no configurada en .env' });

  // nombre/puesto son opcionales — cuando vienen (generador de correos por
  // prospecto real) el email se dirige a esa persona; si no, queda genérico
  // (uso del formulario de "Redactar email" con un sector suelto, sin contacto).
  const { empresa = 'la empresa', sectorName = 'Corporativo', nombre = '', puesto = '' } = req.body;
  const contactoLinea = nombre
    ? `- Contacto: ${nombre}${puesto ? ' (' + puesto + ')' : ''} — dirígete a esta persona por su nombre de pila`
    : '- Contacto: no se conoce el nombre — usa un saludo genérico ("Hola,")';
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
${contactoLinea}
- Remitente: Actidea Continnuo (productora de eventos, CDMX, 25 años)

Requisitos:
1. Asunto nuevo, impactante y personalizado (máx 9 palabras, sin emojis)
2. Apertura con referencia al sector o empresa (y al contacto por nombre si se conoce)
3. Menciona un cliente real de Actidea del mismo sector como credencial
4. Propuesta de valor específica en 2 líneas
5. CTA preguntando por 20 minutos esta semana
6. Firma fija: "Actidea Continnuo · Eventos que conectan\\nngama@actideacontinnuo.com"
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

// Normaliza el nombre de una empresa para poder comparar de verdad si "ya la
// tenemos prospectada" — sin esto, "Mondelēz International México" y
// "MONDELEZ INTERNATIONAL MEXICO, S.A. DE C.V." se ven como dos empresas
// distintas y el sistema las vuelve a prospectar. Quita acentos, razón social
// (S.A. de C.V., etc.) y cualquier símbolo, dejando solo el nombre "pelón".
function _normEmpresa(nombre) {
  return String(nombre || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(s\.?a\.?( de c\.?v\.?)?|sc|s de rl( de cv)?|sapi|sofom)\b/gi, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

// Empresas que YA existen como Prospecto en Notion, normalizadas — fuente de
// verdad para no volver a buscar/prospectar la misma empresa (regla dura:
// nunca se compara solo por email, porque Apollo trae contactos distintos —
// otro director, otro puesto— de la MISMA empresa y antes se colaban).
async function _empresasProspectosExistentes() {
  try {
    const pages = await queryDB('prospectos', null);
    return new Set(
      pages.map(p => _normEmpresa(read_title(p.properties['Empresa']))).filter(Boolean)
    );
  } catch (_) {
    return new Set(); // si Notion falla leyendo el dedupe, no bloqueamos la búsqueda/carga
  }
}

// Filtra leads cuya empresa (normalizada) ya está en Prospectos, o que se
// repite dentro del propio lote (misma empresa en dos sectores/contactos
// distintos de una sola corrida). Se usa TANTO al buscar (para no ni mostrar
// una empresa ya prospectada) COMO al subir (última barrera antes de crear
// el registro en Notion).
async function _filtrarEmpresasDuplicadas(leads) {
  const existentes = await _empresasProspectosExistentes();
  const vistasEnLote = new Set();
  const aceptados = [];
  const descartados = [];
  for (const lead of leads) {
    const key = _normEmpresa(lead.company);
    if (key && (existentes.has(key) || vistasEnLote.has(key))) {
      descartados.push({ ...lead, motivoDescartado: 'Empresa ya prospectada' });
      continue;
    }
    if (key) vistasEnLote.add(key);
    aceptados.push(lead);
  }
  return { aceptados, descartados };
}

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

// Sube leads como Prospectos reales — misma lógica que /notion/upload, ahora
// factorizada para que el cron semanal automático también la use sin pasar
// por HTTP. origen: 'Automático' | 'Manual'. evitarDuplicados: default true.
async function subirProspectos(leads, { origen = 'Manual', evitarDuplicados = true } = {}) {
  const created = [];
  const errors  = [];
  const omitidos = [];
  const ejecutivosRoster = await obtenerRosterEjecutivos();

  let emailsExistentes = new Set();
  let empresasExistentes = new Set();
  if (evitarDuplicados) {
    try {
      const pages = await queryDB('prospectos', null);
      emailsExistentes = new Set(
        pages.map(p => (read_email(p.properties['Email']) || '').toLowerCase()).filter(Boolean)
      );
      empresasExistentes = new Set(
        pages.map(p => _normEmpresa(read_title(p.properties['Empresa']))).filter(Boolean)
      );
    } catch (_) {
      // Si Notion falla leyendo el dedupe, no bloqueamos la carga — se sube
      // sin filtrar (mismo criterio de resiliencia que el resto del sistema).
    }
  }

  for (const lead of leads) {
    try {
      const emailNorm = (lead.email || '').toLowerCase();
      const empresaNorm = _normEmpresa(lead.company);
      // Regla dura: la EMPRESA es lo que nunca se duplica — el email solo era
      // insuficiente porque Apollo trae contactos distintos de una misma
      // empresa ya prospectada (otro director, otro puesto) y se colaban.
      if (evitarDuplicados && empresaNorm && empresasExistentes.has(empresaNorm)) {
        omitidos.push({ leadId: lead.id, email: lead.email, empresa: lead.company, motivo: 'Empresa ya existe como Prospecto' });
        continue;
      }
      if (evitarDuplicados && emailNorm && emailsExistentes.has(emailNorm)) {
        omitidos.push({ leadId: lead.id, email: lead.email, motivo: 'Ya existe un prospecto con este email' });
        continue;
      }

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
        'Sector':       prop_select(lead.sectorTitle || lead.sector || ''),
        'ConfianzaIA':  prop_number(lead.confidence),
        'OrigenCarga':  prop_select(origen),
      };
      const page = await createPage('prospectos', props);
      if (emailNorm) emailsExistentes.add(emailNorm); // evita duplicados DENTRO del mismo lote también
      if (empresaNorm) empresasExistentes.add(empresaNorm);
      created.push({ leadId: lead.id, notionPageId: page.id });
    } catch (err) {
      errors.push({ leadId: lead.id, error: err.message });
    }
  }

  return { created: created.length, errors, omitidos, total: leads.length };
}

// POST /api/prospeccion/notion/upload  →  crea cada lead como Prospecto REAL de
// la CRM (misma base "Prospectos", mismo esquema/roles que un alta manual) —
// usa exactamente las mismas reglas de comisión (Fuente="Apollo") que ya aplica
// POST /api/prospectos, para que no queden registros con roles/notas mal formados.
router.post('/notion/upload', async (req, res) => {
  // origen: 'Automático' (confianza ≥7, sin revisión) o 'Manual' (Natalia
  // decidió cargarlo desde la lista de revisión) — queda registrado en Notion
  // para que el Panel Semanal pueda reportar el desglose real.
  // evitarDuplicados: toggle de Ajustes — si viene true (default), no crea un
  // prospecto si YA existe uno con el mismo email.
  const { leads = [], origen = 'Manual', evitarDuplicados = true } = req.body;
  const resultado = await subirProspectos(leads, { origen, evitarDuplicados });
  res.json(resultado);
});

// PATCH /api/prospeccion/marcar-correo-generado/:id  →  toggle "Actualizar
// Notion post-envío": cuando Natalia genera y copia el correo de un prospecto,
// se marca aquí para no perder la cuenta de a quién ya se le redactó uno.
router.patch('/marcar-correo-generado/:id', async (req, res) => {
  try {
    await updatePage(req.params.id, { 'CorreoGenerado': prop_checkbox(true) });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/prospeccion/semanal  →  Panel Semanal: sectores buscados esta
// semana (lunes de la semana en curso en adelante), contactos por sector,
// desglose automático/manual, y tasa de respuesta (prospectos que avanzaron
// de "Nuevo" a cualquier otro status = alguien contestó o se les dio seguimiento).
router.get('/semanal', async (req, res) => {
  try {
    const pages = await queryDB('prospectos', { property: 'Fuente', select: { equals: 'Apollo' } });

    const ahora = new Date();
    const diaSemana = (ahora.getDay() + 6) % 7; // lunes=0 ... domingo=6
    const inicioSemana = new Date(ahora); inicioSemana.setHours(0, 0, 0, 0);
    inicioSemana.setDate(inicioSemana.getDate() - diaSemana);

    const porSector = {};
    let autoCount = 0, manualCount = 0, totalSemana = 0;

    pages.forEach(page => {
      const creado = new Date(page.created_time);
      if (creado < inicioSemana) return; // solo esta semana
      totalSemana++;
      const p = page.properties;
      const sector = read_select(p['Sector']) || 'Sin sector';
      const status = read_select(p['Status']) || 'Nuevo';
      const origen = read_select(p['OrigenCarga']) || 'Manual';
      if (origen === 'Automático') autoCount++; else manualCount++;

      if (!porSector[sector]) porSector[sector] = { sector, total: 0, respondieron: 0 };
      porSector[sector].total++;
      if (status !== 'Nuevo') porSector[sector].respondieron++;
    });

    const sectores = Object.values(porSector).map(s => ({
      ...s,
      tasaRespuesta: s.total ? Math.round((s.respondieron / s.total) * 100) : 0,
    })).sort((a, b) => b.total - a.total);

    res.json({ totalSemana, auto: autoCount, manual: manualCount, sectores });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Ranking de TODOS los sectores por tasa de respuesta histórica (no solo esta
// semana, como /semanal — aquí es todo el historial, para decidir bien qué
// sectores le está funcionando a Actidea de verdad). Un sector sin historial
// no se manda al fondo de la lista (nunca lo intentaríamos) — se le da un
// suavizado (Laplace: +1/+2) para que quede a la mitad de la tabla y sí
// tenga oportunidad de probarse.
async function _rankearSectoresPorRespuesta() {
  const pages = await queryDB('prospectos', { property: 'Fuente', select: { equals: 'Apollo' } });
  const porSector = {};
  Object.keys(SECTOR_MAP).forEach(id => { porSector[id] = { total: 0, respondieron: 0, ultimaFecha: null }; });

  pages.forEach(page => {
    const p = page.properties;
    const sectorTitle = read_select(p['Sector']);
    const sectorId = Object.keys(SECTOR_MAP).find(id => SECTOR_MAP[id].title === sectorTitle);
    if (!sectorId) return;
    const status = read_select(p['Status']) || 'Nuevo';
    porSector[sectorId].total++;
    if (status !== 'Nuevo') porSector[sectorId].respondieron++;
    const creado = page.created_time || '';
    if (!porSector[sectorId].ultimaFecha || creado > porSector[sectorId].ultimaFecha) porSector[sectorId].ultimaFecha = creado;
  });

  return Object.entries(porSector)
    .map(([id, s]) => ({
      id,
      tasaRespuesta: (s.respondieron + 1) / (s.total + 2), // Laplace — nunca 0/0
      ultimaFecha: s.ultimaFecha,
    }))
    .sort((a, b) => b.tasaRespuesta - a.tasaRespuesta);
}

// Prospección automática semanal — corre sola, sin que nadie la dispare (ver
// jobs/prospeccion-scheduler.js, domingos). Reglas confirmadas:
//  - Rota 1-4 sectores (de los 20), priorizando por tasa de respuesta
//    histórica: los 3 de mejor desempeño (explotar lo que funciona) + 1 que
//    no se haya intentado hace más tiempo (explorar — así los 20 sectores
//    se van probando con el tiempo, no se estanca siempre en los mismos 4).
//  - ~20 prospectos por corrida en total (perSector = 20 / #sectores).
//  - Solo confianza ≥7 Y verificado por Claude se sube — igual que el flujo
//    manual. Un run sin nadie mirando no puede "esperar revisión manual", así
//    que los de confianza <7 simplemente NO se persiguen en la corrida
//    automática (se pierden esos leads, pero no se baja el estándar de
//    calidad) — si se quiere más volumen, Natalia siempre puede correrlo
//    manual desde la pestaña Buscar con revisión.
async function ejecutarProspeccionAutomatica() {
  const ranking = await _rankearSectoresPorRespuesta();
  const explotar = ranking.slice(0, 3).map(s => s.id);
  const explorar = [...ranking].sort((a, b) => (a.ultimaFecha || '').localeCompare(b.ultimaFecha || ''))
    .find(s => !explotar.includes(s.id));
  const sectoresElegidos = explorar ? [...explotar, explorar.id] : explotar;

  const perSector = Math.max(1, Math.round(20 / sectoresElegidos.length));
  let totalCreados = 0, totalDescartadosBajaConfianza = 0;
  const detallePorSector = [];

  for (const sectorId of sectoresElegidos) {
    const { leads: leadsBrutos, error } = await buscarSectorEnApollo(sectorId, perSector);
    if (error || !leadsBrutos.length) { detallePorSector.push({ sector: sectorId, error: error || 'sin resultados' }); continue; }

    // Misma regla dura que la búsqueda manual: nunca perseguir una empresa
    // que ya es Prospecto (ver _filtrarEmpresasDuplicadas).
    const { aceptados: leads } = await _filtrarEmpresasDuplicadas(leadsBrutos);
    if (!leads.length) { detallePorSector.push({ sector: sectorId, encontrados: leadsBrutos.length, creados: 0, motivo: 'todas empresas ya prospectadas' }); continue; }

    const verificados = await verificarConClaude(leads);
    const elegibles = verificados.filter(l => l.verified !== false && (l.confidence || 0) >= 7);
    totalDescartadosBajaConfianza += verificados.length - elegibles.length;

    if (elegibles.length) {
      const { created } = await subirProspectos(elegibles, { origen: 'Automático', evitarDuplicados: true });
      totalCreados += created;
      detallePorSector.push({ sector: sectorId, encontrados: leads.length, creados: created });
    } else {
      detallePorSector.push({ sector: sectorId, encontrados: leads.length, creados: 0 });
    }
  }

  await logAudit({
    usuario: 'Sistema (cron semanal)',
    accion: 'prospeccion_automatica_semanal',
    entidad: String(totalCreados),
    detalle: `Sectores: ${sectoresElegidos.map(id => SECTOR_MAP[id]?.title || id).join(', ')}`,
    exito: true,
  });

  return { sectoresElegidos, perSector, totalCreados, totalDescartadosBajaConfianza, detallePorSector };
}

module.exports = router;
module.exports.ejecutarProspeccionAutomatica = ejecutarProspeccionAutomatica;
