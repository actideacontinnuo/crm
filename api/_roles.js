// ════════════════════════════════════════════════════════════
// Roles comerciales y reglas de comisión — Brief v2 (14 jul 2026)
// Propietario / Ejecutivo de cuenta / Ejecutivo asignado + comisión.
// ════════════════════════════════════════════════════════════

// Roster de personas asignables (identidad = nombre exacto usado también en login)
const PERSONAS = ['Natalia Gama', 'Ximena', 'Alexia', 'Eduardo Gama', 'Alfredo', 'Oscar'];

const NATALIA = 'Natalia Gama';
// Regla 3 — propietarios especiales (el brief los llama "Eduardo Gama" y "Alfie"=Alfredo)
const PROPIETARIOS_ESPECIALES = ['Eduardo Gama', 'Alfredo'];

// Calcula asignaciones automáticas y comisión FIJA al momento de la asignación.
// Devuelve los campos que el sistema debe imponer; los 'manual' se respetan tal cual vengan.
// esApollo: true si el prospecto entró por prospección automática de Apollo (Fuente = 'Apollo').
function aplicarReglasComision(data, { esApollo = false } = {}) {
  const out = {
    propietario:     data.propietario     || '',
    ejecCuenta:      data.ejecCuenta       || '',
    ejecAsignado:    data.ejecAsignado     || '',
    comision:        null,   // % de comisión; null = no gestionada por el sistema
    regla:           4,
  };

  // Regla 1 — Origen Apollo: propietario y ejec. de cuenta = Natalia (automático)
  if (esApollo) {
    out.propietario = NATALIA;
    out.ejecCuenta  = NATALIA;
    out.comision    = null;  // Natalia es dueña directa, sin % de terceros
    out.regla       = 1;
    return out;
  }

  // Regla 2 — Propietario == Ejecutivo de cuenta (mismo dueño) → 15% (prioridad sobre R3)
  if (out.propietario && out.ejecCuenta && out.propietario === out.ejecCuenta) {
    out.comision = 15;
    out.regla    = 2;
    return out;
  }

  // Regla 3 — Propietario es Eduardo Gama o Alfredo → ejec. de cuenta = Natalia, 7.5%
  if (out.propietario && PROPIETARIOS_ESPECIALES.includes(out.propietario)) {
    out.ejecCuenta = NATALIA;
    out.comision   = 7.5;
    out.regla      = 3;
    return out;
  }

  // Regla 4 — Caso general: todo manual, comisión no gestionada por el sistema
  out.comision = null;
  out.regla    = 4;
  return out;
}

module.exports = { PERSONAS, NATALIA, PROPIETARIOS_ESPECIALES, aplicarReglasComision };
