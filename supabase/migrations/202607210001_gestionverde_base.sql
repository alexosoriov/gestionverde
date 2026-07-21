-- GestiónVerde · esquema inicial para Supabase
-- Ejecutar mediante Supabase CLI o pegar en SQL Editor.

create extension if not exists pgcrypto;

create type public.app_role as enum (
  'administrador',
  'jefatura',
  'supervisor',
  'chofer',
  'recolector',
  'vecino'
);

create type public.account_status as enum ('pendiente', 'aprobado', 'revocado');
create type public.route_status as enum ('planificado', 'en_recorrido', 'finalizado', 'suspendido');
create type public.stop_status as enum ('pendiente', 'completado', 'ausente', 'omitido');
create type public.request_status as enum ('pendiente', 'aceptado', 'programado', 'retirado', 'rechazado');

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  nombre text not null default '',
  telefono text,
  rol public.app_role not null default 'vecino',
  estado public.account_status not null default 'pendiente',
  activo boolean not null default true,
  calle text,
  numero_vivienda text,
  sector text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create table public.sectores (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  dia_semana smallint check (dia_semana between 1 and 7),
  hora_inicio time,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create table public.vehiculos (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  patente text,
  descripcion text,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create table public.rutas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  sector_id uuid references public.sectores(id) on delete set null,
  vehiculo_id uuid references public.vehiculos(id) on delete set null,
  fecha date,
  estado public.route_status not null default 'planificado',
  sector_actual text,
  progreso smallint not null default 0 check (progreso between 0 and 100),
  publicada boolean not null default false,
  creada_por uuid references public.profiles(id) on delete set null,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create table public.paradas_ruta (
  id uuid primary key default gen_random_uuid(),
  ruta_id uuid not null references public.rutas(id) on delete cascade,
  orden integer not null check (orden > 0),
  nombre text not null,
  direccion text not null,
  latitud double precision,
  longitud double precision,
  telefono text,
  notas text,
  estado public.stop_status not null default 'pendiente',
  actualizado_por uuid references public.profiles(id) on delete set null,
  actualizado_en timestamptz not null default now(),
  unique (ruta_id, orden)
);

create table public.jornadas (
  id uuid primary key default gen_random_uuid(),
  ruta_id uuid not null references public.rutas(id) on delete restrict,
  iniciada_por uuid not null references public.profiles(id) on delete restrict,
  iniciada_en timestamptz not null default now(),
  finalizada_en timestamptz,
  kilometros numeric(10,2),
  observaciones text,
  firma_cierre text,
  creado_en timestamptz not null default now()
);

create table public.registros_recoleccion (
  id uuid primary key default gen_random_uuid(),
  jornada_id uuid not null references public.jornadas(id) on delete cascade,
  parada_id uuid references public.paradas_ruta(id) on delete set null,
  estado public.stop_status not null,
  material text,
  kilos numeric(10,2) check (kilos is null or kilos >= 0),
  observacion text,
  registrado_por uuid not null references public.profiles(id) on delete restrict,
  registrado_en timestamptz not null default now()
);

create table public.solicitudes_retiro (
  id uuid primary key default gen_random_uuid(),
  vecino_id uuid not null references public.profiles(id) on delete cascade,
  nombre text not null,
  direccion text not null,
  telefono text,
  material text not null,
  detalle text,
  estado public.request_status not null default 'pendiente',
  revisada_por uuid references public.profiles(id) on delete set null,
  revisada_en timestamptz,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create table public.incidencias (
  id uuid primary key default gen_random_uuid(),
  jornada_id uuid references public.jornadas(id) on delete set null,
  parada_id uuid references public.paradas_ruta(id) on delete set null,
  tipo text not null,
  descripcion text,
  evidencia_path text,
  reportada_por uuid not null references public.profiles(id) on delete restrict,
  resuelta boolean not null default false,
  creada_en timestamptz not null default now(),
  resuelta_en timestamptz
);

create table public.noticias (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  resumen text not null,
  contenido text,
  publicada boolean not null default false,
  publicada_en timestamptz,
  creada_por uuid references public.profiles(id) on delete set null,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create table public.auditoria (
  id bigint generated always as identity primary key,
  usuario_id uuid references public.profiles(id) on delete set null,
  accion text not null,
  entidad text,
  entidad_id text,
  detalle jsonb not null default '{}'::jsonb,
  creado_en timestamptz not null default now()
);

create index profiles_rol_idx on public.profiles(rol);
create index profiles_estado_idx on public.profiles(estado);
create index rutas_fecha_idx on public.rutas(fecha);
create index paradas_ruta_ruta_idx on public.paradas_ruta(ruta_id, orden);
create index solicitudes_vecino_idx on public.solicitudes_retiro(vecino_id, creado_en desc);
create index registros_jornada_idx on public.registros_recoleccion(jornada_id, registrado_en);
create index incidencias_jornada_idx on public.incidencias(jornada_id, creada_en desc);

create or replace function public.set_actualizado_en()
returns trigger
language plpgsql
as $$
begin
  new.actualizado_en = now();
  return new;
end;
$$;

create trigger profiles_actualizado before update on public.profiles
for each row execute function public.set_actualizado_en();
create trigger sectores_actualizado before update on public.sectores
for each row execute function public.set_actualizado_en();
create trigger vehiculos_actualizado before update on public.vehiculos
for each row execute function public.set_actualizado_en();
create trigger rutas_actualizado before update on public.rutas
for each row execute function public.set_actualizado_en();
create trigger solicitudes_actualizado before update on public.solicitudes_retiro
for each row execute function public.set_actualizado_en();
create trigger noticias_actualizado before update on public.noticias
for each row execute function public.set_actualizado_en();

-- Toda cuenta creada desde la app nace como vecino pendiente.
-- Los roles municipales deben asignarse desde un proceso administrativo seguro.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, nombre, rol, estado, activo)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'nombre', ''),
    'vecino',
    'pendiente',
    true
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function private.is_municipal()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and activo = true
      and estado = 'aprobado'
      and rol in ('administrador', 'jefatura', 'supervisor', 'chofer', 'recolector')
  );
$$;

create or replace function private.can_manage()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and activo = true
      and estado = 'aprobado'
      and rol in ('administrador', 'jefatura', 'supervisor')
  );
