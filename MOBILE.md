# Sports Pooling — iOS & Android apps

The mobile apps are the existing React frontend wrapped in [Capacitor](https://capacitorjs.com/).
There is **one codebase**: `frontend/src` builds both the website and the two apps.
The native projects live in `frontend/ios` and `frontend/android` and are committed to git.

The apps bundle the web build locally and call `https://sportspooling.com/api` over
the network. They are not remote webviews pointed at the website — Apple rejects those.

---

## How it differs from the web build at runtime

| | Web | iOS / Android |
|---|---|---|
| API calls | relative `/api` | absolute `https://sportspooling.com/api` |
| Google sign-in | `@react-oauth/google` (web SDK) | native sheet via `@capgo/capacitor-social-login` |
| Apple sign-in | not shown | shown (required by App Store rule 4.8) |
| "Support us ❤️" | shown | hidden on iOS (App Store rule 3.1.1) |
| Share links | `window.location.origin` | forced to `https://sportspooling.com` |

All of this branches off `frontend/src/platform.js`. Nothing about the website's
behaviour changed.

---

## One-time setup

### 1. Install the toolchain

Neither toolchain is currently installed on this machine.

**Android** — needed to build the Play Store bundle:
- [Android Studio](https://developer.android.com/studio) (bundles the SDK)
- JDK 17+ (`brew install openjdk@17`)

**iOS** — needed to build the App Store binary, macOS only:
- Xcode from the Mac App Store (the Command Line Tools alone are not enough)
- Capacitor 8 uses Swift Package Manager, so CocoaPods is **not** required

### 2. Developer accounts

- Apple Developer Program — $99/year, https://developer.apple.com/programs/
- Google Play Console — $25 one-time, https://play.google.com/console/signup

Apple's review is slower and stricter; start that enrolment first, it can take days.

### 3. Google OAuth clients

The existing web client ID is reused, but each platform needs its own client
registered in the [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
under the same project.

**Android client:**
- Type: Android
- Package name: `com.sportspooling.app`
- SHA-1: your debug keystore for testing, **plus** the Play App Signing SHA-1 from
  the Play Console once the app is uploaded (sign-in silently fails without it)
- No code change needed — Android returns ID tokens minted for the *web* client ID,
  which the backend already accepts.

**iOS client:**
- Type: iOS
- Bundle ID: `com.sportspooling.app`
- Copy the client ID into `frontend/.env` as `VITE_GOOGLE_IOS_CLIENT_ID`
- Copy the **reversed** client ID (`com.googleusercontent.apps.7194…`) into
  `frontend/ios/App/App/Info.plist`, replacing `REPLACE_WITH_REVERSED_IOS_CLIENT_ID`
- Set the same client ID as `GOOGLE_IOS_CLIENT_ID` in the Railway backend env

### 4. Sign in with Apple

Apple requires this because the app offers Google sign-in.

- In the Apple Developer portal, enable the **Sign in with Apple** capability on the
  `com.sportspooling.app` App ID
- In Xcode: select the App target → *Signing & Capabilities* → **+ Capability** →
  *Sign in with Apple*. `frontend/ios/App/App/App.entitlements` already has the
  correct contents; this step wires it into the build settings.
- Backend: `APPLE_BUNDLE_ID` defaults to `com.sportspooling.app`. Only set it in
  Railway if you change the bundle ID.

### 5. Environment variables

`frontend/.env` (build-time, baked into the app):

```
VITE_API_BASE=https://sportspooling.com
VITE_GOOGLE_IOS_CLIENT_ID=<iOS OAuth client ID>
```

Railway backend:

```
GOOGLE_IOS_CLIENT_ID=<same iOS OAuth client ID>
```

---

## Everyday commands

Run from `frontend/`:

```bash
npm run cap:sync       # rebuild web assets and copy them into ios/ and android/
npm run cap:ios        # sync, then open Xcode
npm run cap:android    # sync, then open Android Studio
npm run cap:assets     # regenerate all icons/splashes from frontend/assets/
```

You must run `cap:sync` after **every** frontend change — the native projects hold a
copy of `dist/`, they do not read it live.

Icons are generated from `frontend/assets/icon-only.png` and friends. Replace those
source images and re-run `npm run cap:assets` to change the app icon. That script
fetches `@capacitor/assets` through `npx` rather than depending on it, because it
drags in a 24 MB `sharp` install that the Railway build would otherwise pay for on
every deploy. It is also pinned to `--ios --android` on purpose: without those flags
it regenerates PWA icons and overwrites `public/manifest.webmanifest` with broken
relative paths.

Releasing a new version means bumping:
- Android: `versionCode` and `versionName` in `frontend/android/app/build.gradle`
- iOS: *Version* and *Build* in Xcode's General tab

---

## Shipping an update once the apps are live

Before the apps existed, `git push` → `main` → Railway was the whole release. It
still is *for the website*, but it no longer reaches everyone. What you have to
do depends on what you changed.

### Backend-only change — nothing to ship

Anything under `backend/` (scoring, an endpoint, a fix) goes live for **installed
apps immediately**. The apps call `https://sportspooling.com/api` over the
network, so a Railway deploy reaches them the same moment it reaches the website.

### Frontend change — needs an app release

Anything under `frontend/src/` reaches the **website only**. The native projects
bundle their own copy of `dist/`, baked in at build time — see the `cap:sync`
warning above. App users keep seeing the old UI until you cut a release:

1. Bump `versionCode` **and** `versionName` in
   `frontend/android/app/build.gradle` (iOS: *Version* and *Build* in Xcode).
   `versionCode` must strictly increase. Play rejects a reused value permanently,
   including for a bundle you built and never published, so if in doubt skip a
   number rather than reuse one.
2. `npm run cap:sync`. Skipping this ships **stale assets** and does not fail
   loudly — the build succeeds and quietly contains the previous UI.
3. `./gradlew bundleRelease`, signed with the same upload keystore. Losing that
   key means you cannot update the app at all; the backup location is recorded in
   `play-assets/LISTING.md`.
4. Upload and roll out.

The Play requirement to run a closed test with 12 testers for 14 days is
**one-time**, for initial production access. Once granted, updates go straight to
production under a much faster review.

### The part that changes how you write backend code

**You can no longer assume every client is running the current frontend.**

On the web a breaking API change is safe: everyone reloads and gets matching
code. With apps in the wild, users sit on an old build for weeks, and some
effectively forever — you cannot force an update. Rename a response field or
change a payload shape and you break people who did nothing wrong and have no
way to tell why.

So treat the API as a contract with older builds:

- **Add** fields rather than rename or remove them.
- Keep old endpoints working alongside new ones instead of swapping them out.
- If a response shape genuinely has to change, version the endpoint and leave the
  old one serving until the old builds have aged out.

This is easy to forget precisely because it never shows up in testing, where you
are always on the newest build. It surfaces as a bug report from one user on an
old version that nobody can reproduce.

---

## Push notifications

Two notifications, both tied to something worth opening the app for:

| Kind | Trigger | Goes to |
|---|---|---|
| `reminder` | 30–180 min before kickoff | users in a pool for that match who have **not** picked it |
| `result` | match finishes (within the last 24h) | users who **did** pick it, with the score |

Delivery goes through Firebase Cloud Messaging for both platforms — Android
directly, iOS via APNs once the APNs key is uploaded to Firebase. One sender,
`backend/push.js`; the scanning logic is `backend/pushJobs.js`, running every 10
minutes off the same server process as the score sync.

Push disables itself when unconfigured, so nothing changes locally until you set it up.

### Firebase setup

1. Create a Firebase project (reuse the existing Google Cloud project if you like)
   at https://console.firebase.google.com/
2. **Android:** add an Android app with package `com.sportspooling.app`, download
   `google-services.json`, and drop it at `frontend/android/app/google-services.json`.
   The Gradle build picks it up automatically and skips FCM wiring when absent.
3. **iOS (later):** add an iOS app with bundle `com.sportspooling.app`, download
   `GoogleService-Info.plist` into `frontend/ios/App/App/`, and upload an APNs auth
   key (Apple Developer → Keys → **+** → Apple Push Notifications service) under
   Firebase → Project settings → Cloud Messaging.
4. Create a service account: Firebase → Project settings → Service accounts →
   *Generate new private key*. Set the whole JSON as `FCM_SERVICE_ACCOUNT` in Railway.
5. Set `VITE_PUSH_ENABLED=true` in `frontend/.env` and rebuild.

> **`VITE_PUSH_ENABLED` and the config files must be added together.** Registering
> for push calls Firebase natively; with no config file that call throws
> `IllegalStateException` on the plugin thread and takes the whole app down. It is
> not catchable from JavaScript, which is why the flag defaults to off rather than
> the code simply trying and failing gracefully.

```
FCM_SERVICE_ACCOUNT={"type":"service_account","project_id":"...", ... }
```

Locally you can point at a file instead: `FCM_SERVICE_ACCOUNT_FILE=/path/to/key.json`.

### Verifying it works

Sign in on a real device, then `POST /api/push/test` with your auth token — it sends
to your own devices and returns how many landed. Emulators without Google Play
Services will not receive anything.

### Behaviour worth knowing

- **Dedupe** is per user, per kind, per match, in the `push_log` table. Being in
  three pools for the same match still gets you one notification.
- **A user with no registered device is not marked as notified**, so installing the
  app an hour before kickoff still gets the reminder.
- **Dead tokens self-prune.** FCM 404/UNREGISTERED deletes the row; 5xx and rate
  limits deliberately do not.
- **Opt-outs** live in `push_prefs` and are respected before anything is sent.
  `GET`/`PUT /api/push/prefs` expose them; there is no settings UI for this yet.
- **A push arriving while the app is open never reaches the tray.** Android hands it
  to the app instead, so `frontend/src/components/PushToast.jsx` shows it in-app;
  tapping it routes through the same handler a tray tap uses. Without that listener
  the message is received and silently dropped, which is how it behaved until
  2026-07-29.
- The 24-hour result lookback exists so the first run after a deploy cannot blast
  every historical result at once.

`cd backend && npm test` covers all of the above against a throwaway database with
FCM stubbed out.

---

## Shipping to Google Play first

Play is the right store to start with: cheaper, faster review, and no Sign in with
Apple or 3.1.1 complications. Work down this list in order.

**1. Install the toolchain**
Android Studio + JDK 17. Then `cd frontend && npm run cap:android` should open the
project and build.

**2. Register the Android OAuth client** (§3 above)
Use your debug keystore SHA-1 for now:
```bash
keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android
```
Without this, Google sign-in fails on device with no visible error.

**3. Set up Firebase and push** (§Push notifications above)
Drop in `google-services.json`, set `FCM_SERVICE_ACCOUNT` on Railway, redeploy.

**4. Build a debug APK and test on a real phone**
Verify, in this order: app opens → Google sign-in works → pools load → `POST
/api/push/test` produces a notification → tapping it opens the right pool.
An emulator without Google Play Services cannot test push.

**4b. Create the upload keystore and wire release signing**

Play needs a signed **AAB**, not the debug APK. `app/build.gradle` reads the
signing details from `android/key.properties`, which is gitignored along with
`*.jks`/`*.keystore` — when that file is absent the release block is skipped and
debug builds carry on working.

```bash
cd frontend/android
keytool -genkeypair -v -keystore upload-keystore.jks \
  -keyalg RSA -keysize 2048 -validity 10000 -alias upload
```

Then create `frontend/android/key.properties`:

```
storeFile=upload-keystore.jks
storePassword=<the store password you just set>
keyAlias=upload
keyPassword=<the key password you just set>
```

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
./gradlew bundleRelease     # → app/build/outputs/bundle/release/app-release.aab
```

> **Back the keystore up somewhere you will not lose it.** With Play App Signing
> a lost *upload* key can be reset by Google, but losing it still means a support
> round-trip before you can ship another update. Never commit it.

**5. Pay the $25 and create the Play Console listing**
You will need: app name, short + full description, a 512×512 icon
(`frontend/assets/icon-only.png` after resizing), a 1024×500 feature graphic, and
at least 2 phone screenshots.

**6. Fill the Data Safety form honestly**
The app collects email address and a Google/Apple account identifier, transmits
them encrypted, and ties them to a user account. It also stores an FCM device token.
Getting this wrong is a common cause of rejection.

**7. Point the privacy policy at a real URL**
https://sportspooling.com/terms exists — confirm it names the data above, including
push tokens, before you submit.

**8. Upload to internal testing first, not production**
Internal testing has effectively no review delay, so you can shake out signing and
crash issues. Note that Play re-signs your app: once uploaded, take the **Play App
Signing SHA-1** from the console and add it to the Android OAuth client, or sign-in
will work in debug and fail in production.

**9. Promote to production** once internal testing looks clean.

### Then iOS

Everything in §1–4 of the one-time setup, plus:
- Screenshots at Apple's exact sizes, an App Privacy declaration, and a **demo
  account for the reviewer** — the app is unusable without signing in, and reviewers
  reject rather than sign up.
- **Guideline 4.2, minimum functionality.** Apple rejects thin website wrappers.
  Push notifications are now built, which is the main mitigation; say so explicitly
  in the review notes.
- **Guideline 3.1.1, external payments.** The PayPal and Buy Me a Coffee links are
  already hidden on iOS. Do not re-enable them there.
- **Guideline 4.8.** Sign in with Apple is implemented; make sure the capability is
  actually enabled in Xcode or the button fails at runtime.

---

### Android theme gotcha

`android/app/src/main/res/values/styles.xml` pins every theme to the **dark**
AppCompat parents rather than `DayNight`. That is deliberate. On Android 15+,
`android:statusBarColor` is ignored — edge-to-edge is enforced and the system draws
its own scrim, whose colour follows the theme. Left on `DayNight`, a phone in light
mode gets pale system bars framing a dark app. Note the manifest applies
`AppTheme.NoActionBarLaunch` to MainActivity, so bar styling must live there too,
not only on `AppTheme.NoActionBar`.

---

## Not built yet

- **Notification settings UI.** The `push_prefs` opt-out works over the API but has
  no screen. Google Play does not require one; it is a "users will ask for it" item.
- **Deep links.** Invite links (`/join/:id`) open in the browser, not the app.
  Universal Links (iOS) and App Links (Android) would fix that.
- **Secure token storage.** The JWT still lives in `localStorage`, which the OS can
  evict under storage pressure, logging the user out. `@capacitor/preferences` is
  already installed if you want to move it.
