-- pgTAP: the daily write quota and account ceilings for OAuth clients (AI apps
-- connected through the MCP server), and the record of what each connected app
-- was approved for (20261123064216_mcp_write_quota_and_app_consent.sql).
--
-- Run against the local stack:  supabase test db

begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a@example.test'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b@example.test');

insert into public.user_settings (user_id, diy_concentrate_specs)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '{}'), ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '{}');
insert into public.user_selections (user_id)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
insert into public.source_profiles (user_id, slug, label)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a-tap', 'A tap');

-- Reads the counter as the table owner: clients cannot see it.
create function pg_temp.quota_of(p_user uuid) returns integer
language sql security definer as $$
  select coalesce((select sum(count)::integer from public.mcp_write_quota where user_id = p_user), 0);
$$;

-- ===========================================================================
-- First-party sessions are not counted
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

select lives_ok(
  $$ insert into public.target_profiles (user_id, slug, label, creator_user_id)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'app-1', 'App 1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $$,
  'the app itself inserts a recipe');
select lives_ok(
  $$ update public.user_settings set theme = 'dark' $$,
  'the app itself saves settings');
select lives_ok(
  $$ update public.user_selections set updated_at = now() $$,
  'the app itself saves selections');
select lives_ok(
  $$ update public.source_profiles set calcium = 5 where slug = 'a-tap' $$,
  'the app itself changes a source water');
