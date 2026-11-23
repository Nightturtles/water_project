# Cafelytic MCP server

Lets a user connect an AI app (Claude, ChatGPT, any MCP client) to their own Cafelytic account. The server is the Supabase Edge Function in `supabase/functions/mcp/`; sign-in is OAuth 2.1 against this project's Supabase Auth, so every tool call runs as the signed-in user under row-level security.

Endpoint once deployed: `https://srlwgayrxzamxlodpsrq.supabase.co/functions/v1/mcp`

## Status

Phases 1, 1b and 2 (this code): reads, analysis, dose calculation, private recipe / source-water writes, and concentrates. Built in the public shape (per-user sign-in, no admin powers), used by the owner only for now.

| Phase | Scope | State |
|---|---|---|
| 1 | Read recipes, source waters, minerals, concentrates; `analyze_water`; create / update private recipes and saved source waters | Built |
| 1b | `calculate_doses`: the Calculator page's dose math, moved into a shared module (`src/lib/dosing.ts`) that the page and the server both call | Built |
| 2 | Derive a concentrate formula from a recipe; create / update Recipe Concentrates and Mineral Concentrates, through a database function that merges one concentrate into `user_settings` atomically | Built |
| 3 | Maybe: change the active selection (recipe, source water, minerals) | Undecided |

### Before this is offered to the public

- **Write quotas are not implemented.** Deferred on purpose while there is one user. Add a per-user daily cap and a per-account ceiling (same pattern as `estimate_water_quota`) first.
- Supabase's OAuth 2.1 server is still beta. Known gaps as of 2026-11: access tokens are not bound to this server (`aud` is always `authenticated`), and clients register through dynamic registration only.
- The consent page lists what a connected app can do. It must be updated in the same change as any new write tool.
- An app that was connected before a new capability shipped gets that capability without being asked again (a grant is not tied to the list the user saw). Fine with one user; decide before going public whether adding a capability should revoke existing grants.
- Concentrate saves are capped per account by count only (50 Recipe Concentrates, 20 Mineral Concentrates, in `mcp_save_concentrate`); there is no rate limit.
- The privacy policy does not mention connected AI apps yet.

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
| Delete a concentrate, or switch one on or off | No | Yes |
| Write any other setting or the active selections | No (phase 3, undecided) | Yes |
| Delete the account | No | Yes |

`supabase/tests/oauth_client_restrictions.test.sql` and `supabase/tests/mcp_save_concentrate.test.sql` pin every row of that table (`supabase test db`).

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

Chemistry and naming rules are not re-implemented: `src/lib/mcp-core.ts` re-exports the app's own functions, and `npm run mcp:build` bundles them into `supabase/functions/mcp/app-core.gen.js` (committed; `npm test` fails when it is stale). Only re-export functions that take every input as an argument: one that falls back to browser storage would silently use defaults on the server.

Doses work the same way. `computeDoses` (`src/lib/dosing.ts`) is the one copy of the dose math: the Calculator page gathers its inputs and renders the result, and `calculate_doses` calls it with a kit built from the user's synced `user_settings` row (`buildDosingKit`). The rules for which salts a kit can dose from, and each concentrate's strength and dropper size, live in `src/lib/mineral-sources.ts`; `storage.ts` applies them to the browser's saved selection. `tests/dosing.test.ts` pins the doses for the canonical recipes in a committed table and checks that a kit built from settings matches the one the page builds.

## How writes coexist with app sync

- **New recipes and source waters are safe.** Each is its own row; no device deletes a row it does not know, and every device adopts it on its next pull.
- **A key that was deleted is never reused.** Every device holding the deletion record would delete the new row on its next sync, so `create_*` picks a fresh key (`name-2`) and keeps the typed name.
- **An update can lose to a stale device.** This applies to `update_recipe` and `update_source_water` alike. Sync is last-write-wins per row with no timestamp check, and a device pushes its pending edits before it pulls: a device with an unsynced edit to the same recipe or source water writes its whole cached row back, overwriting the value the tool just saved (including fields that device never touched). The update tools themselves write only the fields they were sent, so they do not do this to the app. Fixing it properly belongs in the sync layer (per-field merge or an `updated_at` check) and is not part of this work.
- **Profile keys that are JavaScript object property names are never issued** (`constructor`, `toString`, ...). The app keeps profiles in plain objects, so a profile under such a key reads as a built-in and is dropped from the picker. The server gives it `constructor-2` instead.
- **`user_settings` and `user_selections` are off limits to direct writes.** Each is one row per user that devices upsert whole, so any outside write races them.
- **Concentrates go through one database function.** `public.mcp_save_concentrate` (`supabase/migrations/20261123013834_mcp_save_concentrate.sql`) sets one key in one of the two concentrate maps in a single statement, merging into whatever the row holds at that moment, and stores a spec it rebuilt from checked fields. It cannot remove a concentrate, switch one on, or touch another setting, so it can never cost the user something they already had.
- **A saved concentrate can still be dropped by a stale device.** The app saves the settings row whole. A device with unsynced settings changes (it was offline, or a save was mid-flight) writes its copy of the concentrate maps back and the newly saved concentrate is gone; an update to an existing one is reverted the same way. Devices without pending changes pick the concentrate up on their next pull or Realtime event. Accepted on 2026-11-22 instead of changing sync: the tool replies ask the user to check the app, and saving again fixes it. The proper fix is a per-item merge of the concentrate maps in `src/lib/sync.ts`, which installed apps would not get until their next release.

## One-time setup (hosted project)

Done by the project owner; Claude does not deploy functions or push migrations.

1. **Supabase dashboard > Authentication > OAuth Server**: enable it, Site URL `https://cafelytic.com`, authorization path `/oauth/consent`. Leave **Allow Dynamic OAuth Apps** off until step 5.
2. Merge the change so `cafelytic.com/oauth/consent` is live.
3. `supabase db push` (applies the restriction migration), then `supabase migration list` to confirm it is on Local and Remote.
4. `supabase functions deploy mcp` (needs Supabase CLI 2.117.0 or later on the 2.x line; the repo's `config.toml` is not yet migrated for CLI 3).
5. Turn **Allow Dynamic OAuth Apps** on. Only now can an AI app complete a sign-in.
6. Connect a client to the endpoint above. In Claude Code: `claude mcp add --transport http cafelytic https://srlwgayrxzamxlodpsrq.supabase.co/functions/v1/mcp`, then `/mcp` to sign in.

The project already signs JWTs with an asymmetric key (ES256), which the server requires.

To disconnect an app: `cafelytic.com/oauth/consent` with no parameters lists connected apps with a Disconnect button.

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
