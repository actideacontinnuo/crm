# Proyecto: CRM Actidea (Supabase / Postgres)

## Contexto
- PlainWork (consultora de IA) construye este sistema para su cliente **Actidea** (producción de eventos corporativos, CDMX). Se entrega como producto.
- El frontend (`public/`) tiene diseño FINAL: no se rediseña ni se reestructura visualmente.

## Arquitectura actual
`Navegador` → `Servidor Node/Express (Railway)` → `Postgres en Supabase`

- Única base de datos: **Supabase (Postgres)**. Notion ya no se usa: fue la base original y se migró por completo.
- Capa de datos: `api/db.js` (queryDB/getRow/createRow/updateRow/archiveRow/transaccion). Esquema en `db/schema.sql`.
- Archivos de cotizaciones (PDF/Excel): bucket **privado** `cotizaciones` de Supabase Storage, servidos con URLs firmadas.
- Variables de entorno: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (solo en el servidor y en Railway, nunca en el navegador).
- Borrado lógico: todas las tablas tienen `deleted_at`; "eliminar" archiva, nunca borra de verdad.
- Tests: `npx jest` (mock en memoria de la base en `tests/helpers/mock-db.js`).

## Cómo trabajar (el usuario no es programador)
- Explica cada paso en español, simple, y avisa ANTES de hacerlo.
- Antes de cualquier acción que borre o sobrescriba datos, avisa y pide confirmación.
- Nunca escribas credenciales en servicios externos; el usuario las carga (p. ej. variables de Railway).
- Mantén el sistema funcionando en cada paso.
