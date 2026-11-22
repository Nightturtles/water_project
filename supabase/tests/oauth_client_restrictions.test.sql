-- pgTAP: what an OAuth client (an AI app connected through the MCP server) can
-- and cannot do, per 20261122200921_restrict_oauth_client_access.sql.
--
-- Run against the local stack:  supabase test db
--
-- An OAuth client's JWT is the user's own, plus a client_id claim. Each block
-- below sets request.jwt.claims the way PostgREST would, then acts as the
-- `authenticated` role so row-level security applies.

begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

-- Two users and a starting set of rows, created as the superuser.
insert into auth.users (id, email)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a@example.test'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b@example.test');

insert into public.target_profiles (user_id, slug, label, creator_user_id, is_public)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a-private', 'A private', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a-public', 'A public', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b-private', 'B private', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false);

insert into public.source_profiles (user_id, slug, label)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a-tap', 'A tap');

insert into public.user_settings (user_id) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
insert into public.user_selections (user_id) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- ---------------------------------------------------------------------------
-- User A through an OAuth client
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated","client_id":"test-client"}';

select ok(public.is_oauth_client(), 'a client_id claim marks the request as an OAuth client');

select is(
  (select count(*)::int from public.target_profiles where slug in ('a-private', 'a-public')),
  2, 'oauth client reads its own rows');
select is(
  (select count(*)::int from public.target_profiles where slug = 'b-private'),
  0, 'oauth client cannot read another user''s private row');

select lives_ok(
  $$ insert into public.target_profiles (user_id, slug, label, creator_user_id, is_public)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'mcp-new', 'MCP new', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false) $$,
  'oauth client inserts a private recipe');
select throws_ok(
  $$ insert into public.target_profiles (user_id, slug, label, creator_user_id, is_public)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'mcp-pub', 'MCP pub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true) $$,
  '42501', null, 'oauth client cannot insert a public recipe');
select throws_ok(
  $$ insert into public.target_profiles (user_id, slug, label, creator_user_id, tray)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'mcp-feat', 'MCP feat', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'featured') $$,
  '42501', null, 'oauth client cannot take the featured tray');
select throws_ok(
  $$ insert into public.target_profiles (user_id, slug, label, creator_user_id)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'mcp-attr', 'MCP attr', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') $$,
  '42501', null, 'oauth client cannot attribute a recipe to someone else');

select lives_ok(
  $$ update public.target_profiles set calcium = 42 where slug = 'a-private' $$,
  'oauth client updates a private recipe');
select throws_ok(
  $$ update public.target_profiles set is_public = true where slug = 'a-private' $$,
  '42501', null, 'oauth client cannot publish a recipe');

update public.target_profiles set calcium = 99 where slug = 'a-public';
select is(
  (select calcium::int from public.target_profiles where slug = 'a-public'),
  0, 'oauth client cannot edit a published recipe');

delete from public.target_profiles where slug = 'a-private';
select is(
  (select count(*)::int from public.target_profiles where slug = 'a-private'),
  1, 'oauth client cannot delete a recipe');

select lives_ok(
  $$ insert into public.source_profiles (user_id, slug, label)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'mcp-tap', 'MCP tap') $$,
  'oauth client inserts a source water');
select lives_ok(
  $$ update public.source_profiles set calcium = 12 where slug = 'a-tap' $$,
  'oauth client updates a source water');
delete from public.source_profiles where slug = 'a-tap';
select is(
  (select count(*)::int from public.source_profiles where slug = 'a-tap'),
  1, 'oauth client cannot delete a source water');

select is(
  (select count(*)::int from public.user_settings),
  1, 'oauth client reads its settings');
update public.user_settings set theme = 'dark';
select is(
  (select theme from public.user_settings),
  'system', 'oauth client cannot update settings');
update public.user_selections set target_preset = 'changed';
select is(
  (select target_preset from public.user_selections),
  'sca', 'oauth client cannot update selections');
select throws_ok(
  $$ insert into public.user_settings (user_id) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
     on conflict (user_id) do update set theme = 'dark' $$,
  '42501', null, 'oauth client cannot upsert settings');
select throws_ok(
  $$ insert into public.user_selections (user_id) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
     on conflict (user_id) do update set target_preset = 'changed' $$,
  '42501', null, 'oauth client cannot upsert selections');

select throws_ok(
  $$ select public.delete_account() $$,
  '42501', null, 'oauth client cannot delete the account');

-- ---------------------------------------------------------------------------
-- User A in the app itself (no client_id): nothing changes
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

select ok(not public.is_oauth_client(), 'no client_id claim means a first-party session');
select lives_ok(
  $$ update public.target_profiles set is_public = true where slug = 'a-private' $$,
  'the app publishes a recipe');
select lives_ok(
  $$ update public.target_profiles set calcium = 7 where slug = 'a-public' $$,
  'the app edits a published recipe');
select lives_ok(
  $$ insert into public.user_settings (user_id, theme) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dark')
     on conflict (user_id) do update set theme = excluded.theme $$,
  'the app upserts settings');
select lives_ok(
  $$ insert into public.user_selections (user_id, target_preset) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'rao')
     on conflict (user_id) do update set target_preset = excluded.target_preset $$,
  'the app upserts selections');

delete from public.target_profiles where slug = 'mcp-new';
select is(
  (select count(*)::int from public.target_profiles where slug = 'mcp-new'),
  0, 'the app deletes a recipe');
delete from public.source_profiles where slug = 'a-tap';
select is(
  (select count(*)::int from public.source_profiles where slug = 'a-tap'),
  0, 'the app deletes a source water');

select * from finish();
rollback;
