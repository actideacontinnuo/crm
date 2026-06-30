// Política de contraseñas — mínimo 12 caracteres, mayúscula, minúscula, número y símbolo
function validatePasswordStrength(pw) {
  if (typeof pw !== 'string' || pw.length < 12) {
    return 'La contraseña debe tener al menos 12 caracteres';
  }
  if (!/[a-z]/.test(pw))  return 'La contraseña debe incluir al menos una letra minúscula';
  if (!/[A-Z]/.test(pw))  return 'La contraseña debe incluir al menos una letra MAYÚSCULA';
  if (!/[0-9]/.test(pw))  return 'La contraseña debe incluir al menos un número';
  if (!/[^A-Za-z0-9]/.test(pw)) return 'La contraseña debe incluir al menos un símbolo (!@#$%...)';
  return null; // válida
}

// Genera una contraseña temporal aleatoria que cumple la política, fácil de transcribir a mano
function generateStrongTempPassword() {
  const palabras = ['Sol','Luna','Mar','Rio','Vento','Cielo','Roca','Luz','Nube','Brisa'];
  const crypto = require('crypto');
  const a = palabras[crypto.randomInt(palabras.length)];
  const b = palabras[crypto.randomInt(palabras.length)];
  const n = crypto.randomInt(10000, 99999); // 5 dígitos: garantiza mínimo 12 caracteres en total
  const simbolos = ['!','@','#','$','%','&'];
  const s = simbolos[crypto.randomInt(simbolos.length)];
  return `${a}${b}${n}${s}`; // ej: SolLuna4821! — cumple longitud, mayúsc/minúsc/número/símbolo
}

module.exports = { validatePasswordStrength, generateStrongTempPassword };
