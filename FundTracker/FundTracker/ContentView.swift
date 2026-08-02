import SwiftUI
import SwiftData

struct ContentView: View {
    @Environment(SyncSettings.self) private var settings

    @State private var showOnboarding = false

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
        .fullScreenCover(isPresented: $showOnboarding) {
            OnboardingView()
        }
        .task {
            showOnboarding = !settings.hasSeenOnboarding
        }
    }
}

#Preview {
    ContentView()
        .modelContainer(PreviewData.container)
        .environment(SyncSettings())
        .environment(SyncService())
}
