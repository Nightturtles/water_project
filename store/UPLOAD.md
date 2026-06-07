# Upload runbook

End-to-end checklist for shipping a build to TestFlight (iOS) and to the Play Console Internal Testing track (Android). Run through this once accounts exist; ongoing uploads are just steps 5 and 6.

The upload scripts under `scripts/` are written but **blocked on accounts** until steps 1-4 below are done. Running either script before that point exits non-zero with a clear hint about what's missing.

## 1. Apple Developer Program (one-time, $99/year)

1. Apply at https://developer.apple.com/programs/enroll/. Individual account is simpler; LLC requires a DUNS number (free, takes ~3 days).
2. Pay the $99 enrollment fee. Apple takes 24-48h to approve a new account.
3. Once approved, your Team ID appears at https://developer.apple.com/account → Membership. It's a 10-character alphanumeric string (e.g. `ABCDE12345`).
4. Locally: `cp ios/team.xcconfig.example ios/team.xcconfig` and fill in the Team ID.
5. Open the project in Xcode at least once: `npx cap open ios`. Xcode will provision a development certificate and matching profile automatically.

## 1a. Register the App ID and create the App Store Connect app record (one-time)

Before the first upload, the bundle ID must exist both as a registered App ID and as an app record in App Store Connect, or `altool` rejects the upload with "No suitable application records were found."

1. **Register the App ID.** https://developer.apple.com/account → Certificates, Identifiers & Profiles → Identifiers → **+** → "App IDs" → "App". Description: `Cafelytic` (letters, numbers, and spaces only). Bundle ID: **Explicit**, `com.cafelytic.app`. Under Capabilities, enable **Sign in with Apple** (the Supabase Apple OAuth depends on it); leave the rest unchecked.
2. **Create the app record.** https://appstoreconnect.apple.com → **Apps** → **+** → **New App**. Platform: iOS. Name: `Cafelytic`. Primary language: English (U.S.). Bundle ID: pick `com.cafelytic.app` from the dropdown. SKU: any unique string, e.g. `cafelytic-ios`.

One-time only; later uploads reuse the same record.

## 2. App Store Connect API key (one-time)

The upload script uses an API key rather than your Apple ID, so it works headless without 2FA.

1. https://appstoreconnect.apple.com/access/api → Generate API Key.
2. Name it "Cafelytic Upload." Access: "App Manager" (or "Developer" if you don't need full edits).
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
3. **Enable Play App Signing** in Setup → App integrity → App signing. Choose "Let Google generate and protect the app signing key." Upload your upload-key certificate (see `store/android/KEYSTORE.md` for the export command).
4. Create the first internal-testing release shell (Release → Testing → Internal testing → Create new release). You don't have to upload an AAB here; the script does that. You DO need to add at least one tester email so the track is "valid."
5. Fill in store listing copy by pasting from `store/android/*.md`. Upload screenshots from `store/screenshots/android/pixel-6/`.

## 5. Service account for the Play Developer API (one-time)

The Play upload script uses a service account (not a Google user account) so it works headless.

1. Google Cloud Console → IAM → Service Accounts → Create.
2. Name it "cafelytic-play-uploader." No specific roles at the Cloud level.
3. Create a key (JSON format). Download it. Store outside the repo.
4. Back in Play Console → Setup → API access → grant the service account access:
   - Role: Release Manager (lets it upload to internal/closed tracks).
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

```bash
scripts/upload-play-internal.sh
```

What happens:

1. `npm run build && npx cap sync android` regenerates the web bundle and updates the native shell.
2. `versionCode` in `android/app/build.gradle` is incremented by 1 (script handles this).
3. `./gradlew bundleRelease` builds a signed AAB (~3-5 min).
4. The script mints a JWT, exchanges it for an OAuth access token, opens a Play Console "edit," uploads the AAB, assigns it to the `internal` track, and commits the edit.
5. Internal testers configured on Play Console see the update within minutes.

After the upload is confirmed, `git add android/app/build.gradle && git commit -m "Android versionCode N for Play internal"`.

## 8. Version bumps in the public version string

`CURRENT_PROJECT_VERSION` (iOS build number) and `versionCode` (Android) are technical identifiers that increment on every upload. The user-visible version string (`MARKETING_VERSION` on iOS, `versionName` on Android) does NOT bump per upload; bump it manually when shipping a meaningful new version (e.g. 1.0 -> 1.1 for a feature release).

This split is deliberate: TestFlight builds for the same "1.0" can have build numbers 1, 2, 3, ... as you iterate; the testers all see "1.0" with a build number suffix.

## Troubleshooting

**`altool` errors with "Authentication failed"**: the API key isn't downloaded to the path in `APP_STORE_CONNECT_API_KEY_PATH`, or the Key ID / Issuer don't match. Re-download from App Store Connect if necessary.

**Play upload returns 403**: the service account doesn't have Release Manager access. Re-check the grant in Play Console → Setup → API access.

**Play upload returns 400 with "APK has already been uploaded"**: `versionCode` wasn't actually incremented. Check that the `sed` step in the script ran (look for the `==> Bumping Android versionCode` line). If you re-ran after a partial failure, you may need to bump manually.

**Xcode complains about provisioning profile**: open the project in Xcode (`npx cap open ios`), confirm the team is selected on the App target's Signing & Capabilities tab, and click "Try Again" if the profile needs regenerating.

**`xcrun altool` deprecation warning**: as of Xcode 16 altool still works for App Store uploads. Apple has been threatening to remove it for years. If a future Xcode actually removes it, the replacement for App Store uploads is `xcrun iTMSTransporter`. The script will need a swap then.
