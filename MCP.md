# Cafelytic MCP server

Lets a user connect an AI app (Claude, ChatGPT, any MCP client) to their own Cafelytic account. The server is the Supabase Edge Function in `supabase/functions/mcp/`; sign-in is OAuth 2.1 against this project's Supabase Auth, so every tool call runs as the signed-in user under row-level security.

Endpoint once deployed: `https://srlwgayrxzamxlodpsrq.supabase.co/functions/v1/mcp`

## Status

Phases 1, 1b, 2 and 3 (this code): reads, analysis, dose calculation, private recipe / source-water writes, concentrates, and the active selections. Built in the public shape (per-user sign-in, no admin powers), used by the owner only for now.

| Phase | Scope | State |
|---|---|---|
| 1 | Read recipes, source waters, minerals, concentrates; `analyze_water`; create / update private recipes and saved source waters | Built |
| 1b | `calculate_doses`: the Calculator page's dose math, moved into a shared module (`src/lib/dosing.ts`) that the page and the server both call | Built |
| 2 | Derive a concentrate formula from a recipe; create / update Recipe Concentrates and Mineral Concentrates, through a database function that merges one concentrate into `user_settings` atomically | Built |
| 3 | Change the active selections: switch a mineral or a concentrate on or off, choose the active recipe and the active source water, each through its own narrow database function | Built |

### Before this is offered to the public

