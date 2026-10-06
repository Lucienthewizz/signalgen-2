-- Presentation fields only: clients never gain permission to modify role,
-- status, identity email or entitlement. Existing owner SELECT RLS is retained.
begin;

alter table signalgen.account_profiles
  add column display_name text not null default '',
  add column bio text not null default '',
  add column profile_version bigint not null default 1,
  add column profile_updated_at timestamptz not null default now(),
  add constraint profile_display_name_length check (char_length(display_name) <= 100),
  add constraint profile_bio_length check (char_length(bio) <= 280),
  add constraint profile_version_positive check (profile_version > 0);

comment on column signalgen.account_profiles.profile_version is
  'Optimistic concurrency for editable profile; auth email sync does not change this version.';

commit;
