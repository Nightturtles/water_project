# Upload runbook

End-to-end checklist for shipping a build to TestFlight (iOS) and to the Play Console Internal Testing track (Android). Run through this once accounts exist; ongoing uploads are just steps 6 and 7.

The upload scripts under `scripts/` are written but **blocked on accounts** until steps 1-5 below are done. Running either script before that point exits non-zero with a clear hint about what's missing.

## 1. Apple Developer Program (one-time, $99/year)

1. Apply at https://developer.apple.com/programs/enroll/. Individual account is simpler; LLC requires a DUNS number (free, takes ~3 days).
2. Pay the $99 enrollment fee. Apple takes 24-48h to approve a new account.
3. Once approved, your Team ID appears at https://developer.apple.com/account → Membership. It's a 10-character alphanumeric string (e.g. `ABCDE12345`).
4. Locally: `cp ios/team.xcconfig.example ios/team.xcconfig` and fill in the Team ID.
5. Open the project in Xcode at least once: `npx cap open ios`. Xcode will provision a development certificate and matching profile automatically.
6. **Create an Apple Distribution certificate.** The development cert from step 5 signs on-device test builds but cannot sign an App Store archive. In Xcode → Settings → Accounts → your team → **Manage Certificates** → **+** → **Apple Distribution** (or via the developer portal). The TestFlight script preflight checks for this and fails fast if it's missing; without it `xcodebuild -exportArchive` errors with `No signing certificate "iOS Distribution" found`.

## 1a. Register the App ID and create the App Store Connect app record (one-time)

Before the first upload, the bundle ID must exist both as a registered App ID and as an app record in App Store Connect, or `altool` rejects the upload with "No suitable application records were found."

1. **Register the App ID.** https://developer.apple.com/account → Certificates, Identifiers & Profiles → Identifiers → **+** → "App IDs" → "App". Description: `Cafelytic` (letters, numbers, and spaces only). Bundle ID: **Explicit**, `com.cafelytic.app`. Under Capabilities, enable **Sign in with Apple** (the Supabase Apple OAuth depends on it); leave the rest unchecked.
2. **Create the app record.** https://appstoreconnect.apple.com → **Apps** → **+** → **New App**. Platform: iOS. Name: `Cafelytic`. Primary language: English (U.S.). Bundle ID: pick `com.cafelytic.app` from the dropdown. SKU: any unique string, e.g. `cafelytic-ios`.

One-time only; later uploads reuse the same record.

## 2. App Store Connect API key (one-time)

The upload script uses an API key rather than your Apple ID, so it works headless without 2FA.

1. https://appstoreconnect.apple.com/access/api → Generate API Key.
2. Name it "Cafelytic Upload." Access: **Admin**. This is required, not optional: `xcodebuild` uses this same key for cloud-managed signing (regenerating the App Store provisioning profile so it includes your distribution cert), and only an **Admin** key is permitted to do that. A lower role (App Manager, Developer) authenticates fine for the upload itself but fails the signing step with "Cloud signing permission error." The Access role is shown in the "Access" column of the key table on that page; switch a key with Edit, or generate a fresh Admin key with **+**.
3. Download the `.p8` private key. Apple lets you download it ONCE; lose it and you have to revoke and regenerate.
4. Note the Key ID (10 chars) and Issuer ID (UUID) shown next to the key.
5. Store the `.p8` somewhere outside the repo, e.g. `~/Documents/cafelytic-secrets/AuthKey_<KEYID>.p8`.

Add to your shell profile:

```bash
export APP_STORE_CONNECT_API_KEY_ID="<10-char Key ID>"
export APP_STORE_CONNECT_API_KEY_ISSUER="<UUID Issuer ID>"
export APP_STORE_CONNECT_API_KEY_PATH="$HOME/Documents/cafelytic-secrets/AuthKey_<KEYID>.p8"
```

## 3. ExportOptions.plist (one-time)

The TestFlight upload script needs `ios/ExportOptions.plist` to know how to package the IPA. Create it (NOT committed; gitignored as a per-developer concern):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key>
    <string>app-store</string>
    <key>teamID</key>
    <string>YOUR_TEAM_ID_HERE</string>
    <key>signingStyle</key>
    <string>automatic</string>
    <key>stripSwiftSymbols</key>
    <true/>
