# Cafelytic — Supabase Integration Plan

## Overview

Add user accounts (email, Google, Apple sign-in) to cafelytic.com using Supabase, enabling cross-device sync of all user data. Anonymous users retain full access; logging in adds cloud sync. The architecture supports gating features behind login in the future.

---

## Phase 1: Supabase Project Setup

### 1.1 Create the Supabase project
- Sign up at supabase.com, create a new project
- Note your project URL and anon (public) API key — these go in your frontend code
- The anon key is safe to expose in client-side JS; row-level security (RLS) protects data

### 1.2 Configure auth providers

**Email/password** — enabled by default. In the Supabase dashboard under Authentication → Providers, configure:
- Confirm email: ON (sends a verification link)
- Site URL: `https://cafelytic.com`
- Redirect URLs: `https://cafelytic.com/login.html`

**Google OAuth:**
1. Go to Google Cloud Console → APIs & Services → Credentials
2. Create an OAuth 2.0 Client ID (Web application)
3. Set authorized redirect URI: `https://<your-supabase-project>.supabase.co/auth/v1/callback`
4. Copy the Client ID and Client Secret into Supabase dashboard → Auth → Providers → Google

**Apple Sign-In:**
1. Requires Apple Developer Account ($99/year)
2. Create a Services ID in the Apple Developer portal
3. Configure the domain and redirect URI (same pattern as Google)
4. Copy credentials into Supabase dashboard → Auth → Providers → Apple
5. Recommendation: implement this last since it has the most setup overhead

---

## Phase 2: Database Schema

All tables use the user's Supabase auth UUID as a foreign key. RLS policies ensure users can only access their own rows.

### 2.1 Tables

```sql
-- User preferences (one row per user)
create table user_settings (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  theme         text default 'system',
  mineral_display_mode text default 'standard',
  brew_method   text default 'filter',
  lotus_dropper_type text default 'round',
  selected_minerals jsonb default '["calcium-chloride","epsom-salt","baking-soda","potassium-bicarbonate"]',
  selected_concentrates jsonb default '[]',
  diy_concentrate_specs jsonb default '{}',
  lotus_concentrate_units jsonb default '{}',
  volume_preferences jsonb default '{}',
  updated_at    timestamptz default now()
);

-- Source water profiles (custom profiles created by the user)
create table source_profiles (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  slug          text not null,
  label         text not null,
  calcium       numeric default 0,
  magnesium     numeric default 0,
  potassium     numeric default 0,
  sodium        numeric default 0,
  sulfate       numeric default 0,
  chloride      numeric default 0,
  bicarbonate   numeric default 0,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  unique(user_id, slug)
);

-- Target water profiles (custom profiles created by the user)
create table target_profiles (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  slug          text not null,
  label         text not null,
  brew_method   text default 'filter',
  calcium       numeric default 0,
  magnesium     numeric default 0,
  alkalinity    numeric default 0,
  description   text default '',
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  unique(user_id, slug)
);

-- Active selections (which preset is currently active)
create table user_selections (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  source_preset        text default 'distilled',
  source_water         jsonb default '{}',
  target_preset        text default 'sca',
  deleted_source_presets jsonb default '[]',
  deleted_target_presets jsonb default '[]',
  updated_at           timestamptz default now()
);
```

### 2.2 Row-Level Security policies

```sql
-- Repeat this pattern for each table:
alter table user_settings enable row level security;

create policy "Users can read own settings"
  on user_settings for select
  using (auth.uid() = user_id);

create policy "Users can insert own settings"
  on user_settings for insert
  with check (auth.uid() = user_id);

create policy "Users can update own settings"
  on user_settings for update
  using (auth.uid() = user_id);

-- Same pattern for source_profiles, target_profiles, user_selections
```

### 2.3 Mapping from current localStorage keys to tables

| localStorage key | Supabase table | Column |
|---|---|---|
| `cw_theme` | `user_settings` | `theme` |
| `cw_mineral_display_mode` | `user_settings` | `mineral_display_mode` |
| `cw_brew_method` | `user_settings` | `brew_method` |
| `cw_lotus_dropper_type` | `user_settings` | `lotus_dropper_type` |
| `cw_selected_minerals` | `user_settings` | `selected_minerals` |
| `cw_selected_concentrates` | `user_settings` | `selected_concentrates` |
| `cw_diy_concentrate_specs` | `user_settings` | `diy_concentrate_specs` |
| `cw_lotus_concentrate_units` | `user_settings` | `lotus_concentrate_units` |
| `cw_volume_*` | `user_settings` | `volume_preferences` |
| `cw_custom_profiles` | `source_profiles` | one row per profile |
| `cw_custom_target_profiles` | `target_profiles` | one row per profile |
| `cw_source_preset` | `user_selections` | `source_preset` |
| `cw_source_water` | `user_selections` | `source_water` |
| `cw_target_preset` | `user_selections` | `target_preset` |
| `cw_deleted_presets` | `user_selections` | `deleted_source_presets` |
| `cw_deleted_target_presets` | `user_selections` | `deleted_target_presets` |

