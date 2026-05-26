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
- App activity beyond saved recipes (no in-app search history, no installed apps list, no page view tracking — analytics-init.js gates GA loading to non-localhost web hostnames only and does not run on the native shell).
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

## Keeping the three sources in sync

When updating any of the following, update all of them:

1. https://cafelytic.com/privacy (the policy page).
2. `ios/App/App/PrivacyInfo.xcprivacy` (the iOS manifest).
3. This file plus the Play Console form plus the App Store Connect form.

A divergence between any pair is grounds for reviewer rejection or, worse, a misleading-to-users finding from a regulator.
