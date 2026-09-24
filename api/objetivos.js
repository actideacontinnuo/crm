const express = require('express');
const router  = express.Router();
const { authMiddleware } = require('../middleware/auth');
const { queryDB, createRow, updateRow } = require('./db');

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
function toObj(row) {
  let individuales = row.objetivosIndividuales;
  if (typeof individuales === 'string') { try { individuales = JSON.parse(individuales); } catch { individuales = {}; } }
  if (!individuales || typeof individuales !== 'object' || Array.isArray(individuales)) individuales = {};
  const n = v => Number(v) || 0;
  return {
    pageId:            row.id,
    // Capa 1 — Empresa
    metaVentas:        n(row.metaVentas),
    metaProduccion:    n(row.metaProduccion),
    metaPipeline:      n(row.metaPipeline),
    metaClientes:      n(row.metaClientes),
    // Capa 2 — Dirección
    metaUtilidad:      n(row.metaUtilidad),
    metaCobranza:      n(row.metaCobranza),
    // Capa 3 — Individuales
    objetivoEjecutivo:     n(row.objetivoEjecutivo),
    objetivosIndividuales: individuales,
  };
}

// Campos numéricos simples → columna de Postgres
const CAMPOS_NUM = {
  metaVentas:        'metaVentas',
  metaProduccion:    'metaProduccion',
  metaPipeline:      'metaPipeline',
  metaClientes:      'metaClientes',
  metaUtilidad:      'metaUtilidad',
  metaCobranza:      'metaCobranza',
  objetivoEjecutivo: 'objetivoEjecutivo',
};

// El periodo de un objetivo es SIEMPRE un año completo: "2026". Se guarda en la columna 'anio'.
function validarPeriodo(periodo) { return /^\d{4}$/.test(periodo); }

// GET /api/objetivos/:anio — cualquier usuario autenticado puede VER las metas
router.get('/:anio', authMiddleware, async (req, res) => {
  if (!validarPeriodo(req.params.anio)) return res.status(400).json({ error: 'Año inválido. Formato: YYYY' });
  try {
    const rows = await queryDB('objetivos', { anio: Number(req.params.anio) });
    res.json(rows.length ? toObj(rows[0]) : {});
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
      props[columna] = n;
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
      props.objetivosIndividuales = JSON.stringify(limpio);
    }

    const rows = await queryDB('objetivos', { anio: Number(req.params.anio) });
    const row = rows.length
      ? await updateRow('objetivos', rows[0].id, props)
      : await createRow('objetivos', { anio: Number(req.params.anio), ...props });
    res.json({ ok: true, anio: req.params.anio, objetivos: toObj(row) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
