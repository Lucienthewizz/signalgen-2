-- Expand existing universes in place. No owner, RLS, FK or unique key changes.
-- Filename aligned to the version registered by the cloud migration service.
-- Unique (universe_id, position) and ten allowed positions enforce the DB cap.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table signalgen.stock_universe_members
  drop constraint stock_universe_members_position_check,
  add constraint stock_universe_members_position_check
    check (position between 0 and 9);

commit;
