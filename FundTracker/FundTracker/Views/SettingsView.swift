import SwiftUI
import SwiftData

struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(SyncSettings.self) private var settings
    @Environment(SyncService.self) private var sync

    @Query private var devices: [Device]
    @Query private var sales: [Sale]

    @State private var showOnboarding = false
    @State private var confirmSignOut = false

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
                    Text("Device photos stay on this phone — they aren't uploaded.")
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
        }
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
                .foregroundStyle(.green)
        case .failure(let message):
            Label(message, systemImage: "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)
        case .idle, .syncing:
            Text("Sends everything to your dashboard, replacing what's there.")
        }
    }
}

#Preview {
    SettingsView()
        .modelContainer(PreviewData.container)
        .environment(SyncSettings())
        .environment(SyncService())
}
