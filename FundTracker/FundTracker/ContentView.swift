import SwiftUI
import SwiftData

struct ContentView: View {
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
    }
}

#Preview {
    ContentView()
        .modelContainer(PreviewData.container)
        .environment(SyncSettings())
        .environment(SyncService())
}
