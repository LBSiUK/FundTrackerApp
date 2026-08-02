# The iOS app

SwiftUI + SwiftData, deployment target **iOS 18.0** (the `Tab(...)` initialisers
in `ContentView` require it). Swift 5 language mode, `SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor`.

Open `FundTracker/FundTracker.xcodeproj` and run. The project uses Xcode's
file-system-synchronised groups, so **adding a `.swift` file to the folder adds
it to the target automatically** — no pbxproj editing.

## Files

| File | What it does |
|---|---|
| `FundTrackerApp.swift` | Entry point. Sets up the `ModelContainer` and injects `SyncSettings` / `SyncService`. |
| `Models.swift` | `Device`, `Part`, `Sale` `@Model` classes plus `DeviceStatus` and `SalePlatform` enums. |
| `FundSummary.swift` | All derived money figures. Mirrored by `server/services/summary.js`. Also holds the `Double.currency` formatting helpers. |
| `SyncService.swift` | Wire DTOs and the `POST /api/sync` call. |
| `SyncSettings.swift` | Server URL (UserDefaults) + token (Keychain) + last-synced date. |
| `PreviewData.swift` | In-memory container with sample data, for `#Preview` only. |
| `ContentView.swift` | The three tabs. |
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

**Settings** (sheet from Insights) — server URL, token, Sync Now, last-synced.

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

**The token is in the Keychain**, not UserDefaults — it's a credential.
`kSecAttrAccessibleWhenUnlockedThisDeviceOnly`.

**No App Transport Security exemptions.** The dashboard is HTTPS on a public
hostname with a real certificate, so cleartext is blocked everywhere. An earlier
version had `NSAllowsLocalNetworking` for plain HTTP on the LAN; that was
removed once TLS was in place. If you ever go back to a LAN-only HTTP setup
you'll need to re-add it or connections fail silently.

## Charts

Both are single-series magnitude, so each uses one semantic hue (green for
money in, red for spend) and needs no legend — the heading names the series.
Bars have rounded data-ends anchored to the baseline; grid and axes are
recessive. Month labels use `.abbreviated`, not `.narrow` — narrow renders both
March and May as "M".

The platform breakdown is a ranked list rather than a pie, which reads better
for three or four categories and avoids needing a categorical colour palette.

## Testing without a device

`PreviewData.container` gives an in-memory store with sample devices, parts and
sales. Every `#Preview` uses it. To see the app running with that data instead
of an empty store, temporarily point `FundTrackerApp` at
`.modelContainer(PreviewData.container)` — just remember to revert it.

Simulator has no camera, so the "Take Photo" button correctly hides itself there
(`UIImagePickerController.isCameraAvailable`).
