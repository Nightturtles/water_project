-- =============================================================================
-- Cafelytic — enable Realtime for user_settings
--
-- Mirrors the original 20260424193300_enable_realtime.sql for the user_settings
-- table, which was excluded from that migration. Without this, subscribing to
-- postgres_changes on user_settings via the client crashes the entire channel
-- (smoke-sync Step 4 reproduces: no Realtime events deliver for ANY table).
-- This unblocks PR (d.2)'s client-side change that adds "user_settings" to
-- subscribeToCloudChanges so cross-device edits of selectedMinerals,
-- concentrate specs, theme, drafts, etc. trigger pulls in real time.
--
-- REPLICA IDENTITY FULL on the same table so DELETE payloads carry user_id
-- (the default REPLICA IDENTITY only emits the primary key — the row's id,
-- not user_id — but the client subscribes with filter "user_id=eq.<uid>" and
-- Realtime evaluates that filter against the OLD row for DELETEs).
--
-- RLS on user_settings already restricts SELECT to auth.uid() = user_id
-- (see the initial schema migration); Realtime applies the same policies to
-- postgres_changes, so subscriptions remain per-user safe.
--
-- Idempotent: ADD TABLE swallows "already member" so the migration can rerun.
-- =============================================================================


DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE user_settings;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


ALTER TABLE user_settings REPLICA IDENTITY FULL;
