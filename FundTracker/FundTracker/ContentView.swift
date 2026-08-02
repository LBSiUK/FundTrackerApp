import SwiftUI
import SwiftData

struct ContentView: View {
    @Environment(SyncSettings.self) private var settings
    @Environment(SyncService.self) private var sync

    @Query private var devices: [Device]
    @Query private var sales: [Sale]

    /// How often a connected device pushes on its own. Pull-to-refresh sits on
    /// top of this for when a minute is too long to wait.
    private static let syncInterval: Duration = .seconds(60)

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
            await autoSync()
        }
    }

    /// Pushes on a timer for as long as the app is in the foreground.
    ///
    /// The loop lives here rather than in `SyncService` so it's tied to the
    /// view's lifetime — SwiftUI cancels the task when the view goes away, and
    /// there's no timer to remember to invalidate.
    private func autoSync() async {
        while !Task.isCancelled {
            if settings.isConfigured && !sync.isSyncing {
                await sync.sync(devices: devices, sales: sales, settings: settings)
            }

            do {
                try await Task.sleep(for: Self.syncInterval)
            } catch {
                return // cancelled
            }
        }
    }
}

#Preview {
    ContentView()
        .modelContainer(PreviewData.container)
        .environment(SyncSettings())
        .environment(SyncService())
}
