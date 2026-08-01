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
//
// Regla de arquitectura (confirmada): el Propietario de la cuenta (quien la
// trajo) es SIEMPRE el mismo que el Ejecutivo de cuenta (quien la atiende) —
// EXCEPTO Eduardo Gama y Alfredo, que son socios/externos, nunca ejecutivos:
// para ellos el ejec. de cuenta se sigue forzando a Natalia (Regla 3, 7.5%).
// El Ejecutivo ASIGNADO (quien lleva el evento) es el único que varía libre.
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

  // Regla 3 — Propietario es Eduardo Gama o Alfredo (excepción confirmada,
  // nunca son ejecutivos) → ejec. de cuenta se fuerza a Natalia, 7.5%.
  if (out.propietario && PROPIETARIOS_ESPECIALES.includes(out.propietario)) {
    out.ejecCuenta = NATALIA;
    out.comision   = 7.5;
    out.regla      = 3;
    return out;
  }

  // Regla 2 — Caso normal: el propietario de la cuenta ES el ejecutivo de
  // cuenta. Se FUERZA aquí (no se deja como selección independiente) — evita
  // que quede una combinación inconsistente. Comisión fija 15%.
  if (out.propietario && PERSONAS_EJECUTIVO.includes(out.propietario)) {
    out.ejecCuenta = out.propietario;
    out.comision   = 15;
    out.regla      = 2;
    return out;
  }

  // Regla 4 — Sin propietario asignado todavía (p. ej. prospecto recién
  // creado): nada que imponer aún, comisión no gestionada por el sistema.
  out.comision = null;
  out.regla    = 4;
  return out;
}

module.exports = { PERSONAS, PERSONAS_PROPIETARIO, PERSONAS_EJECUTIVO, NATALIA, PROPIETARIOS_ESPECIALES, aplicarReglasComision };
