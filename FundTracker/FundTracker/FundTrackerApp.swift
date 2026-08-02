import SwiftUI
import SwiftData

@main
struct FundTrackerApp: App {
    @State private var syncSettings = SyncSettings()
    @State private var syncService = SyncService()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(syncSettings)
                .environment(syncService)
        }
        .modelContainer(for: [Device.self, Part.self, Sale.self])
    }
}