$$;

grant execute on function private.is_municipal() to authenticated;
grant execute on function private.can_manage() to authenticated;

alter table public.profiles enable row level security;
alter table public.sectores enable row level security;
alter table public.vehiculos enable row level security;
alter table public.rutas enable row level security;
alter table public.paradas_ruta enable row level security;
alter table public.jornadas enable row level security;
alter table public.registros_recoleccion enable row level security;
alter table public.solicitudes_retiro enable row level security;
alter table public.incidencias enable row level security;
alter table public.noticias enable row level security;
alter table public.auditoria enable row level security;

create policy "perfil propio visible" on public.profiles
for select to authenticated
using ((select auth.uid()) = id);
create policy "jefatura ve perfiles" on public.profiles
for select to authenticated
using ((select private.can_manage()));
create policy "jefatura administra perfiles" on public.profiles
for update to authenticated
using ((select private.can_manage()))
with check ((select private.can_manage()));

create policy "sectores públicos activos" on public.sectores
for select to anon, authenticated
using (activo = true);
create policy "jefatura administra sectores" on public.sectores
for all to authenticated
using ((select private.can_manage()))
with check ((select private.can_manage()));

create policy "personal ve vehículos" on public.vehiculos
for select to authenticated
using ((select private.is_municipal()));
create policy "jefatura administra vehículos" on public.vehiculos
for all to authenticated
using ((select private.can_manage()))
with check ((select private.can_manage()));

create policy "rutas públicas publicadas" on public.rutas
for select to anon, authenticated
using (publicada = true);
create policy "personal ve rutas" on public.rutas
for select to authenticated
using ((select private.is_municipal()));
create policy "jefatura administra rutas" on public.rutas
for all to authenticated
using ((select private.can_manage()))
with check ((select private.can_manage()));