- **Write quotas are in the database** (`supabase/migrations/20261123064216_mcp_write_quota_and_app_consent.sql`). A trigger on `target_profiles`, `source_profiles`, `user_settings` and `user_selections` counts every row a connected app's request writes: 100 per user per UTC day across all of that user's apps (SQLSTATE `MCQ01` when over), and a connected app cannot add a recipe to an account holding 500, or a source water to one holding 100 (`MCQ02`). The app itself is never counted or limited. A new function that writes one of those tables for a connected app is counted with no further work; its tool should pass the error through `quotaError` (`supabase/functions/mcp/logic.ts`). Reads are not limited.
- Supabase's OAuth 2.1 server is still beta. Known gaps as of 2026-11: access tokens are not bound to this server (`aud` is always `authenticated`), and clients register through dynamic registration only.
- The consent page lists what a connected app can do. It must be updated in the same change as any new write tool.
- **New abilities are asked for per app.** Supabase records that a user approved an app, not what the consent page listed. So the list is versioned (`public.mcp_abilities_version()`, 2 today: version 2 added phase 3's switches) and the consent page records the version the user approved for each app (`public.mcp_app_consent`, written by `mcp_record_app_consent`, which refuses connected apps). To ship a new ability: raise the version in its migration, gate its database function with `public.mcp_app_allows(<that version>)`, add the line to `oauth/consent.html`, and give the Connected apps list a way to approve the new abilities for an app recorded at a lower version. The Connected apps list (`src/components/oauth-consent.ts`) does that last part for any ability: an app recorded below the current version shows an "Allow new abilities" button that records the current version. Until the user presses it, that app's calls to a gated function are refused with SQLSTATE `MCA01` and the tool tells the user where to approve. An approval is tied to the list the user saw: the page sends the version it shows (`SHOWN_ABILITIES_VERSION` in `src/lib/consent-abilities.ts`) and `mcp_record_app_consent` refuses a different or missing one with `MCA02`, writing nothing. So a new version also needs, in the same change, `SHOWN_ABILITIES_VERSION` raised to match the database and the new abilities' wording added to `ABILITIES_ADDED` in that file; without the wording the Connected apps list has nothing to show and offers no button. `tests/consent-abilities.test.ts` fails when either is missed. An app with no record counts as version 1.
- Concentrates are also capped per account by count (50 Recipe Concentrates, 20 Mineral Concentrates, in `mcp_save_concentrate`).
- The privacy policy has a "Connected AI apps" section (`privacy/index.html`). Keep it true when abilities change.

## What a connected app can and cannot do

Enforced twice: in the tool code, and in the database by `supabase/migrations/20261122200921_restrict_oauth_client_access.sql`. The database rules matter because the token an AI app holds is the user's own Supabase JWT (plus a `client_id` claim), which the REST API accepts directly; anything enforced only in tool code could be skipped.

| | Connected AI app | The Cafelytic app |
|---|---|---|
| Read own data and the public library | Yes | Yes |
| Create / change private recipes | Yes | Yes |
| Create / change saved source waters | Yes | Yes |
| Publish a recipe, or change a published one | No | Yes |
| Delete a recipe or source water | No | Yes |
| Create / change concentrates, one at a time | Yes | Yes |
| Delete a concentrate | No | Yes |
| Switch a mineral or a concentrate on or off, one at a time | Yes; a concentrate only if it exists and is fully set up | Yes |
| Choose the active recipe (own or official library) | Yes; the brew method follows the recipe | Yes |
| Choose the active source water (saved or built-in) | Yes | Yes |
| Bring back something the user removed (the delete lists) | No | Yes |
| Write any other setting (theme, units, drafts, hand-typed "custom" water or target) | No | Yes |
| Delete the account | No | Yes |

`supabase/tests/oauth_client_restrictions.test.sql`, `supabase/tests/mcp_save_concentrate.test.sql` and `supabase/tests/mcp_set_selections.test.sql` pin every row of that table (`supabase test db`). `supabase/tests/mcp_write_quota_and_app_consent.test.sql` pins the daily limit, the account ceilings and the per-app approval record; `mcp_set_selections.test.sql` pins the version 2 gate.

## Tools

| Tool | Writes? | Notes |
|---|---|---|
| `list_recipes`, `get_recipe` | No | Own, official library, and community recipes, with GH / KH / TDS |
| `list_source_waters` | No | Built-in and saved |
| `list_minerals`, `list_concentrates` | No | |
| `analyze_water` | No | Metrics, the app's range findings, and a charge-balance check |
| `calculate_doses` | No | What to add to a source water to make a recipe: the Calculator page's own math, with the minerals and concentrates the user enabled in the app (or a `minerals` list). Amounts are what the app's rows show (grams to 0.01, whole drops or mL). With no source water named it uses the values the app's Starting Water fields hold (`user_selections.source_water`), which is what the Calculator doses from, unsaved edits included; a named source water is the saved profile |
| `create_recipe`, `update_recipe` | Yes | Private only. Names follow the app's rules; a deleted name's key is never reused |
| `create_source_water`, `update_source_water` | Yes | |
| `derive_concentrate_formula` | No | The app's own "make a concentrate from this recipe" formula, weighed in the calcium chloride form the user has as a powder |
| `create_recipe_concentrate`, `update_recipe_concentrate` | Yes | Saved but not switched on. An update changes only the fields sent and returns the values before. Solubility warnings are the app's |
| `save_mineral_concentrate` | Yes | One per mineral: creates it, or changes the fields sent |
| `set_mineral_enabled`, `set_concentrate_enabled` | Yes | Switch one mineral powder or one concentrate on or off. Switching a concentrate on needs it to exist and be fully set up; several Recipe Concentrates can be on at once, as in the app. The reply lists everything that is now on |
| `set_active_recipe` | Yes | The user's own recipes and official library recipes (added to the user's recipe list when not on it). Another user's community recipe, a recipe the user removed, and a library recipe the user has their own version of are refused. Switches the app's brew method when the recipe is for the other one, and says so |
| `set_active_source_water` | Yes | A saved or built-in source water. Sets the key and the Starting Water values together, replacing values typed there without saving; the reply shows what was there before |

Chemistry and naming rules are not re-implemented: `src/lib/mcp-core.ts` re-exports the app's own functions, and `npm run mcp:build` bundles them into `supabase/functions/mcp/app-core.gen.js` (committed; `npm test` fails when it is stale). Only re-export functions that take every input as an argument: one that falls back to browser storage would silently use defaults on the server.

Doses work the same way. `computeDoses` (`src/lib/dosing.ts`) is the one copy of the dose math: the Calculator page gathers its inputs and renders the result, and `calculate_doses` calls it with a kit built from the user's synced `user_settings` row (`buildDosingKit`). The rules for which salts a kit can dose from, and each concentrate's strength and dropper size, live in `src/lib/mineral-sources.ts`; `storage.ts` applies them to the browser's saved selection. `tests/dosing.test.ts` pins the doses for the canonical recipes in a committed table and checks that a kit built from settings matches the one the page builds.

## How writes coexist with app sync

