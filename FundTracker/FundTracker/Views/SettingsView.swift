import SwiftUI
import SwiftData

struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss
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
                    Button {
                        Task {
                            await sync.sync(devices: devices, sales: sales, settings: settings)
                        }
                    } label: {
                        HStack {
                            Text(sync.isSyncing ? "Syncing…" : "Sync Now")
                            Spacer()
                            if sync.isSyncing { ProgressView() }
                        }
                    }
                    .disabled(!settings.isConfigured || sync.isSyncing)

                    if let lastSyncedAt = settings.lastSyncedAt {
                        LabeledContent(
                            "Last synced",
                            value: lastSyncedAt.formatted(date: .abbreviated, time: .shortened)
                        )
                    }
                } header: {
                    Text("Sync")
                } footer: {
                    statusFooter
                }

                Section {
                    LabeledContent("Devices", value: "\(devices.count)")
                    LabeledContent("Sales", value: "\(sales.count)")
                } header: {
                    Text("What Gets Sent")
                } footer: {
                    Text("Device photos are uploaded too, and are visible to anyone who can sign in to your dashboard.")
                }

                Section {
                    Button("Reset App", role: .destructive) { confirmReset = true }
                        .disabled(devices.isEmpty && sales.isEmpty)

                    if settings.isConfigured {
                        Button("Delete Account", role: .destructive) { showDeleteAccount = true }
                    }
                } header: {
                    Text("Danger Zone")
                } footer: {
                    Text("Reset erases the devices and sales on this phone. Delete Account also removes your account from the server.")
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .fullScreenCover(isPresented: $showOnboarding) {
                OnboardingView()
            }
            .confirmationDialog(
                "Sign out of the dashboard?",
                isPresented: $confirmSignOut,
                titleVisibility: .visible
            ) {
                Button("Sign Out", role: .destructive) { settings.signOut() }
            } message: {
                Text("Your devices and sales stay on this phone. The dashboard keeps its last synced copy until another device replaces it.")
            }
            .confirmationDialog(
                "Erase everything on this phone?",
                isPresented: $confirmReset,
                titleVisibility: .visible
            ) {
                Button("Erase Everything", role: .destructive) { resetLocalData() }
            } message: {
                Text("Deletes every device, part and sale stored here. Your account and anything already on the dashboard are left alone. This can't be undone.")
            }
            .sheet(isPresented: $showDeleteAccount) {
                DeleteAccountView()
            }
        }
    }

    /// Wipes local records. The account and the server copy are untouched —
    /// this is "start again on this phone", not "delete everything I own".
    private func resetLocalData() {
        for device in devices { modelContext.delete(device) }
        for sale in sales { modelContext.delete(sale) }
        try? modelContext.save()
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
            Text("Dashboard")
        } footer: {
            if settings.isUsingLegacyToken {
                Text("This phone still uses the old shared server token. Sign out and back in to give it its own, which can be revoked on its own.")
            } else {
                Text("This phone holds a sync token, not your password. It can upload records but can't read them back.")
            }
        }
    }

    @ViewBuilder
    private var disconnectedSection: some View {
        Section {
            Button("Connect to a Dashboard") { showOnboarding = true }
        } header: {
            Text("Dashboard")
        } footer: {
            Text("Optional. Everything works on this phone without one — a dashboard just lets you view the same figures in a browser.")
        }
    }

    @ViewBuilder
    private var statusFooter: some View {
        switch sync.state {
        case .success:
            Label("Pushed to the dashboard.", systemImage: "checkmark.circle.fill")
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
            Text("Sends everything to your dashboard, replacing what's there. Device photos are uploaded too.")
        }
    }
}

#Preview {
    SettingsView()
        .modelContainer(PreviewData.container)
        .environment(SyncSettings())
        .environment(SyncService())
}
