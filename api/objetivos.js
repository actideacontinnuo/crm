const express = require('express');
const router  = express.Router();
const { authMiddleware } = require('../middleware/auth');
const { queryDB, createPage, updatePage, prop_title, prop_number, prop_text, read_number, read_text } = require('./notion');

// Objetivos ANUALES de Actidea en 3 CAPAS — un solo registro por año (no por
// mes). Dirección los captura/revisa cuando quiere (típicamente enero y a
// medio año), pero el número siempre representa la meta del AÑO COMPLETO.
// El Dashboard y Comercial/Reportes dividen ese anual entre 12 (mensual) o
// entre 4 (trimestral) para comparar contra lo real de cada periodo.
//
//   CAPA 1 · EMPRESA (qué quiere lograr Actidea) → KPIs del Dashboard
//     metaVentas      → KPI "Ventas Ejecutadas" + línea Meta de la gráfica (ANUAL)
//     metaProduccion  → KPI "OPs Activas" (no se divide: es un estado actual)
//     metaPipeline    → KPI "Pipeline Prospectos"
//     metaClientes    → KPI "Clientes Activos" (no se divide: es un estado actual)
//
//   CAPA 2 · DIRECCIÓN / NATALIA (que el negocio funcione) → KPIs del Dashboard
//     metaUtilidad    → KPI "Utilidad Generada" (ANUAL)
//     metaCobranza    → KPI "Cobranza Pendiente" (ANUAL)
//
//   CAPA 3 · INDIVIDUALES (cada ejecutiva contribuye a la empresa) → Comercial/Reportes
//     objetivoEjecutivo   → objetivo ANUAL por defecto para quien no tenga uno propio
//     objetivosIndividuales → { "Ximena": 18000000, "Alexia": 12000000, ... } (JSON, ANUAL)
function toObj(page) {
  const p = page.properties;
  let individuales = {};
  try { individuales = JSON.parse(read_text(p['ObjetivosIndividuales']) || '{}') || {}; }
  catch { individuales = {}; }
  if (typeof individuales !== 'object' || Array.isArray(individuales)) individuales = {};
  return {
    pageId:            page.id,
    // Capa 1 — Empresa
    metaVentas:        read_number(p['Cotizado']),
    metaProduccion:    read_number(p['OpsActivas']),
    metaPipeline:      read_number(p['Pipeline']),
    metaClientes:      read_number(p['ClientesActivos']),
    // Capa 2 — Dirección
    metaUtilidad:      read_number(p['MetaUtilidad']),
    metaCobranza:      read_number(p['MetaCobranza']),
    // Capa 3 — Individuales
    objetivoEjecutivo:     read_number(p['ObjetivoEjecutivo']),
    objetivosIndividuales: individuales,
  };
}

// Campos numéricos simples → columna de Notion
const CAMPOS_NUM = {
  metaVentas:        'Cotizado',
  metaProduccion:    'OpsActivas',
  metaPipeline:      'Pipeline',
  metaClientes:      'ClientesActivos',
  metaUtilidad:      'MetaUtilidad',
  metaCobranza:      'MetaCobranza',
  objetivoEjecutivo: 'ObjetivoEjecutivo',
};

// El periodo de un objetivo es SIEMPRE un año completo: "2026". Se guarda en
// la misma columna Notion 'Mes' (título) que antes usaba "YYYY-MM" — solo
// cambia el formato validado, no el esquema.
function validarPeriodo(periodo) { return /^\d{4}$/.test(periodo); }

// GET /api/objetivos/:anio — cualquier usuario autenticado puede VER las metas
router.get('/:anio', authMiddleware, async (req, res) => {
  if (!validarPeriodo(req.params.anio)) return res.status(400).json({ error: 'Año inválido. Formato: YYYY' });
  try {
    const pages = await queryDB('objetivos', { property: 'Mes', title: { equals: req.params.anio } });
    res.json(pages.length ? toObj(pages[0]) : {});
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/objetivos/:anio — solo el Admin (Dirección) define los objetivos
router.put('/:anio', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Solo el Admin puede modificar los objetivos' });
  if (!validarPeriodo(req.params.anio)) return res.status(400).json({ error: 'Año inválido. Formato: YYYY' });
  try {
    const props = {};
    for (const [campo, columna] of Object.entries(CAMPOS_NUM)) {
      if (req.body[campo] === undefined) continue;
      const n = Number(req.body[campo]);
      if (isNaN(n) || n < 0) return res.status(400).json({ error: `El campo ${campo} debe ser un número positivo` });
      props[columna] = prop_number(n);
    }
    // Capa 3 — objetivos individuales por ejecutiva (objeto nombre→monto)
    if (req.body.objetivosIndividuales !== undefined) {
      const oi = req.body.objetivosIndividuales;
      if (typeof oi !== 'object' || oi === null || Array.isArray(oi)) {
        return res.status(400).json({ error: 'objetivosIndividuales debe ser un objeto { nombre: monto }' });
      }
      const limpio = {};
      for (const [nombre, monto] of Object.entries(oi)) {
        const n = Number(monto);
        if (isNaN(n) || n < 0) return res.status(400).json({ error: `El objetivo de ${nombre} debe ser un número positivo` });
        if (n > 0) limpio[nombre] = n;
      }
      props['ObjetivosIndividuales'] = prop_text(JSON.stringify(limpio));
    }

    const pages = await queryDB('objetivos', { property: 'Mes', title: { equals: req.params.anio } });
    let page;
    if (pages.length) {
      page = await updatePage(pages[0].id, props);
    } else {
      page = await createPage('objetivos', { 'Mes': prop_title(req.params.anio), ...props });
    }
    res.json({ ok: true, anio: req.params.anio, objetivos: toObj(page) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
