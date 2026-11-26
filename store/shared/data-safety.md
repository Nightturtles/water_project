# Data safety questionnaires

Both stores ask what user data the app collects and how it is used. Both answers must stay in sync with the privacy policy at https://cafelytic.com/privacy and with the iOS `PrivacyInfo.xcprivacy` file shipped in PR 6.

This file is the record of the answers. Only the owner enters them in the consoles.

## What is entered where

Update this list when a console changes.

- **App Store Connect label:** Email Address, User ID, Other User Content, Crash Data, Performance Data and Other Diagnostic Data. The owner added User ID and Other Diagnostic Data on 2026-11-26; the other four are as this file recorded them for 1.2.2. None of it was read back from the console.
- **Play Console form:** filled in by the owner on 2026-11-26, as the table below (not read back from the console).

## Play Console — Data safety form

Path: **App content → Data safety**.

### Data collection summary

| Data type | Collected | Shared | Processed ephemerally | Required or optional | Purposes |
|---|---|---|---|---|---|
| Personal info → Name | Yes: the name typed into the Support form, nowhere else | No | No | Optional | App functionality |
| Personal info → Email address | Yes: account creation and sign-in, and the reply address typed into the Support form | No | No | Optional | Account management, App functionality |
| Personal info → User IDs | Yes: the account's ID, and the creator display name a user chooses when they publish a recipe | No | No | Optional | Account management, App functionality |
| App activity → Other user-generated content | Yes: the recipes, source waters and concentrates a signed-in user saves, and the message typed into the Support form | No | No | Optional | App functionality |
| App activity → App interactions | Yes: the clicks and page changes inside the masked session replay Sentry records when an error fires; nothing outside an error | No | No | Required | Analytics |
| App info and performance → Crash logs | Yes: the errors Sentry receives | No | No | Required | Analytics |
| App info and performance → Diagnostics | Yes: Sentry's performance traces for a sample of page loads, and the page structure in the on-error replay | No | No | Required | Analytics |

"Optional" is the form's "Users can choose whether this data is collected": sign-in, publishing and the Support form are all optional, and the app works without them. "Required" is "Data collection is required": the app has no setting that turns Sentry off. On the website the privacy page gives a browser-console command that does (`localStorage.setItem("cafelytic_no_sentry", "1")`, read by `sentryDisabled()` in `src/lib/sentry-init.ts`), but an installed app has no console, so its users cannot opt out and the Play answer stays Required.

The form has no "Diagnostics" purpose. Its Analytics purpose is the one that covers this: "to monitor app health, to diagnose and fix bugs or crashes". Picking it does not mean the native apps run Google Analytics; they do not.

No other categories collected. Specifically NOT collected:

- Personal info beyond the email address, the user IDs above and the Support form name (no address, DOB, phone).
- Location of any kind.
- Financial info.
- Health and fitness data.
- Messages (the form's Messages category is the user's emails, SMS and chat; a Support form message is declared above as other user-generated content), photos, audio, files.
- Web browsing history.
- Contacts.
- App activity beyond saved recipes, Support messages and the error replay's clicks (no in-app search history, no installed apps list, no page view tracking — src/lib/analytics-init.ts gates GA loading to non-localhost web hostnames only and does not run on the native shell; Sentry's page-load traces are declared above as Diagnostics).
- Device or other IDs (no advertising ID, no per-device tracking).

### Encryption in transit

Yes. All Supabase and Sentry traffic uses HTTPS.

### Data deletion

Yes — users can request data deletion in the app: **Settings → Delete account** triggers the `delete_account()` RPC shipped in PR 6, which removes the user row plus all owned recipes.

### Collected, shared and ephemeral: how each answer was reached

Reasoned on 2026-11-26, when the owner filled in the form. Quotes are from Google's Data safety help page as read that day.

**Collected: yes for all seven.** Google counts data as collected when the app sends it off the device, and that includes what a library or SDK in the app sends. So the three Sentry rows are collected even though the data never reaches Cafelytic's own database.

