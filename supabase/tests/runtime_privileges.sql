-- Run only through schematest against the isolated signalgen_test database.
begin;
do $$
begin
  if exists(select 1 from pg_roles where rolname='signalgen_api'
    and (rolsuper or rolbypassrls or rolcreaterole or rolcreatedb or rolreplication or rolinherit)) then
    raise exception 'unsafe backend role attributes';
  end if;
  if has_schema_privilege('signalgen_api','signalgen','CREATE')
    or has_schema_privilege('signalgen_api','legacy','USAGE')
    or has_table_privilege('signalgen_api','auth.users','SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('signalgen_api','signalgen.audit_events','UPDATE,DELETE,TRUNCATE')
    or has_table_privilege('signalgen_api','signalgen.account_profiles','DELETE,TRUNCATE')
    or has_table_privilege('signalgen_api','signalgen.subscription_plans','INSERT,UPDATE,DELETE')
    or has_table_privilege('signalgen_api','signalgen.operator_bootstrap_state','INSERT,UPDATE,DELETE') then
    raise exception 'backend has permissions beyond its runtime responsibility';
  end if;
  if exists(select 1 from pg_auth_members where member=(select oid from pg_roles where rolname='signalgen_api')) then
    raise exception 'backend must not be a member of other roles';
  end if;
  if pg_has_role('anon','signalgen_api','MEMBER') or pg_has_role('authenticated','signalgen_api','MEMBER') then
    raise exception 'client roles can assume backend privileges';
  end if;
  if has_function_privilege('anon','public.handle_new_user()','EXECUTE')
    or has_function_privilege('authenticated','public.handle_new_user()','EXECUTE')
    or has_function_privilege('anon','public.rls_auto_enable()','EXECUTE')
    or has_function_privilege('authenticated','public.rls_auto_enable()','EXECUTE') then
    raise exception 'client EXECUTE remained on privileged trigger helpers';
  end if;
end;
$$;

-- Existing triggers keep working after direct function EXECUTE is revoked.
-- Temporary grants are test-only and rolled back, never applied to Supabase.
grant usage on schema auth to authenticated;
grant insert on auth.users to authenticated;
set local role authenticated;
insert into auth.users(email) values('signup-trigger@test.invalid');
reset role;

set local role signalgen_api;
select * from signalgen.stock_catalog;
do $$
begin
  begin
    execute 'create table signalgen.runtime_must_not_create(id int)';
    raise exception 'backend created a persistent table';
  exception when insufficient_privilege then null;
  end;
  begin
    execute 'select * from auth.users';
    raise exception 'backend read auth identities directly';
  exception when insufficient_privilege then null;
  end;
  begin
    execute 'update signalgen.audit_events set reason=reason';
    raise exception 'backend attempted to rewrite audit';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
rollback;
