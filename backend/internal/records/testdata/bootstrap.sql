-- Disposable PostgreSQL only; never run against a Supabase project.
create schema auth;
create table auth.users(id uuid primary key);
insert into auth.users values ('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
create schema signalgen;
create role anon;
create role authenticated;
create role signalgen_api login nosuperuser nobypassrls;
grant usage on schema signalgen to signalgen_api;
