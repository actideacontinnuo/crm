const { authenticator } = require('otplib');
const QRCode = require('qrcode');

authenticator.options = { window: 1 }; // tolera 1 paso de 30s de diferencia de reloj

function generateSecret() {
  return authenticator.generateSecret();
}

function generateOtpUri(secret, usuarioId) {
  return authenticator.keyuri(usuarioId, 'Actidea CRM', secret);
}

async function generateQrDataUrl(otpUri) {
  return QRCode.toDataURL(otpUri);
}

function verifyToken(token, secret) {
  if (!token || !secret) return false;
  try {
    return authenticator.verify({ token: String(token).trim(), secret });
  } catch {
    return false;
  }
}

module.exports = { generateSecret, generateOtpUri, generateQrDataUrl, verifyToken };
