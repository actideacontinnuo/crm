# Proyecto: CRM Actidea ↔ Notion (conexión real, local)

## Contexto
- PlainWork (consultora de IA) construye este sistema para su cliente **Actidea** (producción de eventos corporativos, CDMX). Se entrega como producto.
- Ya existe un CRM en un solo archivo HTML: `actidea-crm-dummy.html`. **Su diseño es FINAL**: no se rediseña ni se reestructura visualmente. Solo se cambia de DÓNDE saca los datos.
- Hoy los datos del CRM viven "en memoria", dentro del propio HTML, en un objeto JavaScript llamado `DB`. Al recargar la página, se pierden.

## Objetivo de esta sesión (alcance del fin de semana)
Conectar el CRM a **Notion como su base de datos REAL**, corriendo TODO localmente en una Mac. Empezar **solo con dos bases: Clientes y Prospectos**, en ambos sentidos (leer y escribir).

**Éxito =** (1) dar de alta un cliente en el CRM y que aparezca en Notion, y (2) crear algo en Notion y que aparezca en el CRM. Lo mismo para Prospectos.

## Arquitectura a construir
`Navegador (CRM HTML)` → `Servidor intermediario local en Node ("recepcionista")` → `API de Notion`

El "recepcionista" es el único que guarda la llave (token) de Notion.

**Regla de oro de seguridad:** el token de Notion NUNCA debe quedar dentro del HTML ni en nada que llegue al navegador. Vive solo en el servidor local, en un archivo `.env` que no se comparte ni se sube a ningún lado.

## Cómo trabajar (el usuario es principiante absoluto)
- El usuario NO sabe programar ni usar la terminal. Explica cada paso en español, simple, y dile exactamente qué va a pasar ANTES de hacerlo.
- Tú haces el trabajo técnico: instalar dependencias, crear el proyecto, escribir el servidor, editar el HTML, correr y depurar.
- Antes de cualquier acción que borre o sobrescriba algo, avisa y pide confirmación.
- Trabaja UNA fase a la vez (ver plan). Al terminar cada fase: detente, muéstrale cómo PROBAR que funciona, y espera su "ok" antes de seguir.
- Mantén el CRM funcionando en cada paso. Nada de dejarlo roto entre fases.

## Plan por fases
0. **Entorno local.** Verifica que tienes lo necesario para correr Node (la app de escritorio de Claude Code ya lo incluye). Crea la estructura del proyecto.
1. **Notion: crear las bases.** Crea las bases **Clientes** y **Prospectos** con columnas que empaten EXACTAMENTE con los campos que el CRM ya usa. Para esto, LEE el objeto `DB` dentro de `actidea-crm-dummy.html` (los arrays `clientes` y `prospectos`) y mapea cada campo a una propiedad de Notion. Campos que hoy son listas o relaciones (p. ej. `ops` de un cliente, `notas` de un prospecto): simplifícalos a texto en esta versión y déjalo anotado como mejora futura.
2. **El servidor intermediario.** Constrúyelo en Node: guarda el token en `.env` y expón endpoints para listar y crear Clientes y Prospectos en Notion. Pruébalo SOLO (sin tocar el CRM todavía) hasta que lea de Notion correctamente.
3. **Conectar el CRM.** Cambia el origen de datos: de `DB` (en memoria) a llamadas al servidor. Primero LEER (mostrar registros reales de Notion), luego ESCRIBIR (alta → Notion). Primero Clientes, luego Prospectos.
4. **Prueba de fuego.** Verifica el flujo en ambos sentidos (CRM ↔ Notion) para Clientes y Prospectos.

## Fuera de alcance este fin de semana (NO hacer todavía)
- Permisos por usuario / roles.
- Hosting o publicar en internet (todo local por ahora).
- Apollo (agente de prospección) y el agente de Marketing.
- Las demás bases (OPs, Cotizaciones, Pagos, Proveedores). Después.

## Lo que el usuario debe proporcionarte (pídeselo cuando toque)
- El archivo `actidea-crm-dummy.html` (debe estar ya en la carpeta del proyecto).
- El **token de su integración de Notion**, que él crea desde su cuenta de Notion.
- Que él **comparta / conecte** las bases de Clientes y Prospectos con esa integración (es un clic dentro de Notion, sin el cual el servidor no puede verlas).
