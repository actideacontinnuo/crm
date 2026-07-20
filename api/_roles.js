// ════════════════════════════════════════════════════════════
// Roles comerciales y reglas de comisión — Brief v2 (14 jul 2026)
// Propietario / Ejecutivo de cuenta / Ejecutivo asignado + comisión.
// ════════════════════════════════════════════════════════════

// Rosters por rol:
//  - Propietario: todos menos Oscar (Eduardo y Alfredo SOLO entran como propietario)
//  - Ejecutivo de cuenta / asignado: solo ejecutivos reales (Natalia, Ximena, Alexia)
const PERSONAS_PROPIETARIO = ['Natalia Gama', 'Ximena', 'Alexia', 'Eduardo Gama', 'Alfredo'];
const PERSONAS_EJECUTIVO   = ['Natalia Gama', 'Ximena', 'Alexia'];
const PERSONAS = [...new Set([...PERSONAS_PROPIETARIO, ...PERSONAS_EJECUTIVO])];

const NATALIA = 'Natalia Gama';
// Regla 3 — propietarios especiales (Eduardo Gama y Alfredo; misma regla de negocio)
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

  // Apollo: Propietario = Natalia por default (si no se especificó otro). La comisión
  // se calcula con LAS MISMAS reglas que cualquier otra fuente (2, 3 o 4).
  if (esApollo && !out.propietario) out.propietario = NATALIA;

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

module.exports = { PERSONAS, PERSONAS_PROPIETARIO, PERSONAS_EJECUTIVO, NATALIA, PROPIETARIOS_ESPECIALES, aplicarReglasComision };
