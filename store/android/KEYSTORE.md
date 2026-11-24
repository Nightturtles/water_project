# Android upload keystore

Generating, storing, and wiring the keystore used to sign Play Console uploads.

## Why this matters

Google Play requires every release APK or AAB to be signed by a key the developer controls. The consequences of losing the keystore depend on whether you opted into Play App Signing:

- **Without Play App Signing (self-managed)**: losing the keystore is permanent. You lose the ability to publish updates to the Cafelytic Play Store listing, and there is no recovery flow.
- **With Play App Signing (recommended)**: the keystore documented here is the *upload key*, distinct from the *signing key* Google holds. If you lose the upload key, you can request an upload-key reset through Play Console (typically reviewed within ~48 hours); the user-visible signing key is unaffected.

Either way: back the keystore up to at least two places (1Password plus an offline drive) the moment you generate it. The reset flow exists but is slow; treating the upload key as recoverable in practice undermines the speed of legitimate releases.

Two ways to manage this on the Play Console side:

1. **Play App Signing (strongly recommended).** You generate an *upload key* locally. Google holds a separate *signing key* that's used to sign the artifact actually distributed to users. If you ever lose the upload key, you can request a reset through the Play Console; the user-visible signing key is unaffected. Enable this when you first create the app on Play Console.
2. **Self-managed signing key.** You generate one key and use it for both upload and distribution. If you lose it, the app is dead.

The rest of this runbook assumes Play App Signing is enabled. The keystore documented here is the *upload* key.

## Prerequisites

- A JDK installed (`keytool` ships with it). The Android tooling already requires JDK 21.
- A password manager you trust (1Password, Bitwarden, Keychain Access).

## Generate the keystore

Run once, locally. The keystore file should NOT live in the repo.

```bash
keytool -genkey -v \
  -keystore ~/Documents/cafelytic-secrets/cafelytic-upload.keystore \
  -alias cafelytic-upload \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000
```

`keytool` will prompt for:

- A keystore password — generate a long random one in your password manager. This is a new password that only protects the keystore file; it is not your Google account password.
- No separate key password: current JDKs create a PKCS12 keystore, where the key always shares the keystore password. Set both password env vars below to that one value.
- Distinguished name fields (name, org, locality, etc.) — these end up in the signing certificate. Use real values; you can leave optional fields blank.

After it finishes, the file `cafelytic-upload.keystore` will exist at the path you supplied. Keep that path outside the repo; the `.gitignore` blocks `*.keystore` files but the right move is to never have the file in the working tree to begin with.

## Back up the keystore

Do this immediately, before doing anything else.

1. **Primary copy.** 1Password (or your password manager): create a Secure Note titled "Cafelytic Play upload keystore." Attach the `.keystore` file, paste in the keystore password (the key uses the same one), paste in the alias, paste in the local path you chose above.
2. **Secondary copy.** An offline drive (USB or external SSD) stored somewhere physically separate from your laptop. Same contents as the password-manager note.

If either backup is missing, the runbook is not done yet.

## Wire the environment variables

The `signingConfigs.release` block in `android/app/build.gradle` reads four env vars at Gradle configuration time. Add these to your shell profile (`~/.zshrc` or `~/.bashrc`):

```bash
export CAFELYTIC_RELEASE_KEYSTORE="$HOME/Documents/cafelytic-secrets/cafelytic-upload.keystore"
export CAFELYTIC_RELEASE_KEYSTORE_PASSWORD="<keystore password from 1Password>"
export CAFELYTIC_RELEASE_KEY_ALIAS="cafelytic-upload"
export CAFELYTIC_RELEASE_KEY_PASSWORD="<the same keystore password>"
```

Reload the shell (`exec $SHELL`) and verify:

```bash
echo "$CAFELYTIC_RELEASE_KEYSTORE" && ls -l "$CAFELYTIC_RELEASE_KEYSTORE"
```

## Sanity-check the signed build

Without the env vars, `./gradlew bundleRelease` fails at the `signReleaseBundle` step with a bare `NullPointerException` (the release signing config is empty when `CAFELYTIC_RELEASE_KEYSTORE` is unset). To confirm the env vars actually take effect:

```bash
cd android
./gradlew bundleRelease
# Inspect the AAB's signer:
keytool -printcert -jarfile app/build/outputs/bundle/release/app-release.aab
```

The output should show the certificate's `Owner:` matching the distinguished name you typed during `keytool -genkey`, and `Issuer:` matching the same name (it's self-signed).

## First Play Console upload

When the Play Console account exists:

1. Create the app on Play Console (Cafelytic, Free, etc.). Play App Signing is on by default; keep the option that lets Google generate the app signing key.
2. Run `scripts/upload-play-internal.sh --build-only` to build the signed AAB, then upload it by hand to the Internal Testing track (see `store/UPLOAD.md`, section 7). The key that signed this first AAB becomes the registered upload key, so there is no certificate to upload separately.
3. Check the App signing page (under App integrity): the upload key certificate's SHA-256 should match the one the script printed.
4. Later uploads go through the script without `--build-only`.

## If you lose the upload key

With Play App Signing on, you can request a key reset:

1. Generate a new upload keystore (same `keytool` command, different filename).
2. In Play Console: *Setup → App integrity → App signing → Upload key*. Follow the prompts to request an upload key reset and upload the new certificate.
3. Google reviews the request (usually within 48 hours).
4. Update your env vars to point at the new keystore. Re-run the upload script.

Without Play App Signing, none of this works — you lose the app. That's why keeping it on in step 1 of "First Play Console upload" above is non-optional.