</dict>
</plist>
```

Add `ios/ExportOptions.plist` to `.gitignore` (it contains the team ID, which is mildly sensitive and is per-developer anyway).

## 4. Google Play Console (one-time, $25)

1. Sign up at https://play.google.com/console/. Pay the $25 one-time fee.
2. Create the Cafelytic app:
   - App name: Cafelytic
   - Default language: English (United States)
   - Free
   - Confirm not directed at children
3. **Keep Play App Signing on.** It is the default for a new app: Google generates and holds the app signing key, and the key that signs your first uploaded AAB becomes your *upload key* (see `store/android/KEYSTORE.md`). There is no certificate to upload beforehand.
4. Add testers to the internal track (Testing → Internal testing → Testers): create an email list with at least one address.
5. Fill in the app content forms on the App content page: privacy policy URL (`https://cafelytic.com/privacy/`), data safety (`store/shared/data-safety.md`), content rating (`store/shared/age-rating.md`), target audience, ads declaration, app access (give reviewers a test sign-in), and the account deletion URL (`https://cafelytic.com/privacy/#delete-account`).
6. Fill in store listing copy by pasting from `store/android/*.md`. Upload screenshots from `store/screenshots/android/phone-1080x1920/` (regenerate them first with `npm run screenshots:android`), plus the 512 x 512 icon and the 1024 x 500 feature graphic.

