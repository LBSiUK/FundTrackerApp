import SwiftUI
import SwiftData

@main
struct FundTrackerApp: App {
    @State private var syncSettings: SyncSettings
    @State private var syncService = SyncService()

    init() {
        let settings = SyncSettings()
        #if DEBUG
        DemoData.seedIfRequested(settings: settings)
        #endif
        _syncSettings = State(initialValue: settings)
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(syncSettings)
                .environment(syncService)
        }
        .modelContainer(for: [Device.self, Part.self, Sale.self])
    }
}
