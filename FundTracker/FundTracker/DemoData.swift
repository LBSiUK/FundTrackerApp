#if DEBUG
import Foundation
import SwiftData

/// The `-demo` launch argument, Debug builds only.
///
/// Fills an empty install with the sample records from `PreviewData` and skips
/// onboarding as if "Stay offline" had been chosen, so the app can be tried or
/// screenshotted without typing everything in. Add it under Product > Scheme >
/// Edit Scheme > Arguments, or pass it to `xcrun simctl launch`.
///
/// It refuses to run on an install that has ever been signed in to a server,
/// so sample records can't be synced over a real account. Settings > Reset App
/// clears them again.
@MainActor
enum DemoData {
    static var isRequested: Bool {
        ProcessInfo.processInfo.arguments.contains("-demo")
    }

    static func seedIfRequested(settings: SyncSettings) {
        guard isRequested else { return }

        guard !settings.isConfigured, !settings.hasEverConnected else {
            print("[demo] Skipped: this install has been connected to a server.")
            return
        }

        do {
            // The same default store the app opens with `.modelContainer(for:)`.
            // It is saved and released before the app opens its own.
            let container = try ModelContainer(for: Device.self, Part.self, Sale.self)
            let context = ModelContext(container)

            let existing = try context.fetchCount(FetchDescriptor<Device>())
                + context.fetchCount(FetchDescriptor<Sale>())
            guard existing == 0 else {
                print("[demo] Skipped: this install already has records.")
                return
            }

            PreviewData.seed(into: context)
            try context.save()
        } catch {
            print("[demo] Could not seed sample records: \(error)")
            return
        }

        settings.mode = .offline
        settings.hasSeenOnboarding = true
        print("[demo] Seeded sample devices, parts and sales.")
    }
}
#endif