select is(pg_temp.quota_of('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 0,
  'none of the app''s own writes are counted');

-- ===========================================================================
-- An OAuth client's writes are counted, one per row written
-- ===========================================================================
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated","client_id":"test-client"}';

select lives_ok(
  $$ insert into public.target_profiles (user_id, slug, label, creator_user_id)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'mcp-1', 'MCP 1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $$,
  'an oauth client inserts a recipe');
select is(pg_temp.quota_of('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 1, 'counted: 1');

select lives_ok(
  $$ update public.source_profiles set calcium = 12 where slug = 'a-tap' $$,
  'an oauth client changes a source water');
select is(pg_temp.quota_of('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 2, 'counted: 2');

select lives_ok(
  $$ select public.mcp_save_concentrate('diy', 'epsom-salt',
       '{"bottleMl":100,"gramsPerBottle":10}', 'create') $$,
  'an oauth client saves a concentrate');
select is(pg_temp.quota_of('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 3,
  'a save through the concentrate function is counted too: 3');

select throws_ok(
  $$ insert into public.target_profiles (user_id, slug, label, creator_user_id, is_public)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'mcp-pub', 'MCP pub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true) $$,
  '42501', null, 'a refused write is still refused');
select throws_ok(
  $$ select public.mcp_save_concentrate('diy', 'epsom-salt',
       '{"bottleMl":100,"gramsPerBottle":10}', 'create') $$,
  '23505', null, 'a failed concentrate save still fails for its own reason');
select is(pg_temp.quota_of('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 3,
  'writes that failed are not counted');

select is((select count(*)::integer from public.mcp_write_quota), 0,
  'an oauth client cannot read the counter');
-- RLS with no policies hides every row, so this touches nothing instead of
-- raising: assert the effect.
update public.mcp_write_quota set count = 0;
select is(pg_temp.quota_of('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 3,
  'the counter is unchanged after a client tried to reset it');

-- ===========================================================================
-- The daily limit (100)
-- ===========================================================================
reset role;
update public.mcp_write_quota set count = 99
 where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
set local role authenticated;

select lives_ok(
  $$ insert into public.target_profiles (user_id, slug, label, creator_user_id)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'mcp-100', 'MCP 100', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $$,
  'the 100th write of the day is allowed');
select throws_ok(
  $$ insert into public.target_profiles (user_id, slug, label, creator_user_id)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'mcp-101', 'MCP 101', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $$,
  'MCQ01', null, 'the 101st insert is refused');
select throws_ok(
  $$ update public.target_profiles set calcium = 1 where slug = 'mcp-1' $$,
  'MCQ01', null, 'an update past the limit is refused');
select throws_ok(
  $$ update public.source_profiles set calcium = 13 where slug = 'a-tap' $$,
  'MCQ01', null, 'a source water change past the limit is refused');
select throws_ok(
  $$ select public.mcp_save_concentrate('diy', 'gypsum',
       '{"bottleMl":100,"gramsPerBottle":10}', 'create') $$,
  'MCQ01', null, 'a concentrate save past the limit is refused');
select is(pg_temp.quota_of('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 100,
  'refused writes do not push the counter past the limit');
select is(
  (select count(*)::integer from public.target_profiles where slug = 'mcp-101'), 0,
  'nothing was saved by the refused insert');

-- The limit is the user's across all of their connected apps.
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated","client_id":"another-client"}';
select throws_ok(
  $$ update public.source_profiles set calcium = 14 where slug = 'a-tap' $$,
  'MCQ01', null, 'a second connected app shares the same daily limit');

-- The user is not locked out of their own app.
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select lives_ok(
  $$ update public.source_profiles set calcium = 15 where slug = 'a-tap' $$,
  'the app itself still writes when connected apps are over the limit');

-- Another user is unaffected.
set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","role":"authenticated","client_id":"test-client"}';
select lives_ok(
  $$ insert into public.target_profiles (user_id, slug, label, creator_user_id)
     values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b-mcp-1', 'B MCP 1', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') $$,
  'another user''s connected app is not limited by it');

-- A new day starts a new count.
reset role;
update public.mcp_write_quota set day = day - 1
 where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated","client_id":"test-client"}';
select lives_ok(
  $$ update public.source_profiles set calcium = 16 where slug = 'a-tap' $$,
  'yesterday''s count does not limit today');

-- ===========================================================================
-- Account ceilings: 500 recipes, 100 source waters (inserts only)
-- ===========================================================================
reset role;
-- The trigger goes by the request's claims, not the role, so drop the oauth
-- client's claims before filling the account as the table owner.
set local request.jwt.claims = '{"role":"service_role"}';
insert into public.target_profiles (user_id, slug, label, creator_user_id)
select 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'fill-' || n, 'Fill ' || n, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
  from generate_series(1, 499) n;
insert into public.source_profiles (user_id, slug, label)
select 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'fill-' || n, 'Fill ' || n
  from generate_series(1, 100) n;
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","role":"authenticated","client_id":"test-client"}';

select throws_ok(
  $$ insert into public.target_profiles (user_id, slug, label, creator_user_id)
     values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b-over', 'B over', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') $$,
  'MCQ02', null, 'an oauth client cannot add a recipe to an account that holds 500');
select throws_ok(
  $$ insert into public.source_profiles (user_id, slug, label)
     values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b-over', 'B over') $$,
  'MCQ02', null, 'an oauth client cannot add a source water to an account that holds 100');
select lives_ok(
  $$ update public.target_profiles set calcium = 7 where slug = 'b-mcp-1' $$,
  'changing an existing recipe is still allowed at the ceiling');
select is(pg_temp.quota_of('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'), 2,
  'the two refused inserts were not counted (1 earlier insert + 1 update)');

set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","role":"authenticated"}';
select lives_ok(
  $$ insert into public.target_profiles (user_id, slug, label, creator_user_id)
     values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b-own', 'B own', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') $$,
  'the app itself is not held to the ceiling');

-- ===========================================================================
-- What each connected app was approved for
-- ===========================================================================
select is(public.mcp_abilities_version(), 2,
  'the ability list is at version 2 (raised by 20261123180000_mcp_set_selections.sql)');

-- A connected app cannot approve itself, forget an approval, or read them.
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated","client_id":"test-client"}';
select throws_ok(
  $$ select public.mcp_record_app_consent('test-client') $$,
  '42501', null, 'a connected app cannot record its own approval');
select throws_ok(
  $$ select public.mcp_forget_app_consent('test-client') $$,
  '42501', null, 'a connected app cannot forget an approval');
select throws_ok(
  $$ insert into public.mcp_app_consent (user_id, client_id, abilities_version)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'test-client', 99) $$,
  '42501', null, 'a connected app cannot write the table directly');

select is(public.mcp_app_allows(1), true, 'version 1 abilities need no recorded approval');
select is(public.mcp_app_allows(2), false, 'a later ability is refused with no recorded approval');
select is(public.mcp_app_allows(null), false, 'a missing version is refused');

-- The user approves the app from the consent page (a first-party session).
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select is(public.mcp_app_allows(2), true, 'the app itself is never gated');
select is(public.mcp_record_app_consent('test-client'), 2, 'the user''s approval is recorded at the current version');
select is(
  (select abilities_version from public.mcp_app_consent where client_id = 'test-client'), 2,
  'the user can read their own approval');
select throws_ok(
  $$ select public.mcp_record_app_consent('') $$,
  '22023', null, 'an empty client id is refused');
select throws_ok(
  $$ insert into public.mcp_app_consent (user_id, client_id, abilities_version)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'other', 99) $$,
  '42501', null, 'the table is not writable directly, even by the user');

set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated","client_id":"test-client"}';
select is(public.mcp_app_allows(2), true, 'an approval at version 2 covers a version 2 ability');
select is((select count(*)::integer from public.mcp_app_consent), 0,
  'a connected app cannot read approvals');

-- An approval given when the list was at version 1 (set here as the table
-- owner: the recording function only ever writes the current version).
reset role;
update public.mcp_app_consent set abilities_version = 1
 where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and client_id = 'test-client';
set local role authenticated;
select is(public.mcp_app_allows(2), false, 'an approval at version 1 does not cover a version 2 ability');
reset role;
update public.mcp_app_consent set abilities_version = 2
 where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and client_id = 'test-client';
set local role authenticated;
select is(public.mcp_app_allows(3), false, 'but not a version 3 one');

set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated","client_id":"another-client"}';
select is(public.mcp_app_allows(2), false, 'the approval is for that app only');
set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","role":"authenticated","client_id":"test-client"}';
select is(public.mcp_app_allows(2), false, 'and for that user only');

-- Another user cannot see or remove it.
set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","role":"authenticated"}';
select is((select count(*)::integer from public.mcp_app_consent), 0,
  'another user cannot read the approval');
select lives_ok(
  $$ select public.mcp_forget_app_consent('test-client') $$,
  'another user forgetting the same client id is harmless');
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select is((select count(*)::integer from public.mcp_app_consent), 1,
  'the approval is still there');

-- Disconnecting forgets it.
select lives_ok(
  $$ select public.mcp_forget_app_consent('test-client') $$,
  'the user forgets the approval when disconnecting the app');
select is((select count(*)::integer from public.mcp_app_consent), 0, 'the approval is gone');

select * from finish();
rollback;
