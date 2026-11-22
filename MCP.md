# Cafelytic MCP server

Lets a user connect an AI app (Claude, ChatGPT, any MCP client) to their own Cafelytic account. The server is the Supabase Edge Function in `supabase/functions/mcp/`; sign-in is OAuth 2.1 against this project's Supabase Auth, so every tool call runs as the signed-in user under row-level security.

Endpoint once deployed: `https://srlwgayrxzamxlodpsrq.supabase.co/functions/v1/mcp`

## Status

Phase 1 (this code): reads, analysis, and private recipe / source-water writes. Built in the public shape (per-user sign-in, no admin powers), used by the owner only for now.

| Phase | Scope | State |
|---|---|---|
| 1 | Read recipes, source waters, minerals, concentrates; `analyze_water`; create / update private recipes and saved source waters | Built |
| 1b | `calculate_doses`: needs the dosing math moved out of the Calculator page controller into a shared module first, so the server and the app cannot disagree | Not started |
| 2 | Create / update concentrates, through a database function that merges one concentrate into `user_settings` atomically | Not started |
| 3 | Maybe: change the active selection (recipe, source water, minerals) | Undecided |

### Before this is offered to the public

- **Write quotas are not implemented.** Deferred on purpose while there is one user. Add a per-user daily cap and a per-account ceiling (same pattern as `estimate_water_quota`) first.
- Supabase's OAuth 2.1 server is still beta. Known gaps as of 2026-11: access tokens are not bound to this server (`aud` is always `authenticated`), and clients register through dynamic registration only.
- The consent page lists what a connected app can do. It must be updated in the same change as any new write tool.
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
| Write settings, concentrates, active selections | No (phases 2-3) | Yes |
| Delete the account | No | Yes |

`supabase/tests/oauth_client_restrictions.test.sql` pins every row of that table (`supabase test db`).

## Tools

| Tool | Writes? | Notes |
|---|---|---|
| `list_recipes`, `get_recipe` | No | Own, official library, and community recipes, with GH / KH / TDS |
| `list_source_waters` | No | Built-in and saved |
| `list_minerals`, `list_concentrates` | No | |
| `analyze_water` | No | Metrics, the app's range findings, and a charge-balance check |
| `create_recipe`, `update_recipe` | Yes | Private only. Names follow the app's rules; a deleted name's key is never reused |
| `create_source_water`, `update_source_water` | Yes | |

Chemistry and naming rules are not re-implemented: `src/lib/mcp-core.ts` re-exports the app's own functions, and `npm run mcp:build` bundles them into `supabase/functions/mcp/app-core.gen.js` (committed; `npm test` fails when it is stale). Only re-export functions that take every input as an argument: one that falls back to browser storage would silently use defaults on the server.

## How writes coexist with app sync

- **New recipes and source waters are safe.** Each is its own row; no device deletes a row it does not know, and every device adopts it on its next pull.
- **A key that was deleted is never reused.** Every device holding the deletion record would delete the new row on its next sync, so `create_*` picks a fresh key (`name-2`) and keeps the typed name.
- **An update can lose to a stale device.** Sync is last-write-wins per row with no timestamp check: a device with an unsynced edit to the same recipe overwrites the server's value.
- **`user_settings` and `user_selections` are off limits.** Each is one row per user that devices upsert whole, so any outside write races them. That is why concentrates wait for phase 2.

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