**Shared: no for all seven.** Google defines sharing as "transferring user data collected from your app to a third party", and then lists transfers that do not count. Two of those cover everything here:

- _Service providers._ A service provider "may only process user data on your behalf"; Google's example is "an analytics provider that processes user data from your app solely on your behalf". Supabase (database and sign-in), Resend (delivers Support form messages and sign-in emails) and Sentry (errors, traces and the on-error replay) each hold the data for Cafelytic and do not use it for themselves. This is why Name, Email address and the three Sentry rows are not shared. It rests on each provider's own data processing terms; if one starts using the data for its own purposes, the rows it receives become shared.
- _User-initiated action._ "Transferring user data to a third party based on a specific user-initiated action, where the user reasonably expects the data to be shared." A recipe and its creator display name become visible to other users only when the user chooses to publish and types the name into the publish prompt. This is why User IDs and Other user-generated content are not shared, and it is the same reason connected AI apps are not (see the decisions below).

One detail under User IDs: the publisher's account ID, an opaque UUID, travels with each published recipe to other users' apps (`src/lib/library-data.ts` selects `user_id`). It is never displayed; the app uses it to tell a user's own recipes from other people's. It goes out as part of the same publish action, and content shown to other users inside the app is not among the transfers Google lists as sharing (to a third-party server, to another app, through an SDK or a webview). If Google ever reads this differently, the change is to mark User IDs as shared, for App functionality.

**Processed ephemerally: no for all seven.** Google's test is "accessing and using it while the data is only stored in memory and retained for no longer than necessary to service the specific request in real-time". Every row here is kept:

- Email address, User IDs and saved recipes stay in the database until the user deletes them or the account.
- The Support form's name, reply address and message are not saved in the database, but the email they arrive in stays in the info@cafelytic.com inbox, and Resend may keep its own delivery record.
- Sentry stores errors, traces and replays for its retention period.

No data is shared with third parties for marketing or advertising.

## App Store Connect — Privacy Nutrition Label

Path: **App Information → App Privacy**.

Apple's form mirrors the Play one but with different category names. Answers below.

### Data linked to the user

- **Contact Info → Email Address.** Purpose: App Functionality. Used for tracking: No.
- **Identifiers → User ID.** Purpose: App Functionality. Used for tracking: No.
  - This covers the account's ID and the creator display name shown beside a published recipe.

### Data linked to the user — user content

- **Other User Content.** Purpose: App Functionality. Used for tracking: No.
  - This covers the recipe content users save and (optionally) publish to the library.

### Data linked to the user — diagnostics

- **Crash Data.** Purpose: App Functionality. Used for tracking: No.
- **Performance Data.** Purpose: App Functionality. Used for tracking: No.
- **Other Diagnostic Data.** Purpose: App Functionality. Used for tracking: No.
  - All three are collected by Sentry. Apple wants these declared even though they're operational.
  - Other Diagnostic Data is the session replay Sentry records when an error fires.
  - Sentry gets no user identity, so "linked" over-declares. It is kept that way on purpose; see the decisions below.

### NOT collected

Explicitly answer "No" to every other category. Apple shows the full list during the form; the policy document at cafelytic.com/privacy enumerates the same.

The Support form's name and message are not declared (no Name, no Customer Support), under Apple's optional disclosure rule; see the decisions below.

### Data used to track you

Apple requires this be declared separately from "linked to the user." The answer is **None** — no IDFA, no cross-app tracking, no fingerprinting.

## Decisions behind these answers

Decided by the owner on 2026-11-25, after a check of the code against this file (app 1.2.2). Store wording quoted here is from Apple's App Privacy Details page and Google's Data safety help page as read that week.

