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
| `PreviewData.swift` | Sample devices, parts and sales: an in-memory container for `#Preview`, and the records `-demo` seeds. |
| `DemoData.swift` | Debug only. The `-demo` launch argument: seeds an empty, never-connected install with the sample records. |
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

**Insights** — the headline cards, the affordability card, two charts and a
platform breakdown.

The three stat cards and "Parts Still To Buy" are sized to clear the fold
together on a standard iPhone: "can I afford the rest?" is the question the app
exists to answer, so reaching it shouldn't need a scroll. That's why `StatCard`
is tight (14pt vertical padding, 34pt figure, `.caption` strapline) — if it grows
again, check that block still fits before shipping. The charts below it are meant
to need scrolling.

**Onboarding** (full-screen on first launch) — the welcome screen asks offline or
online, then server address, then sign in *or* create an account. Steps carry an
`.id(step)` and an asymmetric transition, so moving forward slides the next step
in from the right while the current one leaves left.

**It's a real `NavigationStack`, not a hand-rolled transition.** Screens are
pushed with `navigationDestination(for:)` onto a `path`, which is what gives the
standard push animation, the back button and the interactive swipe-back edge
gesture. An earlier version animated a `switch` with `.transition` and `.id`;
that took two attempts to get the modifier order right, still didn't match the
system feel, and threw away the back gesture. If a flow reads as a stack of
screens, push them.

**Backgrounds use `.background(colour.ignoresSafeArea())`, never a clipped
container.** Putting `ignoresSafeArea` on the colour lets it run under the
navigation bar and home indicator while the content stays inside them. Clipping
the container instead trims the colour back to the safe area and leaves white
bands top and bottom — which is exactly what happened once.

Its presentation is a **computed binding** over `settings.hasSeenOnboarding`, not
`@State` seeded in `.task`. That was a real bug: Reset App cleared the flag and
nothing happened, because the task had already run and never ran again. Reading
it live means the cover reappears the moment the flag flips, whoever flipped it.

Onboarding continues: Creating one needs a one-time activation code issued from the
server's `/admin` page; there is no open sign-up. See
[ARCHITECTURE.md](ARCHITECTURE.md) for the flow. Offers "Set Up Later", because
the app is the source of truth and works with no server at all. Once dismissed
it doesn't reappear (`hasSeenOnboarding`); Settings can start it again.

**Settings** (its own tab) — which server and account this device is
signed in to, Sign Out, last-synced and the sync status. It shows the connected host, not an editable
token field: the token is issued by the server now, so there's nothing to type.
There is no Sync button — see below. A Danger Zone at the bottom holds **Reset App** (erases the
devices and sales on this device, leaving the account alone) and **Delete
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

The reverse catches people out too: a simulator build made with
`CODE_SIGNING_ALLOWED=NO` has no keychain entitlement, so `SecItemAdd` fails
silently. Sign-in and sync work for that session because the token is held in
memory, but the next launch reads no token and Settings offers "Set Up Server
Sync" again. Build normally; Xcode signs simulator builds locally without a team.

**A phone from before onboarding existed** keeps its shared token and isn't
dragged through setup — `init()` marks onboarding seen when `isConfigured` is
already true. Settings labels that state and suggests signing in properly.

**No App Transport Security exemptions.** The dashboard is HTTPS on a public
hostname with a real certificate, so cleartext is blocked everywhere. An earlier
version had `NSAllowsLocalNetworking` for plain HTTP on the LAN; that was
removed once TLS was in place. If you ever go back to a LAN-only HTTP setup
you'll need to re-add it or connections fail silently. Testing against a server
on the same Mac still works without it: the simulator reaches
`http://localhost:3100` with no exemption.

## The mark

`BrandLogo` draws two circular arrows turning around a £ — the sync idea and the
thing being tracked in one glyph. It's `arrow.triangle.2.circlepath` with the £
laid over it in a ZStack rather than a bundled image, so it stays sharp at any
size and takes the tint in both colour schemes. `BrandLockup` adds the wordmark
in **Didot**, which ships with iOS; if it were ever missing SwiftUI falls back to
the system face rather than failing to draw.

## Primary actions sit at the bottom

Onboarding's Continue and Sign In are pushed down by a flexible spacer and use
`.controlSize(.extraLarge)`, so they're full-height iOS buttons within thumb
reach rather than floating under the content that precedes them.

## Syncing

Automatic, and two-way.

**Restore comes first.** `ContentView.restoreIfNeeded` runs before the sync loop
and pulls the account's records when this device has none — that's what makes
signing in after a reset show your data again. It must stay ahead of the first
push: an empty device doing a full replace is how the records got lost.

It hangs off **`.task(id: settings.token)`**, and the `id:` is the load-bearing
part. A plain `.task` runs once when the view appears — at launch, before any
credential exists — and dismissing the onboarding cover doesn't bring it back,
because `ContentView` never went away. Keyed on the token, signing in restarts
it. This is the second time a plain `.task` has silently broken something here;
see the onboarding cover binding above.

Records are fetched fresh from the model context at the moment of syncing rather
than captured from an `@Query`. A debounced task closing over a query result
pushes whatever the view held when the timer started, not what's there when it
fires.

**Changes sync immediately.** `ModelContext.didSave` drives a 2-second debounced
push, so a burst of edits becomes one sync and no editor has to remember to ask. `ContentView` runs a `.task` loop pushes every 60 seconds as a backstop, and
`.syncOnRefresh()` adds pull-to-refresh to Devices, Sales and Insights. There is
no manual Sync button.

The loop lives in the view rather than in `SyncService` deliberately: SwiftUI
cancels a `.task` when the view goes away, so there's no timer to remember to
invalidate and nothing keeps running after the app leaves the foreground.

`syncOnRefresh()` is a `ViewModifier` holding its own `@Query`, so the three
screens that use it don't have to know anything about sync to offer it.

## Alerts, not confirmation dialogs, for destructive actions

`.confirmationDialog` anchors to the view it's attached to, which put the Erase
Everything sheet in the wrong place entirely — floating mid-screen with a tail
pointing at nothing. `.alert` centres predictably and handles a paragraph of
explanation, which these need.

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
sales. Every `#Preview` uses it.

To see the app running with the same data, launch a Debug build with the
`-demo` argument (Product > Scheme > Edit Scheme > Run > Arguments, or
`xcrun simctl launch booted uk.lbsi.FundTracker -demo`). `DemoData.swift` copies
the sample records into the real store and skips onboarding as if "Stay
offline" had been chosen. It only does this on an install with no records that
has never been signed in to a server, so sample data can't be synced over a real
account. Settings > Reset App clears it. The whole file is `#if DEBUG`, so
Release builds don't contain it.

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

A working animation gives sustained change across many frames for its full
duration. A broken one gives a single large jump between two frames and nothing
either side. A native push shows a front-loaded decay over roughly 470ms — fast
start, long settle — which is visibly different from a hand-rolled linear ease.

To see *what* moved rather than just how much, tile a wide window into one image:

```sh
ffmpeg -ss <start> -t 1 -i out.mp4 -vf "fps=10,scale=170:-1,tile=10x1" strip.png
```

That shows the whole transition at a glance — the outgoing screen parallaxing
left while the incoming slides in, and whether the back chevron appears.
