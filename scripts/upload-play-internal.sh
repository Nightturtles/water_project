#!/usr/bin/env bash
# Upload a signed Android AAB to the Play Console Internal Testing track.
#
# Prerequisites (see store/UPLOAD.md):
#   - Google Play Console account ($25 one-time fee).
#   - The Cafelytic app shell created on Play Console (one-time).
#   - Play App Signing enabled (one-time, strongly recommended).
#   - A service account in Google Cloud with Play Developer API access.
#   - CAFELYTIC_RELEASE_* env vars wired (see store/android/KEYSTORE.md).
#
# What this script does:
#   1. Bumps versionCode in android/app/build.gradle (Play rejects duplicates).
#   2. ./gradlew bundleRelease -> signed AAB.
#   3. Uses the Play Developer API (via the gradle-play-publisher plugin OR
#      a curl-based upload using the service account) to push to internal track.
#
# This script depends on `jq` and `curl` plus the four CAFELYTIC_RELEASE_*
# env vars from the keystore runbook. It exits non-zero with a clear pointer
# when invoked without configuration.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

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

require_env PLAY_SERVICE_ACCOUNT_JSON \
  "Path to a Google Cloud service account JSON with Play Developer API access."
require_env CAFELYTIC_RELEASE_KEYSTORE \
  "Path to the upload keystore. Generated via the keytool command in store/android/KEYSTORE.md."
require_env CAFELYTIC_RELEASE_KEYSTORE_PASSWORD "Keystore password (from 1Password)."
require_env CAFELYTIC_RELEASE_KEY_ALIAS "Key alias (default: cafelytic-upload)."
require_env CAFELYTIC_RELEASE_KEY_PASSWORD "Key password (from 1Password)."

if [[ ! -f "$PLAY_SERVICE_ACCOUNT_JSON" ]]; then
  echo "ERROR: PLAY_SERVICE_ACCOUNT_JSON does not exist: $PLAY_SERVICE_ACCOUNT_JSON" >&2
  exit 66
fi
if [[ ! -f "$CAFELYTIC_RELEASE_KEYSTORE" ]]; then
  echo "ERROR: CAFELYTIC_RELEASE_KEYSTORE does not exist: $CAFELYTIC_RELEASE_KEYSTORE" >&2
  exit 66
fi

for tool in jq curl openssl; do
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

API="https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE_NAME}"

echo "==> Creating edit"
EDIT_ID=$(curl -fsS -X POST \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  "${API}/edits" | jq -r .id)

echo "==> Uploading AAB (this takes ~1-2 minutes)"
UPLOAD_RESPONSE=$(curl -fsS -X POST \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/octet-stream" \
  --data-binary "@${AAB_PATH}" \
  "https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${PACKAGE_NAME}/edits/${EDIT_ID}/bundles?uploadType=media")
VERSION_CODE_UPLOADED=$(echo "$UPLOAD_RESPONSE" | jq -r .versionCode)

echo "==> Assigning version $VERSION_CODE_UPLOADED to internal track"
curl -fsS -X PUT \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"track\":\"internal\",\"releases\":[{\"versionCodes\":[\"${VERSION_CODE_UPLOADED}\"],\"status\":\"completed\"}]}" \
  "${API}/edits/${EDIT_ID}/tracks/internal" > /dev/null

echo "==> Committing edit"
curl -fsS -X POST \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  "${API}/edits/${EDIT_ID}:commit" > /dev/null

echo ""
echo "==> Upload complete."
echo "    versionCode: $NEXT_CODE"
echo "    The build is on the Internal Testing track. Testers configured on"
echo "    Play Console will see the update within minutes."
echo ""
echo "    The versionCode bump is in your working tree. Commit it after the"
echo "    upload is confirmed."
