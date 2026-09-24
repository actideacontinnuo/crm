-- ════════════════════════════════════════════════════════════
-- Actidea CRM — Esquema Postgres (Supabase)
-- Migración desde Notion — ver conversación. Cada tabla espeja una base de
-- Notion existente, pero con relaciones REALES (foreign keys) en vez de los
-- campos de texto "ID pelón" que Notion usaba — eso es justo lo que hizo
-- posible el bug de duplicación de pagos a proveedor que se corrigió antes
-- de esta migración: sin llaves foráneas ni transacciones, nada impedía que
-- un pago se guardara dos veces.
-- ════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto"; -- para gen_random_uuid()

-- ── Usuarios ──────────────────────────────────────────────────
create table usuarios (
  id              uuid primary key default gen_random_uuid(),
  usuario         text not null unique,
  nombre          text not null,
  email           text,
  password_hash   text not null,
  rol             text not null check (rol in ('ejecutivo','administracion','admin')),
  ejec            text,               -- nombre "comercial" (Natalia Gama, Ximena, Alexia...) cuando aplica
  activo          boolean not null default true,
  must_change_password boolean not null default false,
  two_fa_secret   text,
  two_fa_enabled  boolean not null default false,
  reset_token     text,
  reset_token_expira timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ── Clientes ──────────────────────────────────────────────────
create table clientes (
  id              uuid primary key default gen_random_uuid(),
  nombre          text not null,
  codigo          text,               -- fijo al crear (RFC-EJEC-DDMMAA)
  razon_social    text,
  rfc             text,
  direccion       text,
  contacto        text,
  cargo           text,
  telefono        text,
  email           text,
  propietario     text,               -- fijo al crear, nunca se reasigna
  ejec_cuenta     text,
  ejec_asignado   text,
  comision        numeric(5,2),       -- % fijo al crear; null = no gestionada
  condiciones_pago text,
  status          text default 'Activo',
  docs            jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ── Prospectos ────────────────────────────────────────────────
create table prospectos (
  id              uuid primary key default gen_random_uuid(),
  empresa         text not null,
  contacto        text,
  cargo           text,
  telefono        text,
  email           text,
  evento          text,
  estimado        numeric(14,2),
  ejec            text,
  propietario     text,
  ejec_cuenta     text,
  ejec_asignado   text,
  comision        numeric(5,2),
  fuente          text,               -- 'Apollo' | manual
  status          text default 'Nuevo',
  seguimiento     date,
  notas           jsonb default '[]',
  -- Metadata de Prospección por Apollo (solo lectura fuera de ese módulo)
  sector          text,
  confianza_ia    numeric(4,1),
  verificacion_ia text default 'Pendiente' check (verificacion_ia in ('Pendiente','Verificado','No verificado')),
  num_empleados   integer,
  tamano_empresa  text,
  origen_carga    text,               -- 'Automático' | 'Manual'
  correo_generado boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ── OPs (Órdenes de Producción) ──────────────────────────────
create table ops (
  id              uuid primary key default gen_random_uuid(),
  numero          text not null unique,     -- fijo al crear
  descripcion     text not null,
  cliente_id      uuid references clientes(id),
  ejec            text,
  propietario     text,
  ejec_cuenta     text,
  ejec_asignado   text,
  fecha_evento    date,
  cotizado        numeric(14,2) not null default 0,  -- neto sin IVA
  bono            text,
  comision        numeric(5,2),
  status          text not null default 'En Producción' check (status in ('En Producción','Ejecutado')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index idx_ops_cliente on ops(cliente_id);

-- ── Cotizaciones (archivos PDF/Excel) ────────────────────────
create table cotizaciones (
  id              uuid primary key default gen_random_uuid(),
  cot_id          text,
  op_id           uuid references ops(id),
  cliente_id      uuid references clientes(id),
  version         text,
  fecha           date,
  status          text default 'Enviada',
  ejec            text,
  propietario     text,
  ejec_cuenta     text,
  ejec_asignado   text,
  pdf_url         text,
  pdf_nombre      text,
  excel_url       text,
  excel_nombre    text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index idx_cotizaciones_op on cotizaciones(op_id);
create index idx_cotizaciones_cliente on cotizaciones(cliente_id);

-- ── Proveedores ───────────────────────────────────────────────
create table proveedores (
  id              uuid primary key default gen_random_uuid(),
  nombre          text not null,
  razon_social    text,
  rfc             text,
  banco           text,
  clabe           text,
  servicio        text,
  condiciones     text,
  emite_factura   boolean default false,
  notas           text,
  contacto        text,
  telefono        text,
  email           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ── Deudas (pagos a proveedor) — Cotización + Pagado acumulado ──
-- Esta es la tabla que corrige el bug real: Pagado se ACUMULA con cada
-- abono (ver api equivalente a POST /:id/abonar), nunca se sobreescribe ni
-- se crea un segundo registro. Con Postgres, además, el abono se hace
-- dentro de una transacción — imposible que quede a medias.
create table deudas (
  id              uuid primary key default gen_random_uuid(),
  concepto        text not null,
  proveedor_id    uuid references proveedores(id),
  op_id           uuid references ops(id),
  monto           numeric(14,2) not null default 0,        -- cotización neta sin IVA
  monto_con_iva   numeric(14,2),                            -- cotización con IVA (factura)
  pagado          numeric(14,2) not null default 0,         -- neto abonado acumulado
  pagado_con_iva  numeric(14,2) not null default 0,         -- con IVA abonado acumulado
  fecha_acordada  date,
  status          text not null default 'pendiente' check (status in ('pendiente','parcial','pagado')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint chk_pagado_no_excede check (pagado_con_iva <= coalesce(monto_con_iva, monto) + 0.01)
);
create index idx_deudas_op on deudas(op_id);
create index idx_deudas_proveedor on deudas(proveedor_id);

-- ── Pagos (cobros a cliente) ──────────────────────────────────
create table pagos (
  id              uuid primary key default gen_random_uuid(),
  concepto        text not null,
  tipo            text not null default 'Cobro a cliente',
  op_id           uuid references ops(id),
  monto           numeric(14,2) not null default 0,
  fecha_acordada  date,
  fecha_real      date,
  status          text default 'Pendiente' check (status in ('Pendiente','Pagado','Vencido')),
  forma_pago      text,
  referencia      text,
  comprobante     boolean default false,
  extra           boolean not null default false,   -- fuera de la cotización original (ver Estado de Resultados)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index idx_pagos_op on pagos(op_id);

-- ── Casos ─────────────────────────────────────────────────────
create table casos (
  id              uuid primary key default gen_random_uuid(),
  titulo          text not null,
  cliente_id      uuid references clientes(id),
  op_id           uuid references ops(id),
  tipo            text,
  prioridad       text default 'Media',
  quien           text,
  descripcion     text,
  accion_requerida text,
  status          text default 'Abierto',
  fecha           date,
  historial       jsonb default '[]',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index idx_casos_cliente on casos(cliente_id);
create index idx_casos_op on casos(op_id);

-- ── Tickets (incidencias sobre cotizaciones) ─────────────────
create table tickets (
  id              uuid primary key default gen_random_uuid(),
  tipo            text not null,
  cotizacion_id   uuid references cotizaciones(id),
  monto_afectado  text,
  quien           text,
  motivo          text,
  status          text default 'Abierto',
  fecha           date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index idx_tickets_cotizacion on tickets(cotizacion_id);

-- ── Objetivos (metas anuales) ─────────────────────────────────
create table objetivos (
  id              uuid primary key default gen_random_uuid(),
  anio            integer not null unique,
  meta_ventas     numeric(14,2),
  meta_produccion numeric(14,2),
  meta_clientes   integer,
  meta_utilidad   numeric(14,2),
  meta_cobranza   numeric(14,2),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ── Auditoría ─────────────────────────────────────────────────
create table auditoria (
  id              uuid primary key default gen_random_uuid(),
  usuario         text,
  accion          text not null,
  entidad         text,
  detalle         text,
  ip              text,
  exito           boolean default true,
  fuera_de_horario boolean default false,
  fecha           timestamptz not null default now()
);
create index idx_auditoria_fecha on auditoria(fecha desc);
create index idx_auditoria_accion on auditoria(accion);

-- ── Seguridad (intentos de login, bloqueos, etc.) ────────────
create table seguridad (
  id              uuid primary key default gen_random_uuid(),
  tipo            text not null,
  usuario         text,
  ip              text,
  detalle         text,
  fecha           timestamptz not null default now()
);

-- ── updated_at automático en cada tabla con esa columna ──────
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$
declare t text;
begin
  for t in select unnest(array['usuarios','clientes','prospectos','ops','cotizaciones',
    'proveedores','deudas','pagos','casos','tickets','objetivos'])
  loop
    execute format('create trigger trg_updated_at before update on %I for each row execute function set_updated_at()', t);
  end loop;
end $$;


-- ── Borrado lógico (deleted_at) en todas las tablas ───────────
alter table usuarios     add column if not exists deleted_at timestamptz;
alter table clientes     add column if not exists deleted_at timestamptz;
alter table prospectos   add column if not exists deleted_at timestamptz;
alter table ops          add column if not exists deleted_at timestamptz;
alter table cotizaciones add column if not exists deleted_at timestamptz;
alter table proveedores  add column if not exists deleted_at timestamptz;
alter table deudas       add column if not exists deleted_at timestamptz;
alter table pagos        add column if not exists deleted_at timestamptz;
alter table casos        add column if not exists deleted_at timestamptz;
alter table tickets      add column if not exists deleted_at timestamptz;
alter table objetivos    add column if not exists deleted_at timestamptz;
alter table auditoria    add column if not exists deleted_at timestamptz;
alter table seguridad    add column if not exists deleted_at timestamptz;

-- ── Ajustes para igualar el contrato que ya usa la app ───────
alter table objetivos add column if not exists meta_pipeline numeric(14,2);
alter table objetivos add column if not exists objetivo_ejecutivo numeric(14,2);
alter table objetivos add column if not exists objetivos_individuales jsonb default '{}';
alter table objetivos alter column meta_clientes type numeric(14,2);
-- Interruptor de emergencia (antes "Panel de Seguridad" en Notion)
alter table seguridad alter column tipo drop not null;
alter table seguridad add column if not exists bloquear_todo_el_acceso boolean not null default false;
insert into seguridad (bloquear_todo_el_acceso) select false where not exists (select 1 from seguridad);
alter table usuarios add column if not exists intentos_fallidos integer not null default 0;
alter table usuarios add column if not exists bloqueado_hasta timestamptz;

-- ── Renombres para igualar los nombres que usa el código ─────
alter table clientes rename column razon_social to razon;
alter table clientes rename column direccion to dir;
alter table clientes rename column telefono to tel;
alter table clientes rename column condiciones_pago to pago;
alter table clientes add column if not exists ejec text;
alter table pagos rename column forma_pago to forma;
alter table pagos rename column referencia to ref;
alter table proveedores rename column razon_social to razon;
alter table proveedores rename column condiciones to cond;
alter table proveedores rename column telefono to tel;
