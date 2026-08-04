// Helpers de control de acceso por registro (row-level) — compartidos entre routers.
//
// Modelo de 3 roles (prospectos, clientes, ops, cotizaciones): Propietario,
// Ejecutivo de cuenta, Ejecutivo asignado (+ 'Ejecutivo' legado para registros
// muy viejos). req.rolFilter (identidad del usuario) se setea para roles
// 'ejecutivo' y 'administracion' no-oficina-total; el admin y Oscar ven todo.

const { PROPIETARIOS_ESPECIALES } = require('./_roles');

// "Oficina total": ve y EDITA todos los registros como Dirección, pero NO elimina
// (salvo el admin). Son: el admin (Natalia) y el personal de administración que
// NO es propietario especial (Oscar). Eduardo/Alfredo son 'administracion' pero
// propietarios especiales, así que conservan acceso por fila (solo lo suyo).
function esOficinaTotal(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.role !== 'administracion') return false;
  const ident = user.ejec || user.nombre || '';
  return !PROPIETARIOS_ESPECIALES.includes(ident) && !PROPIETARIOS_ESPECIALES.includes(user.nombre);
}

// Identidad para el filtro por fila (row-level). Los ejecutivos traen 'ejec';
// los administracion-especiales traen su nombre como identidad de propietario.
function identidadRol(user) {
  return user?.ejec || user?.nombre || null;
}

// ── Modelo de 3 roles comerciales ──────────────────────────
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
  esOficinaTotal, identidadRol,
  filtroRolesNotion, perteneceAlRegistro, assertRolAccess,
};
