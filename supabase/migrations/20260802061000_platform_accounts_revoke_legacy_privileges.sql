-- AdBot: remove legacy non-DML privileges inherited from the initial schema.
--
-- The connector migration already removed SELECT, INSERT, UPDATE, and DELETE
-- from anon/authenticated before re-granting safe authenticated columns. The
-- initial schema also granted TRUNCATE, REFERENCES, and TRIGGER; those rights
-- bypass or extend beyond the intended RLS-only dashboard access and must not
-- remain on the secret-bearing connector table.

revoke truncate, references, trigger
  on table public.platform_accounts
  from anon, authenticated;
