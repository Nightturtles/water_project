# Data safety questionnaires

Both stores ask what user data the app collects and how it is used. Both answers must stay in sync with the privacy policy at https://cafelytic.com/privacy and with the iOS `PrivacyInfo.xcprivacy` file shipped in PR 6.

## Play Console — Data safety form

Path: **App content → Data safety**.

### Data collection summary

| Data type | Collected? | Shared with third parties? | Optional? | Purpose |
|---|---|---|---|---|
| Email address | Yes (account creation, sign-in) | No | Required for sign-in; sign-in itself is optional for use of the app | Account management |
| App activity → Other user-generated content | Yes (recipes the user saves) | No | Optional (the app works without sign-in) | App functionality |
| App info and performance → Crash logs | Yes (Sentry) | Sentry is the data processor; the data is not shared further | No | Diagnostics |
| App info and performance → Diagnostics | Yes (Sentry) | Sentry is the data processor; the data is not shared further | No | Diagnostics |

No other categories collected. Specifically NOT collected:

- Personal info beyond email (no name, address, DOB, phone, identifiers).
- Location of any kind.
- Financial info.
- Health and fitness data.
- Messages, photos, audio, files.
- Web browsing history.
- Contacts.
- App activity beyond saved recipes (no in-app search history, no installed apps list, no page view tracking — src/lib/analytics-init.ts gates GA loading to non-localhost web hostnames only and does not run on the native shell).
- Device or other IDs (no advertising ID, no per-device tracking).

### Encryption in transit

Yes. All Supabase and Sentry traffic uses HTTPS.

### Data deletion

Yes — users can request data deletion in the app: **Settings → Delete account** triggers the `delete_account()` RPC shipped in PR 6, which removes the user row plus all owned recipes.

### Data sharing

No data shared with third parties for marketing or analytics purposes. Sentry is named as a data processor (not third-party sharing) in the privacy policy.

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
  - Both are collected by Sentry. Apple wants these declared even though they're operational.

### NOT collected

Explicitly answer "No" to every other category. Apple shows the full list during the form; the policy document at cafelytic.com/privacy enumerates the same.

### Data used to track you

Apple requires this be declared separately from "linked to the user." The answer is **None** — no IDFA, no cross-app tracking, no fingerprinting.

## What the app does that the answers above do not cover

Checked against the code on 2026-11-23 (app 1.2.2). The sections above record the answers as declared, and none of them has been changed for the points below. Each point is an open owner decision: declare it, change the app, or leave it and write down why here.

- **Support form.** The Support page (`support.html`, in the native apps too) takes a name (up to 100 characters), an email address and a message (up to 5000 characters), from signed-out users as well. The `submit-support` Edge Function emails all three to info@cafelytic.com through Resend and does not save them in the database. For rate limiting it stores a daily counter keyed by a SHA-256 hash of the sender's IP address (`support_submission_quota`); the IP itself is not stored. The "NOT collected" list above says no name and no messages.
- **Privacy manifest.** `ios/App/App/PrivacyInfo.xcprivacy` declares one collected data type, the email address. The Nutrition Label section above lists four (Email Address, Other User Content, Crash Data, Performance Data).
- **Sentry does more than crash reports.** `src/lib/sentry-init.ts` also turns on performance tracing for a sampled 10% of page loads (`browserTracingIntegration`, `tracesSampleRate: 0.1`) and records a session replay whenever an error fires (`replayIntegration`, `replaysOnErrorSampleRate: 1.0`). The replay is the page's structure and the user's clicks and navigation around the error; the SDK defaults mask all text and inputs and block media, and request bodies are not captured. The same bundle runs in the native apps, so both happen there too. The "no page view tracking" line above is true of Google Analytics, which the native apps never load.
- **Sentry gets no user identity.** Nothing calls `Sentry.setUser`, and `dataCollection.userInfo` is `false`, so events carry no account id, email or IP address from the SDK. The Nutrition Label section above lists Crash Data and Performance Data as linked to the user.
- **Connected AI apps.** A signed-in user can connect an AI app to their account through the MCP server ([MCP.md](../../MCP.md)). What that app reads is sent to it at the user's request. The database keeps two records per user for this: which apps they approved and at which version of the ability list (`mcp_app_consent`), and a daily count of the rows connected apps wrote (`mcp_write_quota`). Both are deleted with the account. The privacy page has a "Connected AI apps" section; this file does not mention the feature.

## Keeping the three sources in sync

When updating any of the following, update all of them:

1. https://cafelytic.com/privacy (the policy page).
2. `ios/App/App/PrivacyInfo.xcprivacy` (the iOS manifest).
3. This file plus the Play Console form plus the App Store Connect form.

A divergence between any pair is grounds for reviewer rejection or, worse, a misleading-to-users finding from a regulator.
