-- =============================================================================
-- Cafelytic — Supabase schema migration 001
-- Paste into the Supabase SQL editor and run.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- user_settings
-- ---------------------------------------------------------------------------

create table user_settings (
  user_id                  uuid primary key references auth.users(id) on delete cascade,
  theme                    text        default 'system',
  mineral_display_mode     text        default 'standard',
  brew_method              text        default 'filter',
  lotus_dropper_type       text        default 'round',
  selected_minerals        jsonb       default '["calcium-chloride","epsom-salt","baking-soda","potassium-bicarbonate"]',
  selected_concentrates    jsonb       default '[]',
  diy_concentrate_specs    jsonb       default '{}',
  lotus_concentrate_units  jsonb       default '{}',
  volume_preferences       jsonb       default '{}',
  updated_at               timestamptz default now()
);

alter table user_settings enable row level security;

create policy "user_settings: select own row"
  on user_settings for select
  using (auth.uid() = user_id);

create policy "user_settings: insert own row"
  on user_settings for insert
  with check (auth.uid() = user_id);

create policy "user_settings: update own row"
  on user_settings for update
  using (auth.uid() = user_id);


-- ---------------------------------------------------------------------------
-- source_profiles
-- ---------------------------------------------------------------------------

create table source_profiles (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users(id) on delete cascade,
  slug         text        not null,
  label        text        not null,
  calcium      numeric     default 0,
  magnesium    numeric     default 0,
  potassium    numeric     default 0,
  sodium       numeric     default 0,
  sulfate      numeric     default 0,
  chloride     numeric     default 0,
  bicarbonate  numeric     default 0,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now(),
  unique(user_id, slug)
);

alter table source_profiles enable row level security;

create policy "source_profiles: select own rows"
  on source_profiles for select
  using (auth.uid() = user_id);

create policy "source_profiles: insert own rows"
  on source_profiles for insert
  with check (auth.uid() = user_id);

create policy "source_profiles: update own rows"
  on source_profiles for update
  using (auth.uid() = user_id);

create policy "Users can delete own source profiles"
  on source_profiles for delete
  using (auth.uid() = user_id);


-- ---------------------------------------------------------------------------
-- target_profiles
-- ---------------------------------------------------------------------------

create table target_profiles (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users(id) on delete cascade,
  slug         text        not null,
  label        text        not null,
  brew_method  text        default 'filter',
  calcium      numeric     default 0,
  magnesium    numeric     default 0,
  alkalinity   numeric     default 0,
  description  text        default '',
  created_at   timestamptz default now(),
  updated_at   timestamptz default now(),
  unique(user_id, slug)
);

alter table target_profiles enable row level security;

create policy "target_profiles: select own rows"
  on target_profiles for select
  using (auth.uid() = user_id);

create policy "target_profiles: insert own rows"
  on target_profiles for insert
  with check (auth.uid() = user_id);

create policy "target_profiles: update own rows"
  on target_profiles for update
  using (auth.uid() = user_id);

create policy "Users can delete own target profiles"
  on target_profiles for delete
  using (auth.uid() = user_id);


-- ---------------------------------------------------------------------------
-- user_selections
-- ---------------------------------------------------------------------------

create table user_selections (
  user_id                uuid        primary key references auth.users(id) on delete cascade,
  source_preset          text        default 'distilled',
  source_water           jsonb       default '{}',
  target_preset          text        default 'sca',
  deleted_source_presets jsonb       default '[]',
  deleted_target_presets jsonb       default '[]',
  updated_at             timestamptz default now()
);

alter table user_selections enable row level security;

create policy "user_selections: select own row"
  on user_selections for select
  using (auth.uid() = user_id);

create policy "user_selections: insert own row"
  on user_selections for insert
  with check (auth.uid() = user_id);

create policy "user_selections: update own row"
  on user_selections for update
  using (auth.uid() = user_id);