- **Support form.** The Support page (`support.html`, in the native apps too) takes a name (up to 100 characters), an email address and a message (up to 5000 characters), from signed-out users as well. The `submit-support` Edge Function emails all three to info@cafelytic.com through Resend and does not save them in the database.
  - _Play:_ declared. Name is its own row; the message counts as other user-generated content ("open-ended responses"). Google's page has no exception for support forms.
  - _Apple:_ not declared. Apple makes disclosure optional for data from "optional feedback forms or customer service requests" when all of these hold: it is not used for tracking or advertising; collection is infrequent, optional and not part of the app's primary functionality; and the user types it into the app's own form, with their name shown in the form, choosing to send it each time. The form meets each one. If the form ever becomes part of a main flow, or its data is used for anything but answering the sender, declare Name and Customer Support.
- **Hashed IP counter.** For rate limiting, `submit-support` stores a daily counter keyed by a SHA-256 hash of the sender's IP address (`support_submission_quota`); the IP itself is not stored. Not declared on either form: Google counts an IP address only where it is used to infer location, and Apple says to declare it "based on how you use" it, and neither form has a category for an abuse counter. The privacy page mentions it.
- **Sentry tracing and replay.** `src/lib/sentry-init.ts` turns on performance tracing for a sampled 10% of page loads (`browserTracingIntegration`, `tracesSampleRate: 0.1`) and records a session replay whenever an error fires (`replayIntegration`, `replaysOnErrorSampleRate: 1.0`). The replay is the page's structure and the user's clicks and navigation around the error; the SDK defaults mask all text and inputs and block media, and request bodies are not captured. The same bundle runs in the native apps, so both happen there too.
  - Tracing is Performance Data (Apple) and Diagnostics (Play).
  - _Apple:_ the replay is Other Diagnostic Data, which Apple defines by purpose: "any other data collected for the purposes of measuring technical diagnostics". It exists only around an error and only to debug it, so it is not declared as Product Interaction. If replay is ever sampled for ordinary sessions (`replaysSessionSampleRate` above 0) or its masking is turned off, declare Product Interaction too.
  - _Play:_ the replay is declared twice, as Diagnostics and as App interactions (changed 2026-11-26, after a review comment on PR 276). Google defines App interactions by what the data is, "how a user interacts with the app", with "sections they tap on" as an example, and lists purposes apart from data types. So the reason for collecting the clicks does not change their type; the purpose column says Analytics.
- **User identifier.** Decided 2026-11-26. Every account has an ID that each saved row carries, and a user who publishes a recipe chooses a creator display name (up to 40 characters; kept in their settings and on the recipe, and shown publicly beside it). Apple's User ID covers "screen name, handle, account ID"; Google's User IDs covers "an account ID, account number, or account name". Declared on both. The label had no identifier entry through 1.2.2, although the account ID has existed since sign-in shipped.
- **Diagnostics stay "linked to the user" on the Apple label.** Nothing calls `Sentry.setUser`, and `dataCollection.userInfo` is `false`, so events carry no account id, email or IP address from the SDK. "Not linked" would be the closer answer, but Sentry's servers can still keep the connection's IP address depending on a project setting, and over-declaring costs nothing.
- **Connected AI apps.** A signed-in user can connect an AI app to their account through the MCP server ([MCP.md](../../MCP.md)). What that app reads is sent to it at the user's request, after they approve it on the consent page. Not declared as sharing: Google does not count a transfer "based on a specific user-initiated action, where the user reasonably expects the data to be shared", and Apple's label covers what the app and its partners collect. The database keeps two records per user for this: which apps they approved and at which version of the ability list (`mcp_app_consent`), and a daily count of the rows connected apps wrote (`mcp_write_quota`). Both are account bookkeeping and are deleted with the account. The privacy page has a "Connected AI apps" section.
- **Privacy manifest.** `ios/App/App/PrivacyInfo.xcprivacy` declares the same six types as the label above, all as linked and for App Functionality. The change ships with the first iOS build after 1.2.2.

## Keeping the three sources in sync

When updating any of the following, update all of them:

1. https://cafelytic.com/privacy (the policy page).
2. `ios/App/App/PrivacyInfo.xcprivacy` (the iOS manifest).
3. This file plus the Play Console form plus the App Store Connect form.

A divergence between any pair is grounds for reviewer rejection or, worse, a misleading-to-users finding from a regulator.
