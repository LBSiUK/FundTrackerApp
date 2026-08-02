# The iOS app

SwiftUI + SwiftData, deployment target **iOS 26.0**. Swift 5 language mode,
`SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor`.

The target was 18.0 until the app moved to the Liquid Glass button styles —
`.glass` and `.glassProminent` are `@available(iOS 26.0, *)`, and using them
without availability branches everywhere means requiring 26. That drops anything
older; acceptable for a single-user app, worth knowing before sharing a build.

Open `FundTracker/FundTracker.xcodeproj` and run. The project uses Xcode's
file-system-synchronised groups, so **adding a `.swift` file to the folder adds
it to the target automatically** — no pbxproj editing.

## Files

| File | What it does |
|---|---|
| `FundTrackerApp.swift` | Entry point. Sets up the `ModelContainer` and injects `SyncSettings` / `SyncService`. |
| `Models.swift` | `Device`, `Part`, `Sale` `@Model` classes plus `DeviceStatus` and `SalePlatform` enums. |
| `FundSummary.swift` | All derived money figures. Mirrored by `server/services/summary.js`. Also holds the `Double.currency` formatting helpers. |
| `SyncService.swift` | Wire DTOs, the `POST /api/sync` call, and the two onboarding calls (`checkServer`, `signIn`). Also `ServerAddress.normalise`. |
| `SyncSettings.swift` | Server URL, account email, device id (UserDefaults) + token (Keychain) + last-synced date. |
| `PreviewData.swift` | In-memory container with sample data, for `#Preview` only. |
| `ContentView.swift` | The three tabs. |
| `Palette.swift` | The colour scheme, semantic names over asset colorsets. |
| `Views/BrandLogo.swift` | The mark and the wordmark lockup. |
| `Views/` | One file per screen, plus `Components.swift` and `PhotoSupport.swift`. |

## Screens

**Devices** — grouped by status so things waiting on parts stay at the top.
Swipe to edit or delete. Tap through to a detail screen where you tick parts off
as you buy them. Empty state offers to add the first device.

**Sales** — grouped by month with per-month subtotals, filterable by platform,
tap a row to edit. Shows `+£127.60` with `of £145.00` underneath when fees were
deducted, and hides that second line when there were none.

**Insights** — the headline cards, the affordability card, two charts, a
platform breakdown, and the gear icon for Settings.

**Onboarding** (full-screen on first launch) — the welcome screen asks offline or
online, then server address, then sign in *or* create an account. Steps carry an
`.id(step)` and an asymmetric transition, so moving forward slides the next step
in from the right while the current one leaves left.

**Modifier order on the transition is load-bearing and fails silently.** The
transition must be attached *inside* the identity it belongs to — `.transition()`
first, `.id(step)` last. With `.id` applied first, the transition lands on an
outer wrapper that is never inserted or removed, so the step swaps instantly and
nothing warns you. That exact mistake shipped once already.

Its presentation is a **computed binding** over `settings.hasSeenOnboarding`, not
`@State` seeded in `.task`. That was a real bug: Reset App cleared the flag and
nothing happened, because the task had already run and never ran again. Reading
it live means the cover reappears the moment the flag flips, whoever flipped it.

Onboarding continues: Creating one needs a one-time activation code issued from the
server's `/admin` page; there is no open sign-up. See
[ARCHITECTURE.md](ARCHITECTURE.md) for the flow. Offers "Set Up Later", because
the app is the source of truth and works with no server at all. Once dismissed
it doesn't reappear (`hasSeenOnboarding`); Settings can start it again.

**Settings** (sheet from Insights) — which server and account this phone is
signed in to, Sign Out, Sync Now, last-synced. It shows the connected host, not
an editable token field: the token is issued by the server now, so there's
nothing to type. A Danger Zone at the bottom holds **Reset App** (erases the
devices and sales on this phone, leaving the account alone) and **Delete
Account**.

**Delete Account** (`DeleteAccountView`) asks for the password rather than
reusing the sync token already on the phone. The token is write-scoped — "can
upload records" shouldn't quietly imply "can destroy the account". Erasing local
records alongside it is a toggle, defaulting on.

## Conventions worth keeping

**Enums are stored as raw strings.** SwiftData predicates on enums are
unreliable, so `Device.statusRaw` is a `String` with a computed `status`
property over it. Filtering is done in memory rather than in a `#Predicate`.

**Relationships are optional.** SwiftData makes to-many relationships optional
under the hood; `Device.partList` unwraps `parts ?? []` in one place so the rest
of the code doesn't have to.

**Photos use `@Attribute(.externalStorage)`** and are downscaled to 1280px JPEG
at quality 0.8 before storing (`UIImage.compressedForStorage`). Camera originals
are enormous compared to a 44pt thumbnail. `DevicePhoto` renders the photo when
present and falls back to the SF Symbol otherwise, so devices without photos are
unaffected.

**Photos are uploaded, and `Device.photoHash` is computed, not stored.** It's the
SHA-256 of the JPEG, recomputed at sync time so it can never drift from the bytes
it names. The sync payload carries only the hash; `uploadPhotos` then sends just
the ones the server reported as missing. A failed photo upload downgrades the
sync to `.partial` rather than `.failure` — the records are already safely
stored by that point and the money figures are correct regardless.

**The token is in the Keychain**, not UserDefaults — it's a credential.
`kSecAttrAccessibleWhenUnlockedThisDeviceOnly`. The password that obtained it is
never persisted anywhere; it's cleared from `@State` as soon as the sign-in call
returns.

