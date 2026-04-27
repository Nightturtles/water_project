-- =============================================================================
-- Cafelytic — enable Realtime for user data
--
-- Adds the three per-user tables to the supabase_realtime publication so the
-- client can subscribe to postgres_changes and learn about cross-device edits
-- without polling. Sets REPLICA IDENTITY FULL on the same tables so DELETE
-- payloads carry the row's user_id (the default REPLICA IDENTITY only emits
-- the primary key, which is the row's id, not user_id — but the client
-- subscribes with filter "user_id=eq.<auth.uid()>", and Realtime evaluates
-- the filter against the OLD row for DELETEs).
--
-- RLS for SELECT on these tables already restricts visibility to
-- auth.uid() = user_id (see the initial schema migration); Realtime applies
-- the same policies to postgres_changes, so subscriptions remain per-user safe.
--
-- Idempotent: each ADD TABLE is wrapped to swallow "already member of this
-- publication" errors so the migration can be rerun.
-- =============================================================================


DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE target_profiles;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE source_profiles;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE user_selections;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


ALTER TABLE target_profiles REPLICA IDENTITY FULL;
ALTER TABLE source_profiles REPLICA IDENTITY FULL;
ALTER TABLE user_selections REPLICA IDENTITY FULL;
