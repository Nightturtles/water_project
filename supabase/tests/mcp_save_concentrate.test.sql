-- pgTAP: public.mcp_save_concentrate, the one way an OAuth client (an AI app
-- connected through the MCP server) may write concentrates
-- (20261123013834_mcp_save_concentrate.sql).
--
-- Run against the local stack:  supabase test db

begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

insert into auth.users (id, email)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a@example.test'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b@example.test'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c@example.test');

-- A has settings the function must leave alone; B has an untouched row; C has
-- never synced (no row).
insert into public.user_settings
  (user_id, theme, selected_concentrates, stock_concentrate_specs, diy_concentrate_specs)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dark', '["stock:mine"]',
   '{"mine":{"label":"Mine","bottleMl":200,"doseGramsPerL":4,"minerals":[{"mineralId":"epsom-salt","grams":5}],"createdFrom":"library:rao-perger","source":"Somewhere","dropMl":0.05}}',
   '{"epsom-salt":{"bottleMl":59,"gramsPerBottle":13.5}}'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'light', '[]', '{}', '{}');

-- ---------------------------------------------------------------------------
-- User A through an OAuth client
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated","client_id":"test-client"}';

-- The row is hidden from an oauth client's UPDATE, so it changes nothing.
update public.user_settings set stock_concentrate_specs = '{}';
select is(
  (select stock_concentrate_specs -> 'mine' ->> 'label' from public.user_settings),
  'Mine', 'a direct settings write by an oauth client still changes nothing');

-- Create a Recipe Concentrate.
select lives_ok(
  $$ select public.mcp_save_concentrate('stock', 'new-one',
       '{"label":"  New One  ","bottleMl":250,"doseGramsPerL":5,"dropMl":0.0456,
         "minerals":[{"mineralId":"epsom-salt","grams":4.1},{"mineralId":"baking-soda","grams":1.2}],
         "createdFrom":"derived:my-recipe","source":"injected","extra":{"anything":true}}',
       'create') $$,
  'an oauth client creates a Recipe Concentrate');
select is(
  (select stock_concentrate_specs -> 'new-one' from public.user_settings),
  '{"label":"New One","bottleMl":250,"doseGramsPerL":5,"dropMl":0.046,
    "minerals":[{"mineralId":"epsom-salt","grams":4.1},{"mineralId":"baking-soda","grams":1.2}],
    "createdFrom":"derived:my-recipe"}'::jsonb,
  'the stored spec is rebuilt from checked fields: trimmed name, rounded dropper, no extra keys, no source');
select is(
  (select stock_concentrate_specs -> 'mine' ->> 'label' from public.user_settings),
  'Mine', 'the concentrate that was already there is kept');
select is(
  (select theme || '|' || selected_concentrates::text from public.user_settings),
  'dark|["stock:mine"]', 'no other setting changed, and nothing was switched on');

select throws_ok(
  $$ select public.mcp_save_concentrate('stock', 'new-one',
       '{"label":"Again","bottleMl":250,"doseGramsPerL":5,"minerals":[{"mineralId":"epsom-salt","grams":1}]}',
       'create') $$,
  '23505', null, 'create refuses a key that exists');
select throws_ok(
  $$ select public.mcp_save_concentrate('stock', 'missing',
       '{"label":"X","bottleMl":250,"doseGramsPerL":5,"minerals":[{"mineralId":"epsom-salt","grams":1}]}',
       'update') $$,
  'P0002', null, 'update refuses a key that does not exist');

-- Update keeps the origin fields and replaces the rest.
select lives_ok(
  $$ select public.mcp_save_concentrate('stock', 'mine',
       '{"label":"Mine v2","bottleMl":300,"doseGramsPerL":3,
         "minerals":[{"mineralId":"gypsum","grams":0.5}],"createdFrom":"derived:other","source":"changed"}',
       'update') $$,
  'an oauth client updates a Recipe Concentrate');
select is(
  (select stock_concentrate_specs -> 'mine' from public.user_settings),
  '{"label":"Mine v2","bottleMl":300,"doseGramsPerL":3,"minerals":[{"mineralId":"gypsum","grams":0.5}],
    "createdFrom":"library:rao-perger","source":"Somewhere"}'::jsonb,
  'an update keeps the stored origin, drops the dropper that was not sent, and replaces the rest');
select is(
  (select (public.mcp_save_concentrate('stock', 'mine',
      '{"label":"Mine v3","bottleMl":300,"doseGramsPerL":3,"minerals":[{"mineralId":"gypsum","grams":0.5}]}',
      'update') -> 'previous' ->> 'label')),
  'Mine v2', 'the reply carries the previous spec');

-- Mineral Concentrates.
select lives_ok(
  $$ select public.mcp_save_concentrate('diy', 'magnesium-chloride',
       '{"bottleMl":100,"gramsPerBottle":20,"dropMl":0.05,"label":"ignored"}', 'create') $$,
  'an oauth client creates a Mineral Concentrate');
select is(
  (select diy_concentrate_specs -> 'magnesium-chloride' from public.user_settings),
  '{"bottleMl":100,"gramsPerBottle":20,"dropMl":0.05}'::jsonb,
  'only the Mineral Concentrate fields are stored');
select lives_ok(
  $$ select public.mcp_save_concentrate('diy', 'epsom-salt',
       '{"bottleMl":60,"gramsPerBottle":14}', 'update') $$,
  'an oauth client updates a Mineral Concentrate');
