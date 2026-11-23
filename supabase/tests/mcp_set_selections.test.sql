-- pgTAP: the three functions through which an OAuth client (an AI app
-- connected through the MCP server) may change the active selections
-- (20261123180000_mcp_set_selections.sql): mcp_set_enabled,
-- mcp_set_active_recipe and mcp_set_active_source_water.
--
-- Run against the local stack:  supabase test db

begin;
create extension if not exists pgtap with schema extensions;
select plan(65);

insert into auth.users (id, email)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a@example.test'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b@example.test'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c@example.test');

-- A has settings and selections the functions must leave alone apart from the
-- one field each changes; B has untouched rows; C has never synced (no rows).
insert into public.user_settings
  (user_id, theme, brew_method, selected_minerals, selected_concentrates,
   stock_concentrate_specs, diy_concentrate_specs)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dark', 'filter',
   '["calcium-chloride","epsom-salt","baking-soda"]',
   '["stock:gone","brand:lotus:calcium"]',
   '{"ready":{"label":"Ready","bottleMl":200,"doseGramsPerL":4,"minerals":[{"mineralId":"epsom-salt","grams":5}]},
     "empty":{"label":"Empty","bottleMl":200,"doseGramsPerL":4,"minerals":[]}}',
   '{"epsom-salt":{"bottleMl":"59","gramsPerBottle":13.5},"gypsum":{"bottleMl":100}}'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'light', 'filter', '["gypsum"]', '[]', '{}', '{}');

insert into public.user_selections
  (user_id, source_preset, source_water, target_preset,
   deleted_source_presets, deleted_target_presets, added_target_presets)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'distilled', '{"calcium":0}', 'a-filter',
   '["old-tap","volvic"]', '["a-removed"]', '["lib-added"]'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'distilled', '{}', 'sca', '[]', '[]', '[]');

insert into public.target_profiles (id, user_id, slug, label, creator_user_id, is_public, brew_method, is_starter)
values
  ('10000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a-filter', 'A filter', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, 'filter', false),
  ('10000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a-espresso', 'A espresso', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, 'espresso', false),
  ('10000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a-removed', 'A removed', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, 'filter', false),
  ('10000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'lib-shadowed', 'A copy', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, 'filter', false),
  ('20000000-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b-private', 'B private', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false, 'filter', false),
  ('20000000-0000-0000-0000-000000000002', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b-public', 'B public', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', true, 'filter', false),
  ('30000000-0000-0000-0000-000000000001', null, 'lib-extra', 'Library extra', null, true, 'filter', false),
  ('30000000-0000-0000-0000-000000000002', null, 'lib-added', 'Library added', null, true, 'all', false),
  ('30000000-0000-0000-0000-000000000003', null, 'lib-shadowed', 'Library shadowed', null, true, 'filter', false);

insert into public.source_profiles (user_id, slug, label, calcium, magnesium, bicarbonate)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a-tap', 'A tap', 40, 8.5, 120),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'old-tap', 'Old tap', 1, 1, 1),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b-tap', 'B tap', 99, 9, 9);

-- Each user approved "test-client" with the current list on the consent page
-- (version 2). A also has "old-client", approved when the list was at version
-- 1, and "unrecorded-client", connected before approvals were recorded.
insert into public.mcp_app_consent (user_id, client_id, abilities_version)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'test-client', 2),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'test-client', 2),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'test-client', 2),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'old-client', 1);

-- Reads the write counter as the table owner: clients cannot see it.
create function pg_temp.quota_of(p_user uuid) returns integer
language sql security definer as $$
  select coalesce((select sum(count)::integer from public.mcp_write_quota where user_id = p_user), 0);
$$;

-- ---------------------------------------------------------------------------
-- An app the user has not approved for these abilities is refused
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated","client_id":"old-client"}';
select throws_ok(
  $$ select public.mcp_set_enabled('mineral', 'gypsum', true) $$,
  'MCA01', null, 'an app approved at version 1 cannot switch a mineral');
select throws_ok(
  $$ select public.mcp_set_active_recipe('10000000-0000-0000-0000-000000000002') $$,
  'MCA01', null, 'nor choose the active recipe');
select throws_ok(
  $$ select public.mcp_set_active_source_water('a-tap') $$,
  'MCA01', null, 'nor choose the active source water');
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated","client_id":"unrecorded-client"}';
select throws_ok(
  $$ select public.mcp_set_enabled('mineral', 'gypsum', true) $$,
  'MCA01', null, 'an app with no recorded approval is refused too');
