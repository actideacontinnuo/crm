/**
 * Crea las 9 bases de Notion en ngama's Space usando el token del .env
 * Uso: node scripts/crear-bases-ngama.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_TOKEN });

// ID de la página contenedora "Actidea CRM (Base de Datos)" ya creada en ngama's Space
// Si no existe aún, este script la crea también.
const CONTAINER_TITLE = 'Actidea CRM (Base de Datos)';

async function findOrCreateContainer() {
  return '38b837e99d58804eae90cdcfead08aff';
}

const BASES = [
  {
    key: 'NOTION_DB_PROSPECTOS',
    title: 'Prospectos',
    props: {
      'Empresa':    { title: {} },
      'Contacto':   { rich_text: {} },
      'Cargo':      { rich_text: {} },
      'Telefono':   { phone_number: {} },
      'Email':      { email: {} },
      'Evento':     { rich_text: {} },
      'Estimado':   { number: { format: 'mexican_peso' } },
      'Ejecutivo':  { select: { options: [
        { name: 'Natalia Gama', color: 'red' },
        { name: 'Mariana López', color: 'orange' },
        { name: 'Ximena', color: 'green' },
        { name: 'Alexia', color: 'blue' },
      ]}},
      'Fuente':     { select: { options: [
        { name: 'Referido', color: 'blue' },
        { name: 'LinkedIn', color: 'purple' },
        { name: 'Campo', color: 'orange' },
        { name: 'Scouting', color: 'yellow' },
      ]}},
      'Status':     { select: { options: [
        { name: 'Nuevo', color: 'gray' },
        { name: 'Contactado', color: 'blue' },
        { name: 'En conversación', color: 'yellow' },
        { name: 'Listo p/ cotizar', color: 'green' },
      ]}},
      'Seguimiento': { date: {} },
      'Notas':      { rich_text: {} },
    }
  },
  {
    key: 'NOTION_DB_CLIENTES',
    title: 'Clientes',
    props: {
      'Nombre':     { title: {} },
      'Codigo':     { rich_text: {} },
      'Razon Social': { rich_text: {} },
      'RFC':        { rich_text: {} },
      'Direccion':  { rich_text: {} },
      'Contacto':   { rich_text: {} },
      'Cargo':      { rich_text: {} },
      'Telefono':   { phone_number: {} },
      'Email':      { email: {} },
      'Ejecutivo':  { select: { options: [
        { name: 'Natalia Gama', color: 'red' },
        { name: 'Mariana López', color: 'orange' },
        { name: 'Ximena', color: 'green' },
        { name: 'Alexia', color: 'blue' },
      ]}},
      'Condiciones de Pago': { select: { options: [
        { name: '30 días', color: 'blue' },
        { name: '60 días', color: 'yellow' },
        { name: '90 días', color: 'gray' },
      ]}},
      'Status':     { select: { options: [
        { name: 'Activo', color: 'green' },
        { name: 'Inactivo', color: 'gray' },
        { name: 'Bloqueado', color: 'red' },
      ]}},
      'Docs':       { rich_text: {} },
    }
  },
  {
    key: 'NOTION_DB_OPS',
    title: 'OPs',
    props: {
      'Número OP':  { title: {} },
      'Descripción': { rich_text: {} },
      'Cliente ID': { rich_text: {} },
      'Ejecutivo':  { select: { options: [
        { name: 'Natalia Gama', color: 'red' },
        { name: 'Mariana López', color: 'orange' },
        { name: 'Ximena', color: 'green' },
        { name: 'Alexia', color: 'blue' },
      ]}},
      'Fecha Evento': { date: {} },
      'Cotizado':   { number: { format: 'mexican_peso' } },
      'Cobrado':    { number: { format: 'mexican_peso' } },
      'Utilidad':   { number: { format: 'mexican_peso' } },
      'Status':     { select: { options: [
        { name: 'Cotización', color: 'gray' },
        { name: 'En Producción', color: 'blue' },
        { name: 'Ejecutado', color: 'green' },
        { name: 'Cancelado', color: 'red' },
      ]}},
    }
  },
  {
    key: 'NOTION_DB_COTIZACIONES',
    title: 'Cotizaciones',
    props: {
      'ID Cot':     { title: {} },
      'OP ID':      { rich_text: {} },
      'Cliente ID': { rich_text: {} },
      'Versión':    { rich_text: {} },
      'Fecha':      { date: {} },
      'Status':     { select: { options: [
        { name: 'Borrador', color: 'gray' },
        { name: 'Enviada', color: 'blue' },
        { name: 'Aceptada', color: 'green' },
        { name: 'Rechazada', color: 'red' },
      ]}},
      'Subtotal':   { number: { format: 'mexican_peso' } },
      'Fee %':      { number: {} },
      'IVA':        { number: { format: 'mexican_peso' } },
      'Total con IVA': { number: { format: 'mexican_peso' } },
      'Ejecutivo':  { select: { options: [
        { name: 'Natalia Gama', color: 'red' },
        { name: 'Mariana López', color: 'orange' },
        { name: 'Ximena', color: 'green' },
        { name: 'Alexia', color: 'blue' },
      ]}},
      'Secciones':  { rich_text: {} },
    }
  },
  {
    key: 'NOTION_DB_PAGOS',
    title: 'Pagos',
    props: {
      'Concepto':   { title: {} },
      'Tipo':       { select: { options: [
        { name: 'Cobro a cliente', color: 'blue' },
        { name: 'Pago a proveedor', color: 'orange' },
      ]}},
      'OP ID':      { rich_text: {} },
      'Monto':      { number: { format: 'mexican_peso' } },
      'Fecha Acordada': { date: {} },
      'Fecha Real': { date: {} },
      'Status':     { select: { options: [
        { name: 'Pendiente', color: 'yellow' },
        { name: 'Pagado', color: 'green' },
        { name: 'Vencido', color: 'red' },
      ]}},
      'Forma de Pago': { select: { options: [
        { name: 'Transferencia SPEI', color: 'blue' },
        { name: 'Cheque', color: 'gray' },
        { name: 'Efectivo', color: 'green' },
        { name: 'Por definir', color: 'default' },
      ]}},
      'Referencia': { rich_text: {} },
      'Comprobante': { checkbox: {} },
    }
  },
  {
    key: 'NOTION_DB_PROVEEDORES',
    title: 'Proveedores',
    props: {
      'Nombre':     { title: {} },
      'Razón Social': { rich_text: {} },
      'RFC':        { rich_text: {} },
      'Banco':      { select: { options: [
        { name: 'BBVA Bancomer', color: 'blue' },
        { name: 'Santander', color: 'red' },
        { name: 'Banorte', color: 'orange' },
        { name: 'HSBC', color: 'green' },
        { name: 'Banamex', color: 'yellow' },
        { name: 'Otro', color: 'gray' },
      ]}},
      'CLABE':      { rich_text: {} },
      'Servicio':   { rich_text: {} },
      'Condiciones de Pago': { select: { options: [
        { name: 'Inmediato', color: 'green' },
        { name: '15 días', color: 'blue' },
        { name: '30 días', color: 'yellow' },
        { name: '60 días', color: 'orange' },
      ]}},
      'Emite Factura': { checkbox: {} },
      'Contacto':   { rich_text: {} },
      'Tel':        { phone_number: {} },
      'Email':      { email: {} },
      'Notas':      { rich_text: {} },
    }
  },
  {
    key: 'NOTION_DB_DEUDAS',
    title: 'Deudas',
    props: {
      'Concepto':   { title: {} },
      'Proveedor ID': { rich_text: {} },
      'OP ID':      { rich_text: {} },
      'Monto':      { number: { format: 'mexican_peso' } },
      'Fecha Acordada': { date: {} },
      'Status':     { select: { options: [
        { name: 'pendiente', color: 'yellow' },
        { name: 'pagado', color: 'green' },
      ]}},
    }
  },
  {
    key: 'NOTION_DB_CASOS',
    title: 'Casos',
    props: {
      'Título':     { title: {} },
      'Cliente ID': { rich_text: {} },
      'OP ID':      { rich_text: {} },
      'Tipo':       { select: { options: [
        { name: 'Seguimiento de pago', color: 'blue' },
        { name: 'Solicitud de descuento', color: 'yellow' },
        { name: 'Reclamo', color: 'red' },
        { name: 'Otro', color: 'gray' },
      ]}},
      'Prioridad':  { select: { options: [
        { name: 'Alta', color: 'red' },
        { name: 'Media', color: 'yellow' },
        { name: 'Baja', color: 'gray' },
      ]}},
      'Quién':      { rich_text: {} },
      'Descripción': { rich_text: {} },
      'Acción Requerida': { rich_text: {} },
      'Status':     { select: { options: [
        { name: 'Abierto', color: 'red' },
        { name: 'En proceso', color: 'yellow' },
        { name: 'Cerrado', color: 'green' },
      ]}},
      'Fecha':      { date: {} },
      'Historial':  { rich_text: {} },
    }
  },
  {
    key: 'NOTION_DB_TICKETS',
    title: 'Tickets',
    props: {
      'Tipo':       { title: {} },
      'Cotización ID': { rich_text: {} },
      'Monto Afectado': { rich_text: {} },
      'Quién':      { rich_text: {} },
      'Motivo':     { rich_text: {} },
      'Status':     { select: { options: [
        { name: 'Pendiente', color: 'yellow' },
        { name: 'Aprobado', color: 'green' },
        { name: 'Rechazado', color: 'red' },
      ]}},
      'Fecha':      { date: {} },
    }
  },
];

async function main() {
  // Verificar workspace
  const me = await notion.users.me();
  console.log(`\n🔑 Workspace: ${me.name || JSON.stringify(me)}\n`);

  const containerId = await findOrCreateContainer();

  const envLines = [];
  for (const base of BASES) {
    try {
      const db = await notion.databases.create({
        parent: { type: 'page_id', page_id: containerId },
        title: [{ type: 'text', text: { content: base.title } }],
        properties: base.props,
      });
      const id = db.id.replace(/-/g, '');
      console.log(`✅ ${base.title}: ${id}`);
      envLines.push(`${base.key}=${id}`);
    } catch (err) {
      console.error(`❌ ${base.title}: ${err.message}`);
      envLines.push(`# ERROR ${base.key}`);
    }
  }

  console.log('\n─────────────────────────────────────────');
  console.log('Copia estas líneas en tu .env:\n');
  envLines.forEach(l => console.log(l));
  console.log('─────────────────────────────────────────\n');
}

main().catch(console.error);
