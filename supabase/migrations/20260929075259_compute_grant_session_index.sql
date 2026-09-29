-- Supports FK checks and cascade cleanup when an app session is removed.
create index compute_grants_session_idx on signalgen.compute_grants (session_id);