---

## Phase 3: Frontend — Auth SDK & Login Page

### 3.1 Add Supabase JS SDK

Add to every HTML page's `<head>`, before other scripts:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
```

### 3.2 Create `supabase-client.js`

A new file that initializes the Supabase client and exposes auth helpers:

```js
const SUPABASE_URL = 'https://<your-project>.supabase.co';
const SUPABASE_ANON_KEY = '<your-anon-key>';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function getUser() {
  return supabase.auth.getUser();
}

function isLoggedIn() {
  return supabase.auth.getSession().then(({ data }) => !!data.session);
}

async function signInWithEmail(email, password) {
  return supabase.auth.signInWithPassword({ email, password });
}

async function signUpWithEmail(email, password) {
  return supabase.auth.signUp({ email, password });
}

async function signInWithGoogle() {
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: 'https://cafelytic.com/login.html' }
  });
}

async function signInWithApple() {
  return supabase.auth.signInWithOAuth({
    provider: 'apple',
    options: { redirectTo: 'https://cafelytic.com/login.html' }
  });
}

async function signOut() {
  return supabase.auth.signOut();
}
```

### 3.3 Create `login.html`

A dedicated login page with:
- Email/password form (sign in + sign up toggle)
- "Continue with Google" button
- "Continue with Apple" button (add later)
- On successful auth, redirect to `index.html`
- Style consistently with existing pages (use `style.css`, include nav)

### 3.4 Update navigation

In `ui-shared.js`, add a login/account link to the nav:
- If logged out: show "Log in" link pointing to `login.html`
- If logged in: show user email/avatar and a "Log out" button
- Check auth state with `supabase.auth.getSession()` on page load

---

## Phase 4: Sync Layer

This is the core architectural change. The goal: every save/load function in `storage.js` continues to work with localStorage for anonymous users, but also syncs to Supabase when logged in.

### 4.1 Strategy: localStorage-first, async cloud sync

The app should never feel slower because of the network. The approach:
1. **All reads** come from localStorage (instant, as today)
2. **All writes** go to localStorage immediately, then async push to Supabase if logged in
3. **On login**, pull cloud data and merge with local data
4. **On page load** (if logged in), pull latest cloud data in the background

### 4.2 Create `sync.js`

A new file that handles all cloud sync logic:

```js
// Debounced sync — waits 2 seconds after the last write before pushing to cloud
let syncTimer = null;

function scheduleSyncToCloud() {
  if (!syncTimer) {
    syncTimer = setTimeout(async () => {
      syncTimer = null;
      await pushAllToCloud();
    }, 2000);
  }
}

async function pushAllToCloud() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;
  const userId = session.user.id;

  // Push user_settings
  await supabase.from('user_settings').upsert({
    user_id: userId,
    theme: safeGetItem('cw_theme') || 'system',
    mineral_display_mode: loadMineralDisplayMode(),
    brew_method: loadBrewMethod(),
    lotus_dropper_type: loadLotusDropperType(),
    selected_minerals: loadSelectedMinerals(),
    selected_concentrates: loadSelectedConcentrates(),
    diy_concentrate_specs: loadDiyConcentrateSpecs(),
    lotus_concentrate_units: loadLotusConcentrateUnits(),
    volume_preferences: buildVolumePreferencesObject(),
    updated_at: new Date().toISOString()
  });

  // Push user_selections
  await supabase.from('user_selections').upsert({
    user_id: userId,
    source_preset: loadSourcePresetName(),
    source_water: loadSourceWater(),
    target_preset: loadTargetPresetName(),
    deleted_source_presets: loadDeletedPresets(),
    deleted_target_presets: loadDeletedTargetPresets(),
    updated_at: new Date().toISOString()
  });

  // Push custom source profiles
  await syncCustomProfiles(userId, 'source_profiles', loadCustomProfiles());
  await syncCustomProfiles(userId, 'target_profiles', loadCustomTargetProfiles());
}

