const express = require('express');
const router  = express.Router();
const { authMiddleware } = require('../middleware/auth');
const { queryDB, createPage, updatePage, prop_title, prop_number, prop_text, read_number, read_text } = require('./notion');

// Objetivos mensuales de Actidea en 3 CAPAS:
//
//   CAPA 1 · EMPRESA (qué quiere lograr Actidea) → KPIs del Dashboard
//     metaVentas      → KPI "Ventas Ejecutadas" + línea Meta de la gráfica
//     metaProduccion  → KPI "OPs Activas"
//     metaPipeline    → KPI "Pipeline Prospectos"
//     metaClientes    → KPI "Clientes Activos"
//
//   CAPA 2 · DIRECCIÓN / NATALIA (que el negocio funcione) → KPIs del Dashboard
//     metaUtilidad    → KPI "Utilidad Generada"
//     metaCobranza    → KPI "Cobranza Pendiente" (objetivo de cobro del mes)
//
//   CAPA 3 · INDIVIDUALES (cada ejecutiva contribuye a la empresa) → Comercial/Reportes
//     objetivoEjecutivo   → objetivo por defecto para quien no tenga uno propio
//     objetivosIndividuales → { "Ximena": 1500000, "Alexia": 1000000, ... } (JSON)
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

function validarMes(mes) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(mes); }

// GET /api/objetivos/:mes — cualquier usuario autenticado puede VER las metas
router.get('/:mes', authMiddleware, async (req, res) => {
  if (!validarMes(req.params.mes)) return res.status(400).json({ error: 'Mes inválido. Formato: YYYY-MM' });
  try {
    const pages = await queryDB('objetivos', { property: 'Mes', title: { equals: req.params.mes } });
    res.json(pages.length ? toObj(pages[0]) : {});
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/objetivos/:mes — solo el Admin (Dirección) define los objetivos
router.put('/:mes', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Solo el Admin puede modificar los objetivos' });
  if (!validarMes(req.params.mes)) return res.status(400).json({ error: 'Mes inválido. Formato: YYYY-MM' });
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

    const pages = await queryDB('objetivos', { property: 'Mes', title: { equals: req.params.mes } });
    let page;
    if (pages.length) {
      page = await updatePage(pages[0].id, props);
    } else {
      page = await createPage('objetivos', { 'Mes': prop_title(req.params.mes), ...props });
    }
    res.json({ ok: true, mes: req.params.mes, objetivos: toObj(page) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