**Personal accounts: the 12-tester rule.** A personal developer account created after November 13, 2023 cannot apply for production access until a *closed* test has had at least 12 testers opted in for 14 days in a row. Internal testing does not count, and organization accounts are exempt. See [Google's testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465). If this applies, start recruiting testers early: it is the longest lead time in the whole launch.

## 5. Service account for the Play Developer API (one-time)

The Play upload script uses a service account (not a Google user account) so it works headless.

1. In Google Cloud Console, create a project (or pick one) and enable the **Google Play Android Developer API** for it (APIs & Services → Library).
2. IAM & Admin → Service Accounts → Create. Name it "cafelytic-play-uploader." No roles at the Cloud level.
3. On the service account, Keys → Add key → Create new key → JSON. Download it. Store outside the repo.
4. In Play Console → **Users and permissions** → Invite new users: paste the service account's email address (it ends in `.iam.gserviceaccount.com`) and grant it, for the Cafelytic app, "Release to testing tracks" (add "Release to production" later if the script ever targets production). Play Console's old "Setup → API access" page is no longer where this is done. New permissions can take a few minutes, sometimes longer, to take effect.
5. Add to your shell profile:
   ```bash
   export PLAY_SERVICE_ACCOUNT_JSON="$HOME/Documents/cafelytic-secrets/cafelytic-play-uploader.json"
   ```

Also do the keystore setup from `store/android/KEYSTORE.md` if you haven't already.

## 6. Upload an iOS build

```bash
scripts/upload-testflight.sh
```

What happens:

1. `npm run build && npx cap sync ios` regenerates the web bundle and updates the native shell.
2. `CURRENT_PROJECT_VERSION` in `ios/App/App.xcodeproj/project.pbxproj` is incremented by 1 (the script handles this).
3. `xcodebuild archive` builds an archive (~5-10 min).
4. `xcodebuild -exportArchive` exports an IPA using `ios/ExportOptions.plist`.
5. `xcrun altool --upload-app` uploads the IPA to App Store Connect.
6. Apple processes the build asynchronously (~15-60 min for first build, faster after). You get an email when it's ready.
7. The build appears under TestFlight in App Store Connect. Add testers; they install via the TestFlight app.

After the upload is confirmed, `git add ios/App/App.xcodeproj/project.pbxproj && git commit -m "iOS build N for TestFlight"`.

## 7. Upload an Android build

The script has three modes, and which one you need depends on how far along the app is on Play Console:

| Stage | Command | What you do by hand |
|---|---|---|
| The very first upload | `scripts/upload-play-internal.sh --build-only` | Upload the AAB in Play Console (Testing → Internal testing → Create new release) and roll it out. Play only accepts API uploads for a package after one AAB has been uploaded by hand, and this upload registers the upload key. |
| Later uploads, while the app is still a draft (never published to a track) | `scripts/upload-play-internal.sh --draft` | Open the draft release in Play Console, then review and roll it out. Play refuses any other release status on a draft app. |
| Once the app has been published | `scripts/upload-play-internal.sh` | Nothing. |

If you use the wrong mode, the script prints Google's error and says which flag to use instead.

What happens:

1. `npm run build && npx cap sync android` regenerates the web bundle and updates the native shell.
2. `versionCode` in `android/app/build.gradle` is incremented by 1 (script handles this).
3. `./gradlew bundleRelease` builds a signed AAB (~3-5 min), and the script prints the SHA-256 of the certificate that signed it.
4. With `--build-only` the script stops here and prints the AAB path.
5. Otherwise it mints a JWT, exchanges it for an OAuth access token, opens a Play Console "edit," uploads the AAB, assigns it to the `internal` track (as a draft with `--draft`), and commits the edit.
6. Internal testers configured on Play Console see the update within minutes of the release being rolled out.

After the upload is confirmed, `git add android/app/build.gradle && git commit -m "Android versionCode N for Play internal"`.

## 8. Version bumps in the public version string

`CURRENT_PROJECT_VERSION` (iOS build number) and `versionCode` (Android) are technical identifiers that increment on every upload. The user-visible version string (`MARKETING_VERSION` on iOS, `versionName` on Android) does NOT bump per upload; bump it manually when shipping a meaningful new version (e.g. 1.0 -> 1.1 for a feature release).

This split is deliberate: TestFlight builds for the same "1.0" can have build numbers 1, 2, 3, ... as you iterate; the testers all see "1.0" with a build number suffix.

## Troubleshooting

**`altool` errors with "Authentication failed"**: the API key isn't downloaded to the path in `APP_STORE_CONNECT_API_KEY_PATH`, or the Key ID / Issuer don't match. Re-download from App Store Connect if necessary.

**Play upload returns 401 or 403**: the service account has no access to the app. Check that its email is invited under Play Console → Users and permissions with "Release to testing tracks" for Cafelytic, and that the Google Play Android Developer API is enabled in its Cloud project. A fresh grant can take a while to apply.

**Play upload returns "Only releases with status draft may be created on draft app"**: the app has not been published yet. Re-run with `--draft` and roll the release out in Play Console.

**Play upload returns 404 "Package not found"**: no AAB has been uploaded by hand yet. Do the first upload with `--build-only` (section 7).

**`bundleRelease` fails at `signReleaseBundle` with a `NullPointerException`**: the `CAFELYTIC_RELEASE_*` env vars are not set in the shell running Gradle. See `store/android/KEYSTORE.md`.

**Play upload returns 400 with "APK has already been uploaded"**: `versionCode` wasn't actually incremented. Check that the `sed` step in the script ran (look for the `==> Bumping Android versionCode` line). If you re-ran after a partial failure, you may need to bump manually.

**Xcode complains about provisioning profile**: open the project in Xcode (`npx cap open ios`), confirm the team is selected on the App target's Signing & Capabilities tab, and click "Try Again" if the profile needs regenerating.

**`exportArchive No signing certificate "iOS Distribution" found`**: there's no Apple Distribution cert in your keychain. Create one (see step 1, item 6). The script preflight now catches this before the archive, so you should see it in seconds rather than after a 10-minute build.

**`exportArchive Cloud signing permission error` / `Provisioning profile ... doesn't include signing certificate "Apple Distribution: ..."`**: the App Store profile predates your current distribution cert and `xcodebuild` tried to regenerate it via cloud signing, but the API key isn't **Admin**. Generate or switch to an Admin API key (see step 2) and re-run. The script passes the key to `xcodebuild` (`-authenticationKey*` flags) precisely so this regeneration is headless — it only works with an Admin key.

**`xcrun altool` deprecation warning**: as of Xcode 16 altool still works for App Store uploads. Apple has been threatening to remove it for years. If a future Xcode actually removes it, the replacement for App Store uploads is `xcrun iTMSTransporter`. The script will need a swap then.
