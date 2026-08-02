import SwiftUI
import SwiftData

struct ContentView: View {
    @Environment(SyncSettings.self) private var settings
    @Environment(SyncService.self) private var sync
    @Environment(\.modelContext) private var modelContext

    /// How often a connected device pushes on its own. Changes sync straight
    /// away; this is the backstop for anything that didn't come through the
    /// model context.
    private static let syncInterval: Duration = .seconds(60)

    /// How long to wait after a change before pushing, so a burst of edits
    /// becomes one sync rather than five.
    private static let changeDebounce: Duration = .seconds(2)

    @State private var changeSync: Task<Void, Never>?

    /// Derived from the setting rather than copied into `@State`.
    ///
    /// It used to be seeded once in `.task`, which meant Reset App could clear
    /// `hasSeenOnboarding` and nothing would happen — the task had already run
    /// and never ran again. Reading it live means the cover reappears the
    /// moment the flag flips, whoever flipped it.
    private var showOnboarding: Binding<Bool> {
        Binding(
            get: { !settings.hasSeenOnboarding },
            set: { presented in
                if !presented { settings.hasSeenOnboarding = true }
            }
        )
    }

    var body: some View {
        TabView {
            Tab("Devices", systemImage: "wrench.and.screwdriver.fill") {
                DevicesView()
            }

            Tab("Sales", systemImage: "sterlingsign.circle.fill") {
                SalesView()
            }

            Tab("Insights", systemImage: "chart.bar.fill") {
                InsightsView()
            }

            Tab("Settings", systemImage: "gearshape.fill") {
                SettingsView()
            }
        }
        .fullScreenCover(isPresented: showOnboarding) {
            OnboardingView()
        }
        .task {
            await restoreIfNeeded()
            await autoSync()
        }
        // Every insert, update and delete lands here, so no editor has to
        // remember to ask for a sync after saving.
        .onReceive(NotificationCenter.default.publisher(for: ModelContext.didSave)) { _ in
            scheduleChangeSync()
        }
    }

    // MARK: - Reading the store
    //
    // Fetched at the moment of syncing rather than captured from an `@Query`.
    // A debounced task closing over a query result would push whatever the view
    // held when the timer started, not what's there when it fires.

    private func currentDevices() -> [Device] {
        (try? modelContext.fetch(FetchDescriptor<Device>())) ?? []
    }

    private func currentSales() -> [Sale] {
        (try? modelContext.fetch(FetchDescriptor<Sale>())) ?? []
    }

    // MARK: - Syncing

    /// Pulls the account's records down when this device has none.
    ///
    /// This is what makes signing in again after a reset work, and it has to
    /// run *before* the first push: a full replace from an empty device would
    /// otherwise take the account's records with it. The server refuses that
    /// too, but the app shouldn't rely on the server to save it.
    private func restoreIfNeeded() async {
        guard settings.isConfigured else { return }
        guard currentDevices().isEmpty, currentSales().isEmpty else { return }

        do {
            let snapshot = try await sync.fetchRemote(settings: settings)
            guard !snapshot.isEmpty else { return }
            await SnapshotRestore.apply(snapshot, into: modelContext, settings: settings, sync: sync)
        } catch {
            // Surfaced rather than swallowed: a failed restore and an empty
            // account look identical otherwise, and the difference matters —
            // one of them means your records are still on the server.
            sync.reportRestoreFailure(error)
        }
    }

    /// Pushes on a timer for as long as the app is in the foreground.
    ///
    /// The loop lives here rather than in `SyncService` so it's tied to the
    /// view's lifetime — SwiftUI cancels the task when the view goes away, and
    /// there's no timer to remember to invalidate.
    private func autoSync() async {
        while !Task.isCancelled {
            await syncNow()

            do {
                try await Task.sleep(for: Self.syncInterval)
            } catch {
                return // cancelled
            }
        }
    }

    private func scheduleChangeSync() {
        guard settings.isConfigured else { return }

        changeSync?.cancel()
        changeSync = Task {
            try? await Task.sleep(for: Self.changeDebounce)
            guard !Task.isCancelled else { return }
            await syncNow()
        }
    }

    private func syncNow() async {
        guard settings.isConfigured, !sync.isSyncing else { return }
        await sync.sync(devices: currentDevices(), sales: currentSales(), settings: settings)
    }
}

#Preview {
    ContentView()
        .modelContainer(PreviewData.container)
        .environment(SyncSettings())
        .environment(SyncService())
}
