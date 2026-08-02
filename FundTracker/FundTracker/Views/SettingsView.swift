import SwiftUI
import SwiftData

struct SettingsView: View {
    @Environment(SyncSettings.self) private var settings
    @Environment(SyncService.self) private var sync

    @Query private var devices: [Device]
    @Query private var sales: [Sale]

    @Environment(\.modelContext) private var modelContext

    @State private var showOnboarding = false
    @State private var confirmSignOut = false
    @State private var confirmReset = false
    @State private var showDeleteAccount = false

    var body: some View {
        NavigationStack {
            Form {
                if settings.isConfigured {
                    connectedSection
                } else {
                    disconnectedSection
                }

                Section {
                    if let lastSyncedAt = settings.lastSyncedAt {
                        LabeledContent(
                            "Last synced",
                            value: lastSyncedAt.formatted(date: .abbreviated, time: .shortened)
                        )
                    } else {
                        LabeledContent("Last synced", value: "Never")
                    }
                } header: {
                    Text("Sync")
                } footer: {
                    statusFooter
                }

                Section {
                    // Always available: the point of a reset is to get out of
                    // whatever state you're in, including a broken one.
                    Button("Reset App", role: .destructive) { confirmReset = true }

                    if settings.isConfigured {
                        Button("Delete Account", role: .destructive) { showDeleteAccount = true }
                    }
                } header: {
                    Text("Danger Zone")
                } footer: {
                    Text("Reset erases the devices and sales on this device and starts setup again. Delete Account also removes your account from the server.")
                }
            }
            .scrollContentBackground(.hidden)
            .background(Palette.background)
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .fullScreenCover(isPresented: $showOnboarding) {
                OnboardingView()
            }
            .alert("Sign out of your server?", isPresented: $confirmSignOut) {
                Button("Cancel", role: .cancel) {}
                Button("Sign Out", role: .destructive) { settings.signOut() }
            } message: {
                Text("Your devices and sales stay on this device. The server keeps its last synced copy until another device replaces it.")
            }
            .alert("Erase everything on this device?", isPresented: $confirmReset) {
                Button("Cancel", role: .cancel) {}
                Button("Erase Everything", role: .destructive) { resetEverything() }
            } message: {
                Text("Deletes every device, part and sale stored here, signs out, and starts setup again. Your account and anything already synced are left alone. This can't be undone.")
            }
            .sheet(isPresented: $showDeleteAccount) {
                DeleteAccountView()
            }
        }
    }

    /// Wipes local records, signs out and returns to onboarding. The account
    /// and the server's copy are untouched — this is "start again on this
    /// device", not "delete everything I own".
    private func resetEverything() {
        for device in devices { modelContext.delete(device) }
        for sale in sales { modelContext.delete(sale) }
        try? modelContext.save()

        // Clears hasEverConnected too, so the offline/online question is
        // genuinely open again rather than half-answered. ContentView watches
        // hasSeenOnboarding, so clearing it is what brings setup back.
        settings.reset()
    }

    // MARK: - Connection

    @ViewBuilder
    private var connectedSection: some View {
        Section {
            LabeledContent("Server", value: ServerAddress.normalise(settings.serverURL)?.host ?? settings.serverURL)

            if !settings.accountEmail.isEmpty {
                LabeledContent("Account", value: settings.accountEmail)
            }

            Button("Sign Out", role: .destructive) { confirmSignOut = true }
        } header: {
            Text("Server")
        } footer: {
            if settings.isUsingLegacyToken {
                Text("This device still uses an old shared server token. Sign out and back in to give it its own, which can be revoked separately.")
            } else {
                Text("This device holds a sync token, not your password. It syncs this account's records both ways, and can't reach any other account.")
            }
        }
    }

    @ViewBuilder
    private var disconnectedSection: some View {
        Section {
            Button("Set Up Server Sync") { showOnboarding = true }
        } header: {
            Text("Server")
        } footer: {
            Text("Connection to a server is optional, however it will allow you to sync your data across devices.")
        }
    }

    @ViewBuilder
    private var statusFooter: some View {
        switch sync.state {
        case .success:
            Label("Up to date.", systemImage: "checkmark.circle.fill")
                .foregroundStyle(Palette.accent)
        case .uploadingPhotos(let done, let total):
            Text("Uploading photos… \(done) of \(total)")
        case .partial(let message):
            Label(message, systemImage: "exclamationmark.circle.fill")
                .foregroundStyle(Palette.secondary)
        case .failure(let message):
            Label(message, systemImage: "exclamationmark.triangle.fill")
                .foregroundStyle(Palette.secondary)
        case .idle, .syncing:
            Text("Syncs automatically every minute, and whenever you pull down to refresh. Device photos are uploaded too.")
        }
    }
}

#Preview {
    SettingsView()
        .modelContainer(PreviewData.container)
        .environment(SyncSettings())
        .environment(SyncService())
}