- **New recipes and source waters are safe.** Each is its own row; no device deletes a row it does not know, and every device adopts it on its next pull.
- **A key that was deleted is never reused.** Every device holding the deletion record would delete the new row on its next sync, so `create_*` picks a fresh key (`name-2`) and keeps the typed name.
- **An update can lose to a stale device.** This applies to `update_recipe` and `update_source_water` alike, on every app version (the merged push below covers only the settings and selections rows). Recipe and source water sync is last-write-wins per row with no timestamp check, and a device pushes its pending edits before it pulls: a device with an unsynced edit to the same recipe or source water writes its whole cached row back, overwriting the value the tool just saved (including fields that device never touched). The update tools themselves write only the fields they were sent, so they do not do this to the app. Fixing it properly belongs in the sync layer (per-field merge or an `updated_at` check) and is not part of this work.
- **Profile keys that are JavaScript object property names are never issued** (`constructor`, `toString`, ...). The app keeps profiles in plain objects, so a profile under such a key reads as a built-in and is dropped from the picker. The server gives it `constructor-2` instead.
- **`user_settings` and `user_selections` are off limits to direct writes.** Each is one row per user that every device writes, and installed apps up to 1.2.2 upsert it whole, so any outside write races them. The database functions below are the only ways in.
- **An ordinary save from the app no longer undoes these writes; installed apps up to 1.2.2 still can.** Since the merged push (`pushSingleRow` in `src/lib/sync.ts`), a save reads the row, keeps the cloud's value for every field the device has not changed since it last synced, and writes on condition that the row has not changed since that read. So a device that missed a write from one of the functions below keeps it when it next saves, whether it held an unsynced change at the time or was in sync and edited something later. `tests/sync-push-merge.test.ts` pins each function against a stale device on current code and on the frozen 1.2 sync. This is how a normal save behaves, not a guarantee for every write. Current code still overwrites in these cases:
  - When both changed the same thing (the same concentrate, the same switch, the Starting Water), the device's change wins.
  - Things that only make sense together go to the device as a pair. If the device changed its active recipe or its brew method, both stay the device's, so `set_active_recipe` is undone whole and never left with the recipe from one side and the brew method from the other. If the device deleted a concentrate that `set_concentrate_enabled` switched on meanwhile, the switch goes with it. If the device removed the recipe or source water that was made active here, the device's own choice stands.
  - A device with no sync base for the row (it has never pulled it, or the stored base cannot be read) sends the whole row.
  - The first sign-in merge's "Keep both" push sends the whole row. It folds the account's concentrates in first, but not the account's switches or active selections.
  - A concentrate the account no longer holds is not sent back, so one wiped by an old app's whole-row write stays gone (pinned in the same test file).

  So when a change made here has gone missing, a current device is not ruled out. The website runs the merged push as soon as it is deployed. A phone app gets it with the first release built after it, and an installed app at 1.2.2 or older keeps writing the whole row for as long as it is installed, so the two "stale device" limits below apply to those in full.
- **Concentrates go through one database function.** `public.mcp_save_concentrate` (`supabase/migrations/20261123013834_mcp_save_concentrate.sql`) sets one key in one of the two concentrate maps in a single statement, merging into whatever the row holds at that moment, and stores a spec it rebuilt from checked fields. It cannot remove a concentrate, switch one on, or touch another setting, so it can never cost the user something they already had. An update also says which spec it was built from, and is refused if the stored one has changed since; the tool then reads again and retries, so two changes to different fields of one concentrate both land.
- **A saved concentrate can still be dropped by a stale device on an old app.** An app at 1.2.2 or older saves the settings row whole. Such a device that has not pulled since the save, and then pushes any settings change (one made while offline, a save that was mid-flight, or simply the next brew volume the user types before the device has caught up), writes its copy of the concentrate maps back and the newly saved concentrate is gone; an update to an existing one is reverted the same way. Devices that pull first pick the concentrate up. The tool replies ask the user to check the app and name an old app as one possible cause, and saving again fixes it. A normal save from current code does not do this (see the merged push above, and its exceptions).

