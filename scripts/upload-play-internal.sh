#!/usr/bin/env bash
# Build a signed Android AAB and upload it to the Play Console Internal
# Testing track.
#
# Usage:
#   scripts/upload-play-internal.sh               build, upload, roll out
#   scripts/upload-play-internal.sh --build-only  build the signed AAB, no upload
#   scripts/upload-play-internal.sh --draft       build, upload as a draft release
#
# Which mode to use (see store/UPLOAD.md, section 7):
#   --build-only  The very first upload. Play only accepts API uploads for a
#                 package after one AAB has been uploaded by hand in Play
#                 Console, and that first upload is also what registers the
#                 upload key. Needs no service account.
#   --draft       While the app is still a draft on Play Console (it has never
#                 been published to a track). Play refuses any other release
#                 status then; roll the draft out by hand in Play Console.
#   (no flag)     Once the app has been published: the release goes live to
#                 internal testers straight away.
#
# Prerequisites (see store/UPLOAD.md):
#   - Google Play Console account ($25 one-time fee).
#   - The Cafelytic app created on Play Console (one-time).
#   - CAFELYTIC_RELEASE_* env vars wired (see store/android/KEYSTORE.md).
#   - For uploads: a Google Cloud service account invited to the Play Console
#     account, its JSON key at PLAY_SERVICE_ACCOUNT_JSON.
#
# What this script does:
#   1. npm run build + npx cap sync android.
#   2. Bumps versionCode in android/app/build.gradle (Play rejects duplicates).
#   3. ./gradlew bundleRelease -> signed AAB, and checks who signed it.
#   4. Unless --build-only: uploads through the Play Developer API (curl +
#      the service account) and assigns the build to the internal track.
#
# Depends on `jq`, `curl`, `openssl` and `keytool`. It exits non-zero with a
# clear pointer when invoked without configuration.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

BUILD_ONLY=0
RELEASE_STATUS="completed"
for arg in "$@"; do
  case "$arg" in
    --build-only) BUILD_ONLY=1 ;;
    --draft) RELEASE_STATUS="draft" ;;
    -h|--help)
      # Print the header comment (everything up to the first blank line).
      awk 'NR > 1 && /^$/ { exit } NR > 1 { sub(/^# ?/, ""); print }' "$REPO_ROOT/scripts/upload-play-internal.sh"
      exit 0
      ;;
    *)
      echo "ERROR: unknown option: $arg (try --help)" >&2
      exit 64
      ;;
  esac
done

require_env() {
  local var_name=$1
  local hint=$2
  if [[ -z "${!var_name:-}" ]]; then
    echo "ERROR: $var_name is not set." >&2
    echo "" >&2
    echo "Hint: $hint" >&2
    echo "" >&2
    echo "Full setup runbook: store/UPLOAD.md" >&2
    echo "Keystore generation: store/android/KEYSTORE.md" >&2
    exit 64
  fi
}

if [[ "$BUILD_ONLY" -eq 0 ]]; then
  require_env PLAY_SERVICE_ACCOUNT_JSON \
    "Path to a Google Cloud service account JSON with Play Developer API access. (Not needed with --build-only.)"
fi
require_env CAFELYTIC_RELEASE_KEYSTORE \
  "Path to the upload keystore. Generated via the keytool command in store/android/KEYSTORE.md."
require_env CAFELYTIC_RELEASE_KEYSTORE_PASSWORD "Keystore password (from your password manager)."
require_env CAFELYTIC_RELEASE_KEY_ALIAS "Key alias (default: cafelytic-upload)."
require_env CAFELYTIC_RELEASE_KEY_PASSWORD "Key password (same as the keystore password for a PKCS12 keystore)."

if [[ "$BUILD_ONLY" -eq 0 && ! -f "$PLAY_SERVICE_ACCOUNT_JSON" ]]; then
  echo "ERROR: PLAY_SERVICE_ACCOUNT_JSON does not exist: $PLAY_SERVICE_ACCOUNT_JSON" >&2
  exit 66