select is(
  (select diy_concentrate_specs from public.user_settings),
  '{"epsom-salt":{"bottleMl":60,"gramsPerBottle":14},
    "magnesium-chloride":{"bottleMl":100,"gramsPerBottle":20,"dropMl":0.05}}'::jsonb,
  'both Mineral Concentrates are present after the two saves');

-- Refused input.
select throws_ok(
  $$ select public.mcp_save_concentrate('recipe', 'x', '{}', 'create') $$,
  '22023', null, 'unknown kind');
select throws_ok(
  $$ select public.mcp_save_concentrate('stock', 'x', '{}', 'delete') $$,
  '22023', null, 'unknown mode: there is no delete');
select throws_ok(
  $$ select public.mcp_save_concentrate('stock', 'Bad Key', '{}', 'create') $$,
  '22023', null, 'a key must be a slug');
select throws_ok(
  $$ select public.mcp_save_concentrate('stock', 'x', '[]', 'create') $$,
  '22023', null, 'a spec must be an object');
select throws_ok(
  $$ select public.mcp_save_concentrate('stock', 'x',
       '{"label":"X","bottleMl":250,"doseGramsPerL":5,"minerals":[]}', 'create') $$,
  '22023', null, 'a Recipe Concentrate needs a mineral');
select throws_ok(
  $$ select public.mcp_save_concentrate('stock', 'x',
       '{"label":"X","bottleMl":250,"doseGramsPerL":5,"minerals":[{"mineralId":"epsom-salt","grams":-1}]}', 'create') $$,
  '22023', null, 'grams must be positive');
select throws_ok(
  $$ select public.mcp_save_concentrate('stock', 'x',
       '{"label":"X","bottleMl":250,"doseGramsPerL":5,"minerals":[{"mineralId":"<script>","grams":1}]}', 'create') $$,
  '22023', null, 'a mineral id must be a slug');
select throws_ok(
  $$ select public.mcp_save_concentrate('stock', 'x',
       '{"label":"X","bottleMl":"250","doseGramsPerL":5,"minerals":[{"mineralId":"epsom-salt","grams":1}]}', 'create') $$,
  '22023', null, 'numbers must be numbers');
select throws_ok(
  $$ select public.mcp_save_concentrate('stock', 'x',
       '{"label":"","bottleMl":250,"doseGramsPerL":5,"minerals":[{"mineralId":"epsom-salt","grams":1}]}', 'create') $$,
  '22023', null, 'a name is required');
select throws_ok(
  $$ select public.mcp_save_concentrate('stock', 'x',
       '{"label":"X","bottleMl":250,"doseGramsPerL":5,"minerals":[{"mineralId":"epsom-salt","grams":1}],"createdFrom":"library:rao-perger"}', 'create') $$,
  '22023', null, 'a new concentrate cannot claim to be a library import');
select throws_ok(
  $$ select public.mcp_save_concentrate('diy', 'gypsum', '{"bottleMl":100,"gramsPerBottle":0}', 'create') $$,
  '22023', null, 'a Mineral Concentrate needs grams');
select throws_ok(
  $$ select public.mcp_save_concentrate('diy', 'gypsum', '{"bottleMl":100,"gramsPerBottle":1,"dropMl":0.0001}', 'create') $$,
  '22023', null, 'a dropper size below 0.001 mL is refused');
select is(
  (select count(*)::int from jsonb_object_keys((select stock_concentrate_specs from public.user_settings))),
  2, 'none of the refused calls stored anything');

-- The count cap.
select lives_ok(
  $$ select public.mcp_save_concentrate('stock', 'fill-' || n,
       '{"label":"Fill","bottleMl":250,"doseGramsPerL":5,"minerals":[{"mineralId":"epsom-salt","grams":1}]}', 'create')
     from generate_series(1, 48) n $$,
  'concentrates can be added up to the cap');
select throws_ok(
  $$ select public.mcp_save_concentrate('stock', 'one-too-many',
       '{"label":"Fill","bottleMl":250,"doseGramsPerL":5,"minerals":[{"mineralId":"epsom-salt","grams":1}]}', 'create') $$,
  '54000', null, 'the 51st Recipe Concentrate is refused');
select lives_ok(
  $$ select public.mcp_save_concentrate('stock', 'mine',
       '{"label":"Mine v4","bottleMl":300,"doseGramsPerL":3,"minerals":[{"mineralId":"gypsum","grams":0.5}]}', 'update') $$,
  'an update still works at the cap');

-- Only the caller's own row is ever touched.
reset role;
select is(
  (select stock_concentrate_specs::text || diy_concentrate_specs::text || theme
     from public.user_settings where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  '{}{}light', 'another user''s settings are untouched');

-- A user who has never synced gets a clear refusal, not a seeded row.
set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated","client_id":"test-client"}';
select throws_ok(
  $$ select public.mcp_save_concentrate('diy', 'gypsum', '{"bottleMl":100,"gramsPerBottle":1}', 'create') $$,
  'P0002', null, 'no settings row: refused');
reset role;
select is(
  (select count(*)::int from public.user_settings where user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  0, 'and no row was created');

-- Signed out.
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok(
  $$ select public.mcp_save_concentrate('diy', 'gypsum', '{"bottleMl":100,"gramsPerBottle":1}', 'create') $$,
  '42501', null, 'anon cannot call it');

select * from finish();
rollback;