select throws_ok(
  $$ select public.mcp_set_enabled('mineral', 'epsom-salt', false) $$,
  'MCA01', null, 'switching off is gated as well');
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated","client_id":"old-client"}';
select is(
  (select s.selected_minerals::text || '|' || x.target_preset || '|' || x.source_preset
     from public.user_settings s, public.user_selections x),
  '["calcium-chloride", "epsom-salt", "baking-soda"]|a-filter|distilled',
  'and nothing was changed');
select is(pg_temp.quota_of('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 0,
  'a refused call is not counted against the daily limit');
reset role;

-- ---------------------------------------------------------------------------
-- User A through an OAuth client
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated","client_id":"test-client"}';

-- Direct writes stay closed: the rows are hidden from an oauth client's UPDATE.
update public.user_settings set selected_minerals = '[]';
update public.user_selections set target_preset = 'changed';
select is(
  (select s.selected_minerals::text || '|' || x.target_preset
     from public.user_settings s, public.user_selections x),
  '["calcium-chloride", "epsom-salt", "baking-soda"]|a-filter',
  'direct writes to settings and selections by an oauth client still change nothing');

-- ---- mcp_set_enabled: minerals ---------------------------------------------
select is(
  public.mcp_set_enabled('mineral', 'gypsum', true),
  '{"kind":"mineral","id":"gypsum","enabled":true,"changed":true,
    "selected":["calcium-chloride","epsom-salt","baking-soda","gypsum"]}'::jsonb,
  'an oauth client switches a mineral on');
select is(
  public.mcp_set_enabled('mineral', 'gypsum', true) -> 'changed',
  'false'::jsonb, 'switching on what is already on changes nothing');
select is(
  public.mcp_set_enabled('mineral', 'epsom-salt', false) -> 'selected',
  '["calcium-chloride","baking-soda","gypsum"]'::jsonb,
  'switching a mineral off removes only that one and keeps the order');
select is(
  public.mcp_set_enabled('mineral', 'never-on', false) -> 'changed',
  'false'::jsonb, 'switching off what is not on changes nothing');
select throws_ok(
  $$ select public.mcp_set_enabled('mineral', 'Bad Id!', true) $$,
  '22023', 'unknown mineral id', 'a malformed mineral id is refused');
select throws_ok(
  $$ select public.mcp_set_enabled('mineral', 'table-salt', true) $$,
  '22023', 'unknown mineral id', 'a mineral the app does not know is refused');
select throws_ok(
  $$ select public.mcp_set_enabled('theme', 'dark', true) $$,
  '22023', 'kind must be mineral or concentrate', 'no other kind of setting can be named');
select throws_ok(
  $$ select public.mcp_set_enabled('mineral', 'gypsum', null) $$,
  '22023', 'enabled must be true or false', 'enabled is required');

-- ---- mcp_set_enabled: concentrates -----------------------------------------
select is(
  public.mcp_set_enabled('concentrate', 'stock:ready', true) -> 'selected',
  '["stock:gone","brand:lotus:calcium","stock:ready"]'::jsonb,
  'a Recipe Concentrate that exists and is set up can be switched on, next to the others');
select throws_ok(
  $$ select public.mcp_set_enabled('concentrate', 'stock:missing', true) $$,
  'P0002', 'no concentrate with that id', 'a Recipe Concentrate that does not exist is refused');
select throws_ok(
  $$ select public.mcp_set_enabled('concentrate', 'stock:empty', true) $$,
  '55000', 'that concentrate is not fully set up', 'a Recipe Concentrate with no minerals is refused');
select is(
  public.mcp_set_enabled('concentrate', 'diy:epsom-salt', true) -> 'changed',
  'true'::jsonb, 'a Mineral Concentrate with bottle size and grams can be switched on');
select throws_ok(
  $$ select public.mcp_set_enabled('concentrate', 'diy:gypsum', true) $$,
  '55000', 'that concentrate is not fully set up', 'a Mineral Concentrate without grams is refused');
select throws_ok(
  $$ select public.mcp_set_enabled('concentrate', 'diy:baking-soda', true) $$,
  'P0002', 'no concentrate with that id', 'a Mineral Concentrate that does not exist is refused');
select is(
  public.mcp_set_enabled('concentrate', 'brand:lotus:magnesium', true) -> 'changed',
  'true'::jsonb, 'a brand concentrate id can be switched on');
select throws_ok(
  $$ select public.mcp_set_enabled('concentrate', 'anything-else', true) $$,
  '22023', 'unknown concentrate id', 'an id that is no kind of concentrate is refused');
select throws_ok(
  $$ select public.mcp_set_enabled('concentrate', 'brand:lotus:unobtainium', true) $$,
  '22023', 'unknown concentrate id', 'a brand concentrate the app does not know is refused');
select is(
  public.mcp_set_enabled('concentrate', 'stock:gone', false) -> 'selected',
  '["brand:lotus:calcium","stock:ready","diy:epsom-salt","brand:lotus:magnesium"]'::jsonb,
  'an entry whose concentrate was deleted can still be switched off');