fi
if [[ ! -f "$CAFELYTIC_RELEASE_KEYSTORE" ]]; then
  echo "ERROR: CAFELYTIC_RELEASE_KEYSTORE does not exist: $CAFELYTIC_RELEASE_KEYSTORE" >&2
  exit 66
fi

for tool in jq curl openssl keytool; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "ERROR: $tool is not on PATH. Install it before running this script." >&2
    exit 69
  fi
done

# ----- 1. Build the web bundle and sync Android shell ---------------------

echo "==> Building dist/ and syncing Android native shell"
npm run build
npx cap sync android

# ----- 2. Bump versionCode ------------------------------------------------

GRADLE="android/app/build.gradle"
CURRENT_CODE=$(awk '/versionCode /{print $2; exit}' "$GRADLE")
if [[ -z "$CURRENT_CODE" ]]; then
  echo "ERROR: could not read versionCode from $GRADLE" >&2
  exit 70
fi
NEXT_CODE=$((CURRENT_CODE + 1))
echo "==> Bumping Android versionCode $CURRENT_CODE -> $NEXT_CODE"
sed -i.bak "s/versionCode ${CURRENT_CODE}/versionCode ${NEXT_CODE}/" "$GRADLE"
rm -f "${GRADLE}.bak"

# ----- 3. bundleRelease (signed) ------------------------------------------

echo "==> Building signed AAB (this takes ~3-5 minutes)"
(cd android && ./gradlew bundleRelease)

AAB_PATH="android/app/build/outputs/bundle/release/app-release.aab"
if [[ ! -f "$AAB_PATH" ]]; then
  echo "ERROR: AAB not found at $AAB_PATH" >&2
  exit 73
fi
echo "==> AAB built: $AAB_PATH"

# A release bundle signed by anything other than the upload key is rejected
# by Play, so show the signer before going any further.
SIGNER=$(keytool -printcert -jarfile "$AAB_PATH" | awk '/SHA256:/{print $2; exit}')
if [[ -z "$SIGNER" ]]; then
  echo "ERROR: the AAB is not signed. Check the CAFELYTIC_RELEASE_* env vars." >&2
  exit 73
fi
echo "    Signed by (SHA-256): $SIGNER"

if [[ "$BUILD_ONLY" -eq 1 ]]; then
  echo ""
  echo "==> Build complete (--build-only: nothing was uploaded)."
  echo "    versionCode: $NEXT_CODE"
  echo "    Upload $AAB_PATH by hand: Play Console -> Testing -> Internal"
  echo "    testing -> Create new release. See store/UPLOAD.md, section 7."
  echo ""
  echo "    The versionCode bump is in your working tree. Commit it after the"
  echo "    upload is confirmed."
  exit 0
fi

# ----- 4. Upload to Play Console internal track --------------------------

# The minimal Play Developer API flow is documented at:
#   https://developers.google.com/android-publisher/api-ref/rest/v3/edits.bundles/upload
#
# Flow:
#   a. Mint a JWT, exchange for OAuth access token.
#   b. POST /edits to start an "edit" (a transaction).
#   c. POST /edits/{editId}/bundles to upload the AAB.
#   d. POST /edits/{editId}/tracks/internal to set track + version.
#   e. POST /edits/{editId}:commit to finalize.
#
# This script implements (a) inline rather than depending on a plugin.

PACKAGE_NAME="com.cafelytic.app"

echo "==> Minting Google API access token"
SA_EMAIL=$(jq -r .client_email "$PLAY_SERVICE_ACCOUNT_JSON")
PRIVATE_KEY=$(jq -r .private_key "$PLAY_SERVICE_ACCOUNT_JSON")
NOW=$(date +%s)
EXP=$((NOW + 3600))

b64() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

HEADER=$(printf '{"alg":"RS256","typ":"JWT"}' | b64)
CLAIM=$(printf '{"iss":"%s","scope":"https://www.googleapis.com/auth/androidpublisher","aud":"https://oauth2.googleapis.com/token","exp":%d,"iat":%d}' "$SA_EMAIL" "$EXP" "$NOW" | b64)
UNSIGNED="${HEADER}.${CLAIM}"
SIGNATURE=$(printf '%s' "$UNSIGNED" | openssl dgst -sha256 -sign <(printf '%s' "$PRIVATE_KEY") | b64)
JWT="${UNSIGNED}.${SIGNATURE}"

