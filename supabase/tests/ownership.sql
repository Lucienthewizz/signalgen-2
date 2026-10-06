-- Run against a test/staging copy. The transaction rolls back every fixture.
-- Requires at least two Supabase Auth users, but prints neither user ID.
begin;

insert into signalgen.account_profiles (user_id, email)
select id, coalesce(email, '') from auth.users order by created_at limit 2
on conflict (user_id) do nothing;

do $$
declare
  owner_id uuid;
  other_id uuid;
  test_rule_id text := 'rls_test_' || replace(gen_random_uuid()::text, '-', '');
  test_universe_id text;
  visible_count integer;
  changed_count integer;
begin
  select id into owner_id from auth.users order by created_at limit 1;
  select id into other_id from auth.users order by created_at offset 1 limit 1;
  if owner_id is null or other_id is null then
    raise exception 'two Auth users are required for ownership test';
  end if;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  insert into signalgen.user_rules
    (id, owner_user_id, name, definition_json, definition_hash,
     schema_version, engine_version)
  values (test_rule_id, owner_id, 'RLS test', '{}'::jsonb,
          'sha256:test', 'test', 'test');
  insert into signalgen.stock_universes (owner_user_id, name)
  values (owner_id, 'RLS universe test') returning id into test_universe_id;
  insert into signalgen.stock_universe_members (universe_id, symbol, position)
  values (test_universe_id, 'BBCA.JK', 0);

  perform set_config('request.jwt.claim.sub', other_id::text, true);
  select count(*) into visible_count from signalgen.account_profiles where user_id = owner_id;
  if visible_count <> 0 then
    raise exception 'another user can read owner profile';
  end if;
  select count(*) into visible_count from signalgen.user_rules where id = test_rule_id;
  if visible_count <> 0 then
    raise exception 'another user can read an owner rule';
  end if;
  update signalgen.user_rules set name = 'cross-owner edit' where id = test_rule_id;
  get diagnostics changed_count = row_count;
  if changed_count <> 0 then
    raise exception 'another user can update an owner rule';
  end if;
  delete from signalgen.user_rules where id = test_rule_id;
  get diagnostics changed_count = row_count;
  if changed_count <> 0 then
    raise exception 'another user can delete an owner rule';
  end if;
  select count(*) into visible_count from signalgen.stock_universes where id = test_universe_id;
  if visible_count <> 0 then
    raise exception 'another user can read an owner stock universe';
  end if;
  select count(*) into visible_count from signalgen.stock_universe_members where universe_id = test_universe_id;
  if visible_count <> 0 then
    raise exception 'another user can read owner stock universe members';
  end if;

  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  select count(*) into visible_count from signalgen.account_profiles where user_id = owner_id;
  if visible_count <> 1 then
    raise exception 'owner cannot read own profile';
  end if;
  select count(*) into visible_count from signalgen.user_rules where id = test_rule_id;
  if visible_count <> 1 then
    raise exception 'owner cannot read own rule';
  end if;
  select count(*) into visible_count from signalgen.stock_universes where id = test_universe_id;
  if visible_count <> 1 then
    raise exception 'owner cannot read own stock universe';
  end if;
end;
$$;

rollback;
