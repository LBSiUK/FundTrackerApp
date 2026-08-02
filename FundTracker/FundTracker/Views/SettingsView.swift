import SwiftUI
import SwiftData

struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(SyncSettings.self) private var settings
    @Environment(SyncService.self) private var sync

    @Query private var devices: [Device]
    @Query private var sales: [Sale]

    var body: some View {
        @Bindable var settings = settings

        NavigationStack {
            Form {
                Section {
                    TextField("https://fundtracker.example.com", text: $settings.serverURL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)

                    SecureField("Access token", text: $settings.token)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } header: {
                    Text("Dashboard")
                } footer: {
                    Text("The token must match FUNDTRACKER_TOKEN on the server. It's stored in the Keychain.")
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
