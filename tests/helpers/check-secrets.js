/**
 * Verificación de seguridad: ningún secreto debe estar hardcodeado en archivos
 * que lleguen al cliente (HTML, JS del público).
 * Se ejecuta en CI antes del deploy.
 */
const fs   = require('fs');
const path = require('path');
const glob = require('fs');

const SENSITIVE_PATTERNS = [
  /ntn_[A-Za-z0-9]{40,}/,          // Notion tokens
  /re_[A-Za-z0-9]{20,}/,           // Resend API keys
  /sk-ant-api[A-Za-z0-9\-_]{30,}/, // Anthropic keys
  /NOTION_TOKEN\s*=\s*[^\n]{5}/,   // Asignación de variables de entorno
  /JWT_SECRET\s*=\s*[^\n]{5}/,
];

const CHECK_DIRS = [
  path.join(__dirname, '../../public'),
];

let foundSecrets = false;

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  SENSITIVE_PATTERNS.forEach(pattern => {
    if (pattern.test(content)) {
      console.error(`❌ SECRETO DETECTADO en ${filePath}: ${pattern}`);
      foundSecrets = true;
    }
  });
}

function scanDir(dir) {
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) scanDir(full);
    else if (/\.(html|js|ts|jsx|tsx|json)$/.test(entry.name)) scanFile(full);
  });
}

CHECK_DIRS.forEach(scanDir);

if (foundSecrets) {
  console.error('\n🚨 Se encontraron secretos en archivos públicos. Abortando deploy.\n');
  process.exit(1);
} else {
  console.log('✅ Sin secretos expuestos en archivos públicos.');
}