- **Selections go through three database functions** (`supabase/migrations/20261123180000_mcp_set_selections.sql`). Each locks the caller's row and changes only its own fields in one statement, keeping everything else as it is at that moment:
  - `mcp_set_enabled` adds or removes ONE id in `selected_minerals` or `selected_concentrates`. Switching a concentrate on requires its spec to exist with a bottle size, strength and (for a Recipe Concentrate) at least one mineral. Switching off removes that exact id, so an entry left behind by a deleted concentrate can be cleared.
  - `mcp_set_active_recipe` sets `target_preset` to a recipe the app can show on this account's rail: the caller's own, or an official library recipe (appended to `added_target_presets` when it is outside the starter set). It also sets `user_settings.brew_method` when the recipe is for the other brew method, because the app lists a recipe only in its own mode and falls back to another recipe (saving that choice) when the active one is not listed.
  - `mcp_set_active_source_water` sets `source_preset` and `source_water` together. A saved water's values come from its row. Any other key must be one of the app's built-in waters, from a list the function carries; a key that is neither is refused, so a key the app does not know is never stored. A built-in's values live in the app's code, not the database, so the server sends them and the function checks and rebuilds them; called directly with an AI app's token, the most it allows is a built-in's name over what typing numbers into the Starting Water fields does.
  - None of them writes the delete lists, so nothing the user removed comes back, and none can set the hand-typed "custom" recipe or water.
  - Each is gated with `public.mcp_app_allows(2)`: an app the user approved before these abilities were on the consent page (or with no recorded approval) is refused with SQLSTATE `MCA01` and nothing is written, until the user presses "Allow new abilities" for it on the Connected apps page. The tools turn that refusal into a message saying so. An app approved between this change going live on the website and `supabase db push` saw the new list but is recorded at version 1, so it needs the button too.
  - Their writes are counted by the daily limit like any other write from a connected app (two rows when `set_active_recipe` also switches the brew method); a refused call is not counted.
  - The mineral ids and brand concentrate ids the app knows live in the app's code (`src/lib/constants.ts`), so `mcp_set_enabled` carries its own copy and switches on nothing else. `mcp_set_active_source_water` carries the built-in source water keys the same way. `tests/mcp-selection-ids.test.ts` fails when a list differs from the app's: a new mineral, brand concentrate or built-in source water needs a migration that re-creates the function with the longer list.
- **A selection can be put back by a stale device on an old app.** The same whole-row save as above, from an app at 1.2.2 or older: a device that has not pulled since the change and then pushes anything in `user_settings` (or `user_selections`) writes its copy back, and the switch, active recipe or active source water returns to what that device had. Nothing is lost, `calculate_doses` always reads the live rows so its doses match what is actually switched on, and every reply asks the user to check the app. A normal save from current code keeps the change (see the merged push above, and its exceptions). On any version, a device adopts the change on its next pull or Realtime event, and a Calculator page that is already open keeps showing the recipe it had until it is reloaded.

## One-time setup (hosted project)

Done by the project owner; Claude does not deploy functions or push migrations.

1. **Supabase dashboard > Authentication > OAuth Server**: enable it, Site URL `https://cafelytic.com`, authorization path `/oauth/consent`. Leave **Allow Dynamic OAuth Apps** off until step 5.
2. Merge the change so `cafelytic.com/oauth/consent` is live.
3. `supabase db push` (applies the restriction migration and the functions the write tools call), then `supabase migration list` to confirm every migration is on Local and Remote. A later phase is the same two steps in the same order: `db push` first, then `functions deploy mcp`, so no tool is live before its database function.
4. `supabase functions deploy mcp` (needs Supabase CLI 2.117.0 or later on the 2.x line; the repo's `config.toml` is not yet migrated for CLI 3).
5. Turn **Allow Dynamic OAuth Apps** on. Only now can an AI app complete a sign-in.
6. Connect a client to the endpoint above. In Claude Code: `claude mcp add --transport http cafelytic https://srlwgayrxzamxlodpsrq.supabase.co/functions/v1/mcp`, then `/mcp` to sign in.

The project already signs JWTs with an asymmetric key (ES256), which the server requires.

To disconnect an app: `cafelytic.com/oauth/consent` with no parameters lists connected apps with a Disconnect button. An app connected before an ability was added also shows what was added and an "Allow new abilities" button.

## Local walkthrough

```bash
supabase start
```

```bash
supabase db reset
```

```bash
supabase test db
```

The stack serves the function at `http://127.0.0.1:54321/functions/v1/mcp`. An unauthenticated request must return `401` with a `WWW-Authenticate: Bearer resource_metadata=...` header; `.../mcp/oauth-protected-resource` returns the discovery document.

The web client is hardwired to the hosted project, so exercising the consent page against the local stack means temporarily pointing `SUPABASE_URL` / the key in `src/lib/supabase-client.ts` at `http://localhost:54321` and adding that origin to `connect-src` in `partials/head-top.html`. Never commit that.

Unit tests for the server's pure logic: `deno test --allow-env --no-check` inside `supabase/functions/`.
