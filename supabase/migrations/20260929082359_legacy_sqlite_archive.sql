-- A private, lossless archive of rows from the former SQLite databases.
-- This is deliberately separate from signalgen's active multi-user tables:
-- legacy watchlists/rules have no owner and must not be assigned implicitly.
create schema if not exists legacy;
revoke all on schema legacy from public, anon, authenticated;

create table legacy.sqlite_sources (
  source_sha256 text primary key check (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_label text not null,
  source_bytes bigint not null check (source_bytes >= 0),
  table_count integer not null check (table_count >= 0),
  row_count bigint not null check (row_count >= 0),
  imported_at timestamptz not null default now()
);

create table legacy.sqlite_tables (
  source_sha256 text not null references legacy.sqlite_sources(source_sha256),
  table_name text not null,
  create_sql text not null,
  row_count bigint not null check (row_count >= 0),
  primary key (source_sha256, table_name)
);

create table legacy.sqlite_rows (
  source_sha256 text not null,
  table_name text not null,
  ordinal bigint not null check (ordinal > 0),
  sqlite_rowid bigint,
  payload jsonb not null,
  primary key (source_sha256, table_name, ordinal),
  foreign key (source_sha256, table_name)
    references legacy.sqlite_tables(source_sha256, table_name)
);

-- No direct client access, even if a schema exposure setting changes later.
alter table legacy.sqlite_sources enable row level security;
alter table legacy.sqlite_tables enable row level security;
alter table legacy.sqlite_rows enable row level security;