select is(
  (select theme || '|' || brew_method || '|' || selected_minerals::text || '|'
          || (stock_concentrate_specs -> 'ready' ->> 'label') || '|'
          || (diy_concentrate_specs -> 'gypsum' ->> 'bottleMl')
     from public.user_settings),
  'dark|filter|["calcium-chloride", "baking-soda", "gypsum"]|Ready|100',
  'no other setting changed, and no concentrate was altered');

-- ---- mcp_set_active_recipe ---------------------------------------------------
select is(
  public.mcp_set_active_recipe('10000000-0000-0000-0000-000000000001'),
  '{"target_preset":"a-filter","previous":"a-filter","changed":false,"added_to_rail":false,
    "brew_method":"filter","brew_method_changed":false}'::jsonb,
  'making the already active recipe active changes nothing');
select is(
  public.mcp_set_active_recipe('10000000-0000-0000-0000-000000000002'),
  '{"target_preset":"a-espresso","previous":"a-filter","changed":true,"added_to_rail":false,
    "brew_method":"espresso","brew_method_changed":true}'::jsonb,
  'an own espresso recipe becomes active and the brew method follows it');
select is(
  (select brew_method || '|' || theme from public.user_settings),
  'espresso|dark', 'only the brew method changed in settings');
select is(
  public.mcp_set_active_recipe('30000000-0000-0000-0000-000000000002'),
  '{"target_preset":"lib-added","previous":"a-espresso","changed":true,"added_to_rail":false,
    "brew_method":null,"brew_method_changed":false}'::jsonb,
  'a library recipe for every brew method leaves the brew method alone');
select is(
  public.mcp_set_active_recipe('30000000-0000-0000-0000-000000000001'),
  '{"target_preset":"lib-extra","previous":"lib-added","changed":true,"added_to_rail":true,
    "brew_method":"filter","brew_method_changed":true}'::jsonb,
  'a library recipe outside the starter set is added to the rail');
select is(
  (select added_target_presets from public.user_selections),
  '["lib-added","lib-extra"]'::jsonb, 'the rail keeps what it had and gains that one recipe');
select throws_ok(
  $$ select public.mcp_set_active_recipe('10000000-0000-0000-0000-000000000003') $$,
  '55000', 'that recipe was removed in the app', 'a recipe the user removed is refused');
select throws_ok(
  $$ select public.mcp_set_active_recipe('30000000-0000-0000-0000-000000000003') $$,
  '55000', 'this account has its own version of that recipe: use its id',
  'a library recipe the user has their own version of is refused');
select throws_ok(
  $$ select public.mcp_set_active_recipe('20000000-0000-0000-0000-000000000001') $$,
  'P0002', 'no recipe with that id that this account can make active',
  'another user''s private recipe is refused');
select throws_ok(
  $$ select public.mcp_set_active_recipe('20000000-0000-0000-0000-000000000002') $$,
  'P0002', 'no recipe with that id that this account can make active',
  'another user''s published recipe is refused');
select throws_ok(
  $$ select public.mcp_set_active_recipe('99999999-9999-9999-9999-999999999999') $$,
  'P0002', 'no recipe with that id that this account can make active', 'an unknown id is refused');
select is(
  (select target_preset || '|' || deleted_target_presets::text || '|' || source_preset
     from public.user_selections),
  'lib-extra|["a-removed"]|distilled',
  'refused calls changed nothing, and the delete list and source water are untouched');

-- ---- mcp_set_active_source_water ---------------------------------------------
select is(
  public.mcp_set_active_source_water('a-tap', '{"calcium":999}'),
  '{"source_preset":"a-tap","previous":"distilled","changed":true,"from_saved_row":true,
    "source_water":{"calcium":40,"magnesium":8.5,"potassium":0,"sodium":0,"sulfate":0,"chloride":0,"bicarbonate":120}}'::jsonb,
  'a saved source water becomes active with its saved values, whatever values were sent');
select is(
  (select source_water from public.user_selections),
  '{"calcium":40,"magnesium":8.5,"potassium":0,"sodium":0,"sulfate":0,"chloride":0,"bicarbonate":120}'::jsonb,
  'the key and the values were written together');
select is(
  public.mcp_set_active_source_water('voss',
    '{"calcium":80,"magnesium":26,"bicarbonate":360,"sodium":null,"extra":"x","tds":500}') -> 'source_water',
  '{"calcium":80,"magnesium":26,"potassium":0,"sodium":0,"sulfate":0,"chloride":0,"bicarbonate":360}'::jsonb,
  'a built-in water is stored as the seven ions, rebuilt from checked values');
