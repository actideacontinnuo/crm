/**
 * Unit tests — Autenticación de dos pasos (api/_twofa.js)
 * Usa otplib real: genera códigos TOTP válidos y verifica el ciclo completo.
 */
const { authenticator } = require('otplib');
const { generateSecret, generateOtpUri, generateQrDataUrl, verifyToken } = require('../../api/_twofa');

describe('generateSecret', () => {
  test('genera secretos base32 no vacíos y distintos entre sí', () => {
    const a = generateSecret();
    const b = generateSecret();
    expect(a.length).toBeGreaterThanOrEqual(16);
    expect(a).not.toBe(b);
  });
});

describe('generateOtpUri', () => {
  test('incluye el emisor "Actidea CRM" y el usuario', () => {
    const uri = generateOtpUri('SECRETBASE32XXXX', 'natalia');
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain('natalia');
    expect(uri).toContain(encodeURIComponent('Actidea CRM'));
  });
});

describe('generateQrDataUrl', () => {
  test('devuelve un data URL de imagen PNG', async () => {
    const uri = generateOtpUri(generateSecret(), 'natalia');
    const qr  = await generateQrDataUrl(uri);
    expect(qr).toMatch(/^data:image\/png;base64,/);
  });
});

describe('verifyToken', () => {
  test('acepta un código TOTP recién generado con el mismo secreto', () => {
    const secret = generateSecret();
    const code   = authenticator.generate(secret);
    expect(verifyToken(code, secret)).toBe(true);
  });

  test('acepta el código con espacios alrededor (trim)', () => {
    const secret = generateSecret();
    const code   = authenticator.generate(secret);
    expect(verifyToken(`  ${code}  `, secret)).toBe(true);
  });

  test('rechaza un código incorrecto', () => {
    const secret = generateSecret();
    expect(verifyToken('000000', secret)).toBe(false);
  });

  test('rechaza si falta el código o el secreto', () => {
    expect(verifyToken(null, 'SECRET')).toBe(false);
    expect(verifyToken('123456', null)).toBe(false);
    expect(verifyToken('', '')).toBe(false);
  });

  test('un secreto corrupto no lanza excepción, solo devuelve false', () => {
    expect(verifyToken('123456', '!!no-es-base32!!')).toBe(false);
  });
});
