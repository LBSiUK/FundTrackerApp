import SwiftData
import SwiftUI

/// Pull-to-refresh that syncs.
///
/// Its own modifier because three screens need it and none of them otherwise
/// care about sync — `@Query` lives here rather than being threaded through
/// every view that happens to have a list.
private struct SyncOnRefresh: ViewModifier {
    @Environment(SyncSettings.self) private var settings
    @Environment(SyncService.self) private var sync

    @Query private var devices: [Device]
    @Query private var sales: [Sale]

    func body(content: Content) -> some View {
        content.refreshable {
            guard settings.isConfigured, !sync.isSyncing else { return }
            await sync.sync(devices: devices, sales: sales, settings: settings)
        }
    }
}

extension View {
    /// Adds pull-to-refresh that pushes to the server. No-op when this device
    /// isn't connected to one.
    func syncOnRefresh() -> some View {
        modifier(SyncOnRefresh())
    }
}