select throws_ok(
  $$ select public.mcp_set_active_source_water('evian', '{"calcium":80}') $$,
  'P0002', 'no saved source water with that key',
  'a key that is neither saved nor built in is refused, even with values');
select throws_ok(
  $$ select public.mcp_set_active_source_water('constructor', '{"calcium":80}') $$,
  'P0002', 'no saved source water with that key',
  'so is a key that names something on every object in the app');
select is(
  (select source_preset || '|' || (source_water ->> 'calcium') from public.user_selections),
  'voss|80', 'and neither changed the active source water');
select throws_ok(
  $$ select public.mcp_set_active_source_water('voss') $$,
  'P0002', 'no saved source water with that key', 'a key with no saved row and no values is refused');
select throws_ok(
  $$ select public.mcp_set_active_source_water('voss', '{"calcium":"80"}') $$,
  '22023', 'ion values must be numbers', 'a non-number ion is refused');
select throws_ok(
  $$ select public.mcp_set_active_source_water('voss', '{"calcium":-1}') $$,
  '22023', 'ion value out of range', 'a negative ion is refused');
select throws_ok(
  $$ select public.mcp_set_active_source_water('voss', '{"calcium":10001}') $$,
  '22023', 'ion value out of range', 'an absurd ion is refused');
select throws_ok(
  $$ select public.mcp_set_active_source_water('custom', '{"calcium":1}') $$,
  '22023', 'invalid source water key', 'the hand-typed "custom" water cannot be selected');
select throws_ok(
  $$ select public.mcp_set_active_source_water('Bad Key', '{"calcium":1}') $$,
  '22023', 'invalid source water key', 'a malformed key is refused');
select throws_ok(
  $$ select public.mcp_set_active_source_water('old-tap') $$,
  '55000', 'that source water was removed in the app', 'a saved water the user removed is refused');
select throws_ok(
  $$ select public.mcp_set_active_source_water('volvic', '{"calcium":12}') $$,
  '55000', 'that source water was removed in the app', 'a built-in water the user removed is refused');
select throws_ok(
  $$ select public.mcp_set_active_source_water('b-tap') $$,
  'P0002', 'no saved source water with that key', 'another user''s saved water is not found');
select is(
  (select source_preset || '|' || target_preset || '|' || deleted_source_presets::text
          || '|' || added_target_presets::text
     from public.user_selections),
  'voss|lib-extra|["old-tap", "volvic"]|["lib-added", "lib-extra"]',
  'nothing else in selections changed');

-- The helper is internal.
select throws_ok(
  $$ select public.mcp_is_positive('1'::jsonb) $$,
  '42501', null, 'the internal helper is not callable by a signed-in user');

-- ---------------------------------------------------------------------------
-- User B's rows were never touched; user C has no rows
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","role":"authenticated","client_id":"test-client"}';
select is(
  (select s.selected_minerals::text || '|' || s.brew_method || '|' || x.target_preset || '|' || x.source_preset
     from public.user_settings s, public.user_selections x),
  '["gypsum"]|filter|sca|distilled', 'another user''s settings and selections are untouched');

set local request.jwt.claims = '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated","client_id":"test-client"}';
select throws_ok(
  $$ select public.mcp_set_enabled('mineral', 'gypsum', true) $$,
  'P0002', 'no settings yet: open the Cafelytic app once while signed in',
  'no settings row is created for an account that never synced');
select throws_ok(
  $$ select public.mcp_set_active_recipe('30000000-0000-0000-0000-000000000002') $$,
  'P0002', 'no settings yet: open the Cafelytic app once while signed in',
  'no selections row is created for an account that never synced');
select throws_ok(
  $$ select public.mcp_set_active_source_water('voss', '{"calcium":80}') $$,
  'P0002', 'no settings yet: open the Cafelytic app once while signed in',
  'no selections row is created by the source water function either');
select is(
  (select count(*)::int from public.user_settings) + (select count(*)::int from public.user_selections),
  0, 'and none was created');

set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated","client_id":"test-client"}';
select cmp_ok(pg_temp.quota_of('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), '>', 0,
  'the approved app''s changes were counted against the daily limit');

-- ---------------------------------------------------------------------------
-- Signed out
-- ---------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok(
  $$ select public.mcp_set_enabled('mineral', 'gypsum', true) $$,
  '42501', null, 'a signed-out caller cannot switch anything');
select throws_ok(
  $$ select public.mcp_set_active_recipe('30000000-0000-0000-0000-000000000002') $$,
  '42501', null, 'a signed-out caller cannot set the active recipe');
select throws_ok(
  $$ select public.mcp_set_active_source_water('voss', '{"calcium":80}') $$,
  '42501', null, 'a signed-out caller cannot set the active source water');

select * from finish();
rollback;
