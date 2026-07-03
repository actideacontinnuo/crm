/**
 * Unit tests — Política de contraseñas y generador de temporales
 */
const { validatePasswordStrength, generateStrongTempPassword } = require('../../api/_password');

describe('validatePasswordStrength', () => {
  // Casos válidos
  test('contraseña válida pasa', () =>
    expect(validatePasswordStrength('SolLuna4821!')).toBeNull());
  test('14 caracteres complejos pasa', () =>
    expect(validatePasswordStrength('AbCdEfGh1234!@')).toBeNull());

  // Casos inválidos
  test('menos de 12 caracteres falla', () =>
    expect(validatePasswordStrength('Short1!')).toBeTruthy());
  test('exactamente 11 caracteres falla', () =>
    expect(validatePasswordStrength('Abcdefgh12!')).toBeTruthy());
  test('sin mayúscula falla', () =>
    expect(validatePasswordStrength('abcdefgh12!@')).toBeTruthy());
  test('sin minúscula falla', () =>
    expect(validatePasswordStrength('ABCDEFGH12!@')).toBeTruthy());
  test('sin número falla', () =>
    expect(validatePasswordStrength('Abcdefghij!@')).toBeTruthy());
  test('sin símbolo falla', () =>
    expect(validatePasswordStrength('Abcdefgh1234')).toBeTruthy());
  test('cadena vacía falla', () =>
    expect(validatePasswordStrength('')).toBeTruthy());
  test('null falla', () =>
    expect(validatePasswordStrength(null)).toBeTruthy());
  test('undefined falla', () =>
    expect(validatePasswordStrength(undefined)).toBeTruthy());
  test('número falla', () =>
    expect(validatePasswordStrength(12345678901)).toBeTruthy());
});

describe('generateStrongTempPassword', () => {
  test('genera una contraseña', () => {
    const pw = generateStrongTempPassword();
    expect(typeof pw).toBe('string');
    expect(pw.length).toBeGreaterThanOrEqual(12);
  });

  test('la contraseña generada pasa la política', () => {
    for (let i = 0; i < 20; i++) {
      const pw = generateStrongTempPassword();
      expect(validatePasswordStrength(pw)).toBeNull();
    }
  });

  test('genera valores diferentes en cada llamada (aleatoriedad)', () => {
    const set = new Set(Array.from({ length: 10 }, () => generateStrongTempPassword()));
    expect(set.size).toBeGreaterThan(1);
  });
});
