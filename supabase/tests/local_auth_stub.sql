-- Minimal Supabase Auth stand-in for isolated PostgreSQL repository tests.
-- Never apply this file to a real Supabase project.
create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  created_at timestamptz not null default now()
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

-- Dashboard-created helpers are represented only in this disposable DB so
-- the EXECUTE revocation migration is tested, including trigger invocation.
create function public.handle_new_user() returns trigger language plpgsql
security definer set search_path='' as $$
begin
  return new;
end;
$$;
create trigger auth_signup_probe after insert on auth.users
  for each row execute function public.handle_new_user();
create function public.rls_auto_enable() returns event_trigger language plpgsql
security definer set search_path='pg_catalog' as $$
begin
  return;
end;
$$;
create event trigger ddl_probe on ddl_command_end
  execute function public.rls_auto_enable();
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
end;
$$;
