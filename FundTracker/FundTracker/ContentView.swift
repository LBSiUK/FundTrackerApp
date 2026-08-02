import SwiftUI
import SwiftData

struct ContentView: View {
    @Environment(SyncSettings.self) private var settings

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
        }
        .fullScreenCover(isPresented: showOnboarding) {
            OnboardingView()
        }
    }
}

#Preview {
    ContentView()
        .modelContainer(PreviewData.container)
        .environment(SyncSettings())
        .environment(SyncService())
}