create policy "personal ve paradas" on public.paradas_ruta
for select to authenticated
using ((select private.is_municipal()));
create policy "personal actualiza paradas" on public.paradas_ruta
for update to authenticated
using ((select private.is_municipal()))
with check ((select private.is_municipal()));
create policy "jefatura crea y elimina paradas" on public.paradas_ruta
for all to authenticated
using ((select private.can_manage()))
with check ((select private.can_manage()));

create policy "personal ve jornadas" on public.jornadas
for select to authenticated
using ((select private.is_municipal()));
create policy "personal crea jornadas propias" on public.jornadas
for insert to authenticated
with check ((select private.is_municipal()) and iniciada_por = (select auth.uid()));
create policy "personal actualiza jornadas propias" on public.jornadas
for update to authenticated
using ((select private.is_municipal()) and iniciada_por = (select auth.uid()))
with check ((select private.is_municipal()) and iniciada_por = (select auth.uid()));
create policy "jefatura administra jornadas" on public.jornadas
for all to authenticated
using ((select private.can_manage()))
with check ((select private.can_manage()));

create policy "personal ve registros" on public.registros_recoleccion
for select to authenticated
using ((select private.is_municipal()));
create policy "personal crea registros propios" on public.registros_recoleccion
for insert to authenticated
with check ((select private.is_municipal()) and registrado_por = (select auth.uid()));
create policy "jefatura administra registros" on public.registros_recoleccion
for all to authenticated
using ((select private.can_manage()))
with check ((select private.can_manage()));

create policy "vecino crea solicitud propia" on public.solicitudes_retiro
for insert to authenticated
with check (vecino_id = (select auth.uid()));
create policy "vecino ve solicitudes propias" on public.solicitudes_retiro
for select to authenticated
using (vecino_id = (select auth.uid()));
create policy "jefatura administra solicitudes" on public.solicitudes_retiro
for all to authenticated
using ((select private.can_manage()))
with check ((select private.can_manage()));

create policy "personal ve incidencias" on public.incidencias
for select to authenticated
using ((select private.is_municipal()));
create policy "personal reporta incidencias" on public.incidencias
for insert to authenticated
with check ((select private.is_municipal()) and reportada_por = (select auth.uid()));
create policy "jefatura administra incidencias" on public.incidencias
for all to authenticated
using ((select private.can_manage()))
with check ((select private.can_manage()));

create policy "noticias públicas" on public.noticias
for select to anon, authenticated
using (publicada = true);
create policy "jefatura administra noticias" on public.noticias
for all to authenticated
using ((select private.can_manage()))
with check ((select private.can_manage()));

create policy "usuario registra auditoría propia" on public.auditoria
for insert to authenticated
with check (usuario_id = (select auth.uid()));
create policy "jefatura ve auditoría" on public.auditoria
for select to authenticated
using ((select private.can_manage()));

insert into public.sectores (nombre, dia_semana, hora_inicio)
values
  ('Valle Volcanes', 3, '08:00'),
  ('Lago Chapo', 4, '08:00'),
  ('Villa Los Héroes / Laguna Santuario', 5, '08:00')
on conflict (nombre) do nothing;

insert into public.vehiculos (codigo, descripcion)
values ('M-73', 'Camión de recolección selectiva')
on conflict (codigo) do nothing;

insert into storage.buckets (id, name, public)
values ('evidencias', 'evidencias', false)
on conflict (id) do nothing;

create policy "personal sube evidencias"
on storage.objects for insert to authenticated
with check (bucket_id = 'evidencias' and (select private.is_municipal()));

create policy "personal ve evidencias"
on storage.objects for select to authenticated
using (bucket_id = 'evidencias' and (select private.is_municipal()));

create policy "jefatura elimina evidencias"
on storage.objects for delete to authenticated
using (bucket_id = 'evidencias' and (select private.can_manage()));
