// Helpers de control de acceso por registro (row-level) — compartidos entre routers.
//
// Modelo LEGADO (ops, cotizaciones): un solo campo 'Ejecutivo'. req.ejecFilter se
//   setea para role:'ejecutivo' (ver server.js).
// Modelo NUEVO (prospectos, clientes): tres roles — Propietario, Ejecutivo de cuenta,
//   Ejecutivo asignado. req.rolFilter (identidad del usuario) se setea para roles
//   'ejecutivo' y 'administracion'; el admin (Natalia/Dirección) ve todo.

// ── Modelo legado (un solo dueño) ──────────────────────────
function assertOwnership(req, res, recordEjec) {
  if (req.ejecFilter && recordEjec !== req.ejecFilter) {
    res.status(403).json({ error: 'No tienes permiso para ver o modificar este registro' });
    return false;
  }
  return true;
}

function forceOwnerOnCreate(req, data) {
  if (req.ejecFilter) data.ejec = req.ejecFilter;
  return data;
}

// ── Modelo nuevo (3 roles comerciales) ─────────────────────
// Filtro de Notion: registros donde la identidad aparece en cualquiera de los 3 roles
// (o en el campo legado 'Ejecutivo', para registros creados antes de este módulo).
function filtroRolesNotion(ident) {
  return {
    or: [
      { property: 'Propietario',       select: { equals: ident } },
      { property: 'EjecutivoCuenta',   select: { equals: ident } },
      { property: 'EjecutivoAsignado', select: { equals: ident } },
      { property: 'Ejecutivo',         select: { equals: ident } },
    ],
  };
}

// ¿La identidad aparece en alguno de los 3 roles (o el legado) del objeto ya mapeado?
function perteneceAlRegistro(obj, ident) {
  return [obj.propietario, obj.ejecCuenta, obj.ejecAsignado, obj.ejec].includes(ident);
}

// Bloquea acceso a un registro donde el usuario no aparece en ningún rol
function assertRolAccess(req, res, obj) {
  if (req.rolFilter && !perteneceAlRegistro(obj, req.rolFilter)) {
    res.status(403).json({ error: 'No tienes permiso para ver o modificar este registro' });
    return false;
  }
  return true;
}

module.exports = {
  assertOwnership, forceOwnerOnCreate,
  filtroRolesNotion, perteneceAlRegistro, assertRolAccess,
};