**The Keychain outlives the app.** iOS keeps Keychain items when an app is
deleted, so `token` can survive a reinstall while UserDefaults doesn't.
`isConfigured` requires *both* a server URL and a token, which is what stops a
half-remembered state from skipping onboarding. Worth knowing when testing:
deleting the app in the simulator does not give you a clean credential state.

**A phone from before onboarding existed** keeps its shared token and isn't
dragged through setup — `init()` marks onboarding seen when `isConfigured` is
already true. Settings labels that state and suggests signing in properly.

**No App Transport Security exemptions.** The dashboard is HTTPS on a public
hostname with a real certificate, so cleartext is blocked everywhere. An earlier
version had `NSAllowsLocalNetworking` for plain HTTP on the LAN; that was
removed once TLS was in place. If you ever go back to a LAN-only HTTP setup
you'll need to re-add it or connections fail silently.

## The mark

`BrandLogo` draws two circular arrows turning around a £ — the sync idea and the
thing being tracked in one glyph. It's `arrow.triangle.2.circlepath` with the £
laid over it in a ZStack rather than a bundled image, so it stays sharp at any
size and takes the tint in both colour schemes. `BrandLockup` adds the wordmark
in **Didot**, which ships with iOS; if it were ever missing SwiftUI falls back to
the system face rather than failing to draw.

## Colour

Four brand colours, defined once in `Palette.swift` over asset catalog colorsets:
5F021F burgundy, BD3E2B brick, E96B0B orange, FFF984 pale yellow. Views reference
semantic names (`Palette.moneyIn`, `Palette.shortfall`), never raw colours, so a
future rescheme is one file.

Two properties of this palette drove the design and shouldn't be undone:

**It's one warm ramp, so the ends are mode-specific.** 5F021F scores 1.26:1
against a dark surface and FFF984 scores 1.07:1 against a light one — each is
invisible in one mode. The colorsets therefore *substitute* rather than reuse:
`BrandPrimary` is burgundy on light and brick on dark, `BrandAccent` is orange on
light and yellow on dark. Don't "simplify" them to single values.
`BrandHighlightFill` is the exception that stays pale yellow in both modes,
because it's only ever a background with dark ink on top.

**Backgrounds are coloured, not system grey.** `Palette.background` is a warm
cream in light and a burgundy-tinted near-black in dark, with `surface` one step
up for cards. Lists and Forms draw their own grouped background, so each screen
sets `.scrollContentBackground(.hidden)` and puts the brand colour behind —
without that, half the app falls back to system grey and the theme looks broken
on exactly the screens you don't screenshot.

**It can't carry categories.** Brick and orange sit ΔE 13.7 apart, below the 15
floor for distinguishing two series at a glance, and with five sale platforms
there aren't enough separable hues regardless. So colour here is *emphasis*, not
*identity*: every status and platform keeps its SF Symbol and text label, and the
colour is a second cue only. Adding a chart that distinguishes series by colour
alone would need a different palette.

## Charts

Both are single-series magnitude, so each uses one hue (`Palette.moneyIn` for
money in, `Palette.moneyOut` for spend) and needs no legend — the heading names
the series. Single-series is what makes the palette workable here: neither chart
asks a colour to distinguish one category from another.
Bars have rounded data-ends anchored to the baseline; grid and axes are
recessive. Month labels use `.abbreviated`, not `.narrow` — narrow renders both
March and May as "M".

The platform breakdown is a ranked list rather than a pie, which reads better
for three or four categories and avoids needing a categorical colour palette.

## Building an IPA to sideload

```sh
xcodebuild -project FundTracker.xcodeproj -scheme FundTracker \
  -configuration Release -sdk iphoneos -derivedDataPath build/device \
  CODE_SIGN_IDENTITY="" CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=NO build

mkdir -p Payload && cp -R build/device/Build/Products/Release-iphoneos/FundTracker.app Payload/
zip -qry FundTracker.ipa Payload && rm -rf Payload
```

Deliberately **unsigned**: Sideloadly, AltStore and SideStore re-sign with your
own Apple ID as they install, so a signature here would be discarded. The result
is a `Payload/FundTracker.app` zip, which is all an IPA is.

Free Apple IDs give a 7-day signature and a 3-app limit — that's an Apple
constraint, not something the build can change.

## Testing without a device

`PreviewData.container` gives an in-memory store with sample devices, parts and
sales. Every `#Preview` uses it. To see the app running with that data instead
of an empty store, temporarily point `FundTrackerApp` at
`.modelContainer(PreviewData.container)` — just remember to revert it.

Simulator has no camera, so the "Take Photo" button correctly hides itself there
(`UIImagePickerController.isCameraAvailable`).

## Verifying an animation without tapping

Driving the simulator by touch needs accessibility permission that isn't always
available. Animations can still be checked: record the screen, then measure how
much changes between frames.

```sh
xcrun simctl io <device> recordVideo --codec h264 --force out.mp4 &
# …trigger the change…
ffmpeg -ss <start> -i out.mp4 -vf "fps=60,scale=240:-1" frames/%03d.png
```

A working animation gives a ramp-plateau-taper across the frames lasting its
stated duration. A broken one gives a single large jump between two frames and
nothing either side — which is exactly how the `.id`/`.transition` ordering bug
above was caught. Pull two frames a few tens of milliseconds apart and stack them
with `hstack` to see the direction of travel.
