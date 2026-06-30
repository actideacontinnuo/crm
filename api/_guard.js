// Helpers de control de acceso por dueño (ejecutivo) — compartidos entre routers
// req.ejecFilter solo viene seteado cuando el usuario autenticado es role:'ejecutivo' (ver server.js)

// Bloquea acceso a un registro que no pertenece al ejecutivo autenticado
function assertOwnership(req, res, recordEjec) {
  if (req.ejecFilter && recordEjec !== req.ejecFilter) {
    res.status(403).json({ error: 'No tienes permiso para ver o modificar este registro' });
    return false;
  }
  return true;
}

// Al crear: si es ejecutivo, su nombre se impone siempre — ignora lo que mande el cliente
function forceOwnerOnCreate(req, data) {
  if (req.ejecFilter) data.ejec = req.ejecFilter;
  return data;
}

module.exports = { assertOwnership, forceOwnerOnCreate };
