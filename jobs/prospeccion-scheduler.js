const cron = require('node-cron');
const { ejecutarProspeccionAutomatica } = require('../api/prospeccion');

// Domingos 8:00 am, hora de Ciudad de México (confirmado con el usuario:
// cadencia semanal, rota sectores por tasa de respuesta, se ejecuta sola sin
// que nadie la dispare — ver api/prospeccion.js ejecutarProspeccionAutomatica).
cron.schedule('0 8 * * 0', async () => {
  console.log('📡 Ejecutando prospección automática semanal...');
  try {
    const r = await ejecutarProspeccionAutomatica();
    console.log(`✅ Prospección semanal: ${r.totalCreados} prospectos creados · sectores: ${r.sectoresElegidos.join(', ')}`);
  } catch (err) {
    console.error('❌ Error en la prospección automática semanal:', err.message);
  }
}, { timezone: 'America/Mexico_City' });

console.log('📡 Prospección automática programada (domingos 8:00 am, hora CDMX)');
