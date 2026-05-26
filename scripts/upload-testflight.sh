#!/usr/bin/env bash
# Upload a signed iOS build to TestFlight.
#
# Prerequisites (see store/UPLOAD.md):
#   - Apple Developer Program membership.
#   - App Store Connect API key (Users and Access -> Integrations).
#   - ios/team.xcconfig with DEVELOPMENT_TEAM filled in.
#
# What this script does:
#   1. Bumps the build number (CURRENT_PROJECT_VERSION) so App Store Connect
#      accepts the upload (it rejects duplicate build numbers per version).
#   2. xcodebuild archive -> exportArchive -> altool upload.
#
# Idempotency note: the build-number bump is committed in-place. If the
# script aborts after the bump, re-running will bump again. That's fine
# (each upload needs a fresh build number anyway); just don't commit the
# bumped .pbxproj until you have a successful upload.
#
# This script is INERT without the env vars below. It exits non-zero with a
# clear pointer when invoked without configuration, so calling it on a
# fresh laptop or in CI doesn't blow up mysteriously.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

require_env() {
  local var_name=$1
  if [[ -z "${!var_name:-}" ]]; then
    echo "ERROR: $var_name is not set." >&2
    echo "" >&2
    echo "TestFlight uploads need an App Store Connect API key. See" >&2
    echo "store/UPLOAD.md for the one-time setup. Required env vars:" >&2
    echo "  - APP_STORE_CONNECT_API_KEY_ID       (10-char key ID)" >&2
    echo "  - APP_STORE_CONNECT_API_KEY_ISSUER   (UUID)" >&2
    echo "  - APP_STORE_CONNECT_API_KEY_PATH     (path to .p8 private key)" >&2
    exit 64
  fi
}

require_env APP_STORE_CONNECT_API_KEY_ID
require_env APP_STORE_CONNECT_API_KEY_ISSUER
require_env APP_STORE_CONNECT_API_KEY_PATH

if [[ ! -f "$APP_STORE_CONNECT_API_KEY_PATH" ]]; then
  echo "ERROR: APP_STORE_CONNECT_API_KEY_PATH does not exist: $APP_STORE_CONNECT_API_KEY_PATH" >&2
  exit 66
fi

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "ERROR: xcodebuild not on PATH. Install Xcode and run xcode-select -p to confirm." >&2
  exit 69
fi

# ----- 1. Build a fresh web bundle and sync into the native shell ----------

echo "==> Building dist/ and syncing iOS native shell"
npm run build
npx cap sync ios

# ----- 2. Bump CURRENT_PROJECT_VERSION (build number) ----------------------

PBXPROJ="ios/App/App.xcodeproj/project.pbxproj"
CURRENT_BUILD=$(awk -F'= ' '/CURRENT_PROJECT_VERSION = /{gsub(";", "", $2); print $2; exit}' "$PBXPROJ")
if [[ -z "$CURRENT_BUILD" ]]; then
  echo "ERROR: could not read CURRENT_PROJECT_VERSION from $PBXPROJ" >&2
  exit 70
fi
NEXT_BUILD=$((CURRENT_BUILD + 1))
echo "==> Bumping iOS build number $CURRENT_BUILD -> $NEXT_BUILD"
# Use sed in BSD-compatible form (works on macOS without -i'').
sed -i.bak "s/CURRENT_PROJECT_VERSION = ${CURRENT_BUILD};/CURRENT_PROJECT_VERSION = ${NEXT_BUILD};/g" "$PBXPROJ"
rm -f "${PBXPROJ}.bak"

# ----- 3. Archive ----------------------------------------------------------

ARCHIVE_PATH="$REPO_ROOT/ios/build/App.xcarchive"
EXPORT_PATH="$REPO_ROOT/ios/build/export"
EXPORT_OPTIONS="$REPO_ROOT/ios/ExportOptions.plist"

if [[ ! -f "$EXPORT_OPTIONS" ]]; then
  echo "ERROR: $EXPORT_OPTIONS not found. See store/UPLOAD.md for the template." >&2
  exit 72
fi

rm -rf "$ARCHIVE_PATH" "$EXPORT_PATH"

echo "==> Archiving (this takes ~5-10 minutes)"
xcodebuild archive \
  -project ios/App/App.xcodeproj \
  -scheme App \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE_PATH"

# ----- 4. Export the IPA ---------------------------------------------------

echo "==> Exporting IPA"
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportOptionsPlist "$EXPORT_OPTIONS" \
  -exportPath "$EXPORT_PATH" \
  -allowProvisioningUpdates

IPA_PATH=$(find "$EXPORT_PATH" -name '*.ipa' -maxdepth 2 | head -1)
if [[ -z "$IPA_PATH" ]]; then
  echo "ERROR: no .ipa produced under $EXPORT_PATH" >&2
  exit 73
fi
echo "==> Exported IPA: $IPA_PATH"

# ----- 5. Upload to App Store Connect --------------------------------------

echo "==> Uploading to App Store Connect"
# xcrun altool is deprecated in favor of notarytool for notarization, but for
# App Store / TestFlight uploads altool is still the supported path as of
# Xcode 16. If a future Xcode removes altool entirely, swap this block for:
#   xcrun notarytool submit ... (no, notarytool is notarization-only)
#   xcrun iTMSTransporter -m upload ... (the old fallback)
xcrun altool --upload-app \
  --type ios \
  --file "$IPA_PATH" \
  --apiKey "$APP_STORE_CONNECT_API_KEY_ID" \
  --apiIssuer "$APP_STORE_CONNECT_API_KEY_ISSUER"

echo ""
echo "==> Upload complete."
echo "    Build number: $NEXT_BUILD"
echo "    Apple processes the build asynchronously; expect a confirmation"
echo "    email in 15-60 minutes. After it processes, the build appears in"
echo "    App Store Connect under TestFlight."
echo ""
echo "    The CURRENT_PROJECT_VERSION bump is in your working tree. Commit"
echo "    it after the upload is confirmed processed."
