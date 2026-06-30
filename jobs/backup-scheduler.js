const cron = require('node-cron');
const { runBackup } = require('./backup');

// Corre el día 1 de cada mes a las 3:00 am (hora del servidor)
cron.schedule('0 3 1 * *', async () => {
  console.log('🗄️  Ejecutando respaldo mensual automático de Notion...');
  try {
    const { emailResult } = await runBackup({ trigger: 'cron-mensual' });
    console.log(emailResult.sent ? '✅ Respaldo enviado por correo' : `⚠️  Respaldo generado pero no enviado: ${emailResult.reason}`);
  } catch (err) {
    console.error('❌ Error en el respaldo mensual:', err.message);
  }
});

console.log('🗄️  Respaldo automático mensual programado (día 1 de cada mes, 3:00 am)');
