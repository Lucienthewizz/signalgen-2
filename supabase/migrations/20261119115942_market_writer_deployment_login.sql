-- Credential enrollment is opt-in. CI and ordinary migration runs leave the
-- writer NOLOGIN; the deployment operator supplies a SCRAM verifier separately.
-- No cleartext password, verifier or environment-specific URL belongs in Git.
do $$
declare verifier text := current_setting('signalgen.market_writer_scram',true);
begin
  if verifier is not null and verifier<>'' then
    if verifier !~ '^SCRAM-SHA-256\$[0-9]+:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$' then
      raise exception 'market writer credential must be a SCRAM verifier';
    end if;
    execute format('alter role signalgen_market_writer login noinherit connection limit 4 password %L',verifier);
  end if;
end $$;