async function pullFromCloud() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;
  const userId = session.user.id;

  // Pull settings
  const { data: settings } = await supabase
    .from('user_settings')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (settings) {
    safeSetItem('cw_theme', settings.theme);
    safeSetItem('cw_mineral_display_mode', settings.mineral_display_mode);
    safeSetItem('cw_brew_method', settings.brew_method);
    // ... etc for each field
  }

  // Pull selections, profiles similarly
  // Invalidate all caches after pull
}
```

### 4.3 Modify `storage.js` save functions

Every `save*` function gets one extra line at the end:

```js
function saveSelectedMinerals(mineralIds) {
  safeSetItem("cw_selected_minerals", JSON.stringify(mineralIds));
  selectedMineralsCache = null;
  if (typeof scheduleSyncToCloud === 'function') scheduleSyncToCloud(); // NEW
}
```

This is minimally invasive — the existing logic doesn't change, and the sync call is fire-and-forget.

### 4.4 First-login merge

When a user logs in for the first time, they may have local data from anonymous use. The merge logic:

1. Check if cloud data exists for this user
2. If no cloud data: push local data to cloud (first-time setup)
3. If cloud data exists and local data is default: pull cloud data (returning user on new device)
4. If both have non-default data: prompt user to choose "Keep local data" or "Use cloud data"

---

## Phase 5: Login Page UI

### 5.1 File: `login.html`

The page structure:
- Standard Cafelytic header + nav
- A centered card containing:
  - Toggle between "Sign in" and "Create account" modes
  - Email input field
  - Password input field
  - Submit button
  - Divider ("or")
  - "Continue with Google" button (styled)
  - "Continue with Apple" button (styled, added later)
  - Error message display area
- After successful login: redirect to the page they came from (or index.html)

### 5.2 Auth state in the nav bar

In `ui-shared.js`, modify `injectNav()` to add an auth element after the nav-links:

```js
// After creating nav-links...
const authEl = document.createElement("div");
authEl.className = "nav-auth";
authEl.innerHTML = '<a href="login.html" class="nav-login-link">Log in</a>';
nav.appendChild(authEl);

// Then async check session and update
if (typeof supabase !== 'undefined') {
  supabase.auth.getSession().then(({ data }) => {
    if (data.session) {
      authEl.innerHTML = `
        <span class="nav-user-email">${data.session.user.email}</span>
        <button class="nav-logout-btn" onclick="signOut().then(() => location.reload())">Log out</button>
      `;
    }
  });
}
```

---

## Phase 6: Script Loading Order

Updated `<head>` for every HTML page:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="supabase-client.js"></script>
<script src="theme-init.js"></script>
```

Updated bottom-of-body script order:

```html
<script src="constants.js"></script>
<script src="storage.js"></script>
<script src="sync.js"></script>       <!-- NEW: after storage, before UI -->
<script src="metrics.js"></script>
<script src="ui-shared.js"></script>
<script src="source-water-ui.js"></script>
<script src="script.js"></script>
```

---

## Phase 7: Future — Feature Gating

When you're ready to gate features behind login, add a helper:

```js
function requireAuth(featureName) {
  return isLoggedIn().then(loggedIn => {
    if (!loggedIn) {
      // Show a prompt: "Log in to use {featureName}"
      // with a link to login.html?redirect={current page}
      return false;
    }
    return true;
  });
}
```

Then wrap gated features:

```js
requireAuth('Taste Tuner').then(ok => {
  if (ok) initTasteTuner();
});
```

---

## Implementation Order (Recommended)

| Step | What | Files touched | Effort |
|------|-------|--------------|--------|
| 1 | Create Supabase project + configure email auth | Dashboard only | 30 min |
| 2 | Run SQL to create tables + RLS policies | Supabase SQL editor | 30 min |
| 3 | Add Supabase SDK + `supabase-client.js` | All HTML files, new JS file | 1 hr |
| 4 | Build `login.html` with email sign-in | New HTML file, style.css | 2-3 hrs |
| 5 | Add auth state to nav bar | ui-shared.js, style.css | 1 hr |
| 6 | Build `sync.js` with push/pull logic | New JS file | 3-4 hrs |
| 7 | Add `scheduleSyncToCloud()` calls to storage.js | storage.js | 1 hr |
| 8 | Build first-login merge flow | sync.js | 2-3 hrs |
| 9 | Configure Google OAuth | Dashboard + Google Cloud Console | 1 hr |
| 10 | Configure Apple Sign-In | Dashboard + Apple Developer Portal | 2 hrs |
| 11 | Test end-to-end across devices | — | 2-3 hrs |

**Total estimated effort: 15-20 hours**

---

## New Files Summary

| File | Purpose |
|------|---------|
| `supabase-client.js` | Supabase client init + auth helper functions |
| `sync.js` | Cloud sync logic (push, pull, merge) |
| `login.html` | Dedicated login/signup page |

## Modified Files Summary

| File | Changes |
|------|---------|
| `storage.js` | Add `scheduleSyncToCloud()` call to each save function |
| `ui-shared.js` | Add auth state display to nav bar |
| `style.css` | Add login page styles, nav auth element styles |
| All HTML files | Add Supabase SDK + `supabase-client.js` script tags |
