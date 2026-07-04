const express = require('express');
const router  = express.Router();
const { authMiddleware } = require('../middleware/auth');
const { queryDB, createPage, updatePage, prop_title, prop_number, read_number } = require('./notion');

// Objetivos mensuales de Actidea — cada campo alimenta una meta visible:
//   metaVentas        → barra META del KPI "Ventas Ejecutadas" y línea Meta de la gráfica (Dashboard)
//   metaProduccion    → barra META del KPI "OPs Activas" (Dashboard)
//   metaPipeline      → barra META del KPI "Pipeline Prospectos" (Dashboard)
//   metaClientes      → barra META del KPI "Clientes Activos" (Dashboard)
//   objetivoEjecutivo → columna Objetivo y % de Cumplimiento (Comercial/Reportes)
function toObj(page) {
  const p = page.properties;
  return {
    pageId:            page.id,
    metaVentas:        read_number(p['Cotizado']),
    metaProduccion:    read_number(p['OpsActivas']),
    metaPipeline:      read_number(p['Pipeline']),
    metaClientes:      read_number(p['ClientesActivos']),
    objetivoEjecutivo: read_number(p['ObjetivoEjecutivo']),
  };
}

const CAMPOS = {
  metaVentas:        'Cotizado',
  metaProduccion:    'OpsActivas',
  metaPipeline:      'Pipeline',
  metaClientes:      'ClientesActivos',
  objetivoEjecutivo: 'ObjetivoEjecutivo',
};

function validarMes(mes) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(mes); }

// GET /api/objetivos/:mes — cualquier usuario autenticado puede VER las metas
// (los ejecutivos las necesitan para sus barras de META en el dashboard)
router.get('/:mes', authMiddleware, async (req, res) => {
  if (!validarMes(req.params.mes)) return res.status(400).json({ error: 'Mes inválido. Formato: YYYY-MM' });
  try {
    const pages = await queryDB('objetivos', { property: 'Mes', title: { equals: req.params.mes } });
    res.json(pages.length ? toObj(pages[0]) : {});
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/objetivos/:mes — solo el Admin puede modificar los objetivos
router.put('/:mes', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Solo el Admin puede modificar los objetivos' });
  if (!validarMes(req.params.mes)) return res.status(400).json({ error: 'Mes inválido. Formato: YYYY-MM' });
  try {
    const props = {};
    for (const [campo, columna] of Object.entries(CAMPOS)) {
      if (req.body[campo] === undefined) continue;
      const n = Number(req.body[campo]);
      if (isNaN(n) || n < 0) return res.status(400).json({ error: `El campo ${campo} debe ser un número positivo` });
      props[columna] = prop_number(n);
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
