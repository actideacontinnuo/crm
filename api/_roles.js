// ════════════════════════════════════════════════════════════
// Roles comerciales y reglas de comisión — Brief v2 (14 jul 2026)
// Propietario / Ejecutivo de cuenta / Ejecutivo asignado + comisión.
// ════════════════════════════════════════════════════════════
const { queryDB, read_text, read_select, read_checkbox } = require('./notion');

// Roster de "ejecutivos reales" (quiénes pueden ser Ejec. de cuenta/asignado y
// ganan 15% como Propietario, Regla 2) — YA NO son nombres fijos: se leen de
// los usuarios del sistema con Rol=ejecutivo y Activo=sí, así que dar de alta
// un ejecutivo nuevo lo habilita solo, sin tocar código. Se cachea 60s para no
// pegarle a Notion en cada alta/edición; si Notion falla, se usa el último
// roster conocido y, en última instancia, este respaldo fijo.
const PERSONAS_EJECUTIVO_FALLBACK = ['Natalia Gama', 'Ximena', 'Alexia'];
const ROSTER_TTL_MS = 60 * 1000;
let _rosterCache = { list: null, expires: 0 };

async function obtenerRosterEjecutivos() {
  const ahora = Date.now();
  if (_rosterCache.list && ahora < _rosterCache.expires) return _rosterCache.list;
  try {
    // Rol 'ejecutivo' O 'admin' — Natalia es admin en el sistema pero
    // comercialmente cuenta como ejecutiva (Regla 2), igual que Ximena/Alexia.
    // Un futuro segundo admin que NO deba entrar aquí se excluye a mano —
    // no hay forma automática de distinguir "admin operativo" vs "admin comercial".
    const pages = await queryDB('usuarios', {
      and: [
        { or: [
            { property: 'Rol', select: { equals: 'ejecutivo' } },
            { property: 'Rol', select: { equals: 'admin' } },
          ] },
        { property: 'Activo', checkbox: { equals: true } },
      ],
    });
    const roster = pages
      .map(p => (read_text(p.properties['Ejecutivo']) || read_text(p.properties['Nombre']) || '').trim())
      .filter(Boolean);
    const unico = [...new Set(roster)];
    _rosterCache = { list: unico.length ? unico : PERSONAS_EJECUTIVO_FALLBACK, expires: ahora + ROSTER_TTL_MS };
    return _rosterCache.list;
  } catch (_) {
    // Notion falló: no rompemos comisiones/roles — se usa el último roster
    // conocido, o el respaldo fijo si nunca se pudo leer.
    return _rosterCache.list || PERSONAS_EJECUTIVO_FALLBACK;
  }
}

// Socios/externos — conceptos fijos, nunca son usuarios ejecutivos del sistema.
const PROPIETARIOS_ESPECIALES = ['Eduardo Gama', 'Alfredo'];
// Propietario "Externo": la cuenta la trajo alguien de fuera. No es ejecutivo
// ni socio — el % de comisión se captura A MANO (Dirección) y el ejec. de
// cuenta arranca en Natalia pero se puede cambiar.
const PROPIETARIO_EXTERNO = 'Externo';
// Roster de Propietario para referencia/fallback (el roster real y completo lo
// arma el frontend/caller combinando obtenerRosterEjecutivos() + estos fijos).
const PERSONAS_PROPIETARIO = [...PERSONAS_EJECUTIVO_FALLBACK, ...PROPIETARIOS_ESPECIALES, PROPIETARIO_EXTERNO];
const PERSONAS_EJECUTIVO   = PERSONAS_EJECUTIVO_FALLBACK; // respaldo estático, ver arriba
const PERSONAS = [...new Set([...PERSONAS_PROPIETARIO, ...PERSONAS_EJECUTIVO])];

const NATALIA = 'Natalia Gama';

// Calcula asignaciones automáticas y comisión FIJA al momento de la asignación.
// Devuelve los campos que el sistema debe imponer; los 'manual' se respetan tal cual vengan.
// esApollo: true si el prospecto entró por prospección automática de Apollo (Fuente = 'Apollo').
//
// Regla de arquitectura (confirmada): el Propietario de la cuenta (quien la
// trajo) es SIEMPRE el mismo que el Ejecutivo de cuenta (quien la atiende) —
// EXCEPTO Eduardo Gama y Alfredo, que son socios/externos, nunca ejecutivos:
// para ellos el ejec. de cuenta se sigue forzando a Natalia (Regla 3, 7.5%).
// El Ejecutivo ASIGNADO (quien lleva el evento) es el único que varía libre.
// ejecutivosRoster: array dinámico (de obtenerRosterEjecutivos(), ya resuelto
// por el caller con await) — quién es "ejecutivo real" para la Regla 2. Si no
// se pasa, se usa el respaldo fijo (mantiene la función pura/sync para tests).
function aplicarReglasComision(data, { esApollo = false, ejecutivosRoster } = {}) {
  const rosterEjecutivo = ejecutivosRoster || PERSONAS_EJECUTIVO_FALLBACK;
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

  // Regla 5 — Propietario "Externo": comisión MANUAL (la teclea Dirección en la
  // ficha del cliente; se respeta tal cual venga). El ejec. de cuenta arranca en
  // Natalia por default pero se puede cambiar (se respeta si viene otro).
  if (out.propietario === PROPIETARIO_EXTERNO) {
    out.ejecCuenta = out.ejecCuenta || NATALIA;
    out.comision   = (data.comision !== undefined && data.comision !== null && data.comision !== '')
      ? Number(data.comision) : null;
    out.regla      = 5;
    return out;
  }

  // Regla 3 — Propietario es Eduardo Gama o Alfredo (excepción confirmada,
  // nunca son ejecutivos) → ejec. de cuenta se fuerza a Natalia. Su 7.5% NO se
  // paga como comisión: se queda como utilidad de la empresa. Por eso la
  // comisión gestionada por el sistema es 0 (no hay payout que mostrar).
  if (out.propietario && PROPIETARIOS_ESPECIALES.includes(out.propietario)) {
    out.ejecCuenta = NATALIA;
    out.comision   = 0;
    out.regla      = 3;
    return out;
  }

  // Regla 2 — Caso normal: el propietario de la cuenta ES el ejecutivo de
  // cuenta. Se FUERZA aquí (no se deja como selección independiente) — evita
  // que quede una combinación inconsistente. Comisión fija 15%.
  if (out.propietario && rosterEjecutivo.includes(out.propietario)) {
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

// Solo para tests — limpia la caché de 60s para que un usuario ejecutivo
// recién agregado al store mock se refleje de inmediato en la siguiente
// llamada, sin esperar el TTL.
function _resetRosterCacheForTests() { _rosterCache = { list: null, expires: 0 }; }

module.exports = {
  PERSONAS, PERSONAS_PROPIETARIO, PERSONAS_EJECUTIVO, PERSONAS_EJECUTIVO_FALLBACK,
  NATALIA, PROPIETARIOS_ESPECIALES, PROPIETARIO_EXTERNO,
  aplicarReglasComision, obtenerRosterEjecutivos, _resetRosterCacheForTests,
};