TOKEN_RESPONSE=$(curl -fsS \
  --data-urlencode "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer" \
  --data-urlencode "assertion=${JWT}" \
  https://oauth2.googleapis.com/token)
ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r .access_token)
if [[ "$ACCESS_TOKEN" == "null" || -z "$ACCESS_TOKEN" ]]; then
  echo "ERROR: failed to obtain Google access token. Response:" >&2
  echo "$TOKEN_RESPONSE" >&2
  exit 75
fi

# Calls the Play Developer API with the access token and prints the response
# body. On a non-2xx status it prints Google's error body (plain `curl -f`
# would hide it) plus a hint for the two first-upload failures, then fails.
play_api() {
  local body status
  body=$(mktemp)
  if ! status=$(curl -sS -o "$body" -w '%{http_code}' \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" "$@"); then
    rm -f "$body"
    echo "ERROR: could not reach the Play Developer API." >&2
    return 75
  fi
  if [[ "$status" != 2* ]]; then
    echo "ERROR: Play Developer API returned HTTP $status:" >&2
    cat "$body" >&2
    echo "" >&2
    if grep -qi "status draft" "$body"; then
      echo "Hint: the app is still a draft on Play Console. Re-run with --draft," >&2
      echo "      then roll the release out by hand in Play Console." >&2
    elif grep -qi "package not found" "$body"; then
      echo "Hint: Play has no upload for this package yet. Do the first upload by" >&2
      echo "      hand: re-run with --build-only and see store/UPLOAD.md, section 7." >&2
    elif [[ "$status" == "401" || "$status" == "403" ]]; then
      echo "Hint: the service account lacks access. Check it is invited under" >&2
      echo "      Play Console -> Users and permissions with release permissions." >&2
    fi
    echo "      The versionCode bump stays in your working tree; a re-run bumps again." >&2
    rm -f "$body"
    return 76
  fi
  cat "$body"
  rm -f "$body"
}

API="https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE_NAME}"

echo "==> Creating edit"
EDIT_ID=$(play_api -X POST "${API}/edits" | jq -r .id)

echo "==> Uploading AAB (this takes ~1-2 minutes)"
UPLOAD_RESPONSE=$(play_api -X POST \
  -H "Content-Type: application/octet-stream" \
  --data-binary "@${AAB_PATH}" \
  "https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${PACKAGE_NAME}/edits/${EDIT_ID}/bundles?uploadType=media")
VERSION_CODE_UPLOADED=$(echo "$UPLOAD_RESPONSE" | jq -r .versionCode)

echo "==> Assigning version $VERSION_CODE_UPLOADED to internal track (status: $RELEASE_STATUS)"
play_api -X PUT \
  -H "Content-Type: application/json" \
  -d "{\"track\":\"internal\",\"releases\":[{\"versionCodes\":[\"${VERSION_CODE_UPLOADED}\"],\"status\":\"${RELEASE_STATUS}\"}]}" \
  "${API}/edits/${EDIT_ID}/tracks/internal" > /dev/null

echo "==> Committing edit"
play_api -X POST "${API}/edits/${EDIT_ID}:commit" > /dev/null

echo ""
echo "==> Upload complete."
echo "    versionCode: $NEXT_CODE"
if [[ "$RELEASE_STATUS" == "draft" ]]; then
  echo "    The build is a DRAFT release on the Internal Testing track. Testers"
  echo "    do not have it yet: open Play Console -> Testing -> Internal testing,"
  echo "    edit the draft release, then review and roll it out."
else
  echo "    The build is on the Internal Testing track. Testers configured on"
  echo "    Play Console will see the update within minutes."
fi
echo ""
echo "    The versionCode bump is in your working tree. Commit it after the"
echo "    upload is confirmed."
