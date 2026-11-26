# Data safety questionnaires

Both stores ask what user data the app collects and how it is used. Both answers must stay in sync with the privacy policy at https://cafelytic.com/privacy and with the iOS `PrivacyInfo.xcprivacy` file shipped in PR 6.

This file is the record of the answers. Only the owner enters them in the consoles.

## What is entered where

Update this list when a console changes.

- **App Store Connect label:** Email Address, Other User Content, Crash Data and Performance Data, as this file recorded them for 1.2.2 (not read back from the console). **Still to add: Other Diagnostic Data** (decided 2026-11-25, see below).
- **Play Console form:** not submitted yet. Enter the table below as written.

## Play Console — Data safety form

Path: **App content → Data safety**.

### Data collection summary

| Data type | Collected? | Shared with third parties? | Optional? | Purpose |
|---|---|---|---|---|
| Personal info → Name | Yes (the name typed into the Support form; nowhere else) | No (Resend delivers the email as a service provider) | Optional (the Support form is optional) | App functionality |
| Personal info → Email address | Yes (account creation, sign-in; also the reply address typed into the Support form) | No | Required for sign-in; sign-in itself is optional for use of the app, and so is the Support form | Account management, App functionality |
| App activity → Other user-generated content | Yes (recipes the user saves, and the message typed into the Support form) | No | Optional (the app works without sign-in) | App functionality |
| App info and performance → Crash logs | Yes (Sentry) | Sentry is the data processor; the data is not shared further | No | Analytics |
| App info and performance → Diagnostics | Yes (Sentry: performance traces for a sample of page loads, and a masked session replay when an error fires) | Sentry is the data processor; the data is not shared further | No | Analytics |

The form has no "Diagnostics" purpose. Its Analytics purpose is the one that covers this: "to monitor app health, to diagnose and fix bugs or crashes". Picking it does not mean the native apps run Google Analytics; they do not.

No other categories collected. Specifically NOT collected:

- Personal info beyond the email address and the Support form name (no address, DOB, phone, identifiers).
- Location of any kind.
- Financial info.
- Health and fitness data.
- Messages (the form's Messages category is the user's emails, SMS and chat; a Support form message is declared above as other user-generated content), photos, audio, files.
- Web browsing history.
- Contacts.
- App activity beyond saved recipes and Support messages (no in-app search history, no installed apps list, no page view tracking — src/lib/analytics-init.ts gates GA loading to non-localhost web hostnames only and does not run on the native shell; Sentry's page-load traces are declared above as Diagnostics).
- Device or other IDs (no advertising ID, no per-device tracking).

### Encryption in transit

Yes. All Supabase and Sentry traffic uses HTTPS.

### Data deletion

Yes — users can request data deletion in the app: **Settings → Delete account** triggers the `delete_account()` RPC shipped in PR 6, which removes the user row plus all owned recipes.

### Data sharing

No data shared with third parties for marketing or analytics purposes. Sentry is named as a data processor (not third-party sharing) in the privacy policy. Resend, which delivers Support form messages and sign-in emails, is a service provider in the same sense. Connected AI apps are not declared as sharing; see the decisions below.

## App Store Connect — Privacy Nutrition Label

Path: **App Information → App Privacy**.

Apple's form mirrors the Play one but with different category names. Answers below.

### Data linked to the user

- **Contact Info → Email Address.** Purpose: App Functionality. Used for tracking: No.

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
  - The replay is declared as diagnostics, not as interaction data: Other Diagnostic Data on Apple ("any other data collected for the purposes of measuring technical diagnostics"), Diagnostics on Play ("any technical diagnostics"). It exists only around an error and only to debug it. If replay is ever sampled for ordinary sessions (`replaysSessionSampleRate` above 0) or its masking is turned off, declare Product Interaction (Apple) and App interactions (Play).
- **Diagnostics stay "linked to the user" on the Apple label.** Nothing calls `Sentry.setUser`, and `dataCollection.userInfo` is `false`, so events carry no account id, email or IP address from the SDK. "Not linked" would be the closer answer, but Sentry's servers can still keep the connection's IP address depending on a project setting, and over-declaring costs nothing.
- **Connected AI apps.** A signed-in user can connect an AI app to their account through the MCP server ([MCP.md](../../MCP.md)). What that app reads is sent to it at the user's request, after they approve it on the consent page. Not declared as sharing: Google does not count a transfer "based on a specific user-initiated action, where the user reasonably expects the data to be shared", and Apple's label covers what the app and its partners collect. The database keeps two records per user for this: which apps they approved and at which version of the ability list (`mcp_app_consent`), and a daily count of the rows connected apps wrote (`mcp_write_quota`). Both are account bookkeeping and are deleted with the account. The privacy page has a "Connected AI apps" section.
- **Privacy manifest.** `ios/App/App/PrivacyInfo.xcprivacy` declares the same five types as the label above, all as linked and for App Functionality. The change ships with the first iOS build after 1.2.2.

## Keeping the three sources in sync

When updating any of the following, update all of them:

1. https://cafelytic.com/privacy (the policy page).
2. `ios/App/App/PrivacyInfo.xcprivacy` (the iOS manifest).
3. This file plus the Play Console form plus the App Store Connect form.

A divergence between any pair is grounds for reviewer rejection or, worse, a misleading-to-users finding from a regulator.
