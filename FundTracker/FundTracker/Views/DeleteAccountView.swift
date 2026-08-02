import SwiftData
import SwiftUI

/// Removes the account from the server, then clears this phone.
///
/// Asks for the password rather than relying on the sync token already stored
/// here. The token is a write-scoped credential — "can upload records" should
/// not silently imply "can destroy the account".
struct DeleteAccountView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext
    @Environment(SyncSettings.self) private var settings
    @Environment(SyncService.self) private var sync

    @Query private var devices: [Device]
    @Query private var sales: [Sale]

    @State private var password = ""
    @State private var alsoEraseLocal = true
    @State private var isBusy = false
    @State private var errorMessage: String?
    @State private var confirming = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LabeledContent("Account", value: settings.accountEmail.isEmpty ? "—" : settings.accountEmail)
                    LabeledContent("Server", value: ServerAddress.normalise(settings.serverURL)?.host ?? settings.serverURL)
                } footer: {
                    Text("Deleting removes the account and every device signed in with it. The dashboard's stored copy of your records goes with it.")
                }

                Section {
                    SecureField("Password", text: $password)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .textContentType(.password)
                        .disabled(isBusy)

                    Toggle("Also erase records on this phone", isOn: $alsoEraseLocal)
                        .disabled(isBusy)
                } footer: {
                    if alsoEraseLocal {
                        Text("Your \(devices.count) device\(devices.count == 1 ? "" : "s") and \(sales.count) sale\(sales.count == 1 ? "" : "s") will be deleted here too.")
                    } else {
                        Text("Your records stay on this phone. You can sign in to another server later.")
                    }
                }

                Section {
                    Button(role: .destructive) {
                        confirming = true
                    } label: {
                        HStack {
                            Text(isBusy ? "Deleting…" : "Delete Account")
                            Spacer()
                            if isBusy { ProgressView() }
                        }
                    }
                    .disabled(password.isEmpty || isBusy)
                } footer: {
                    if let errorMessage {
                        Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(Palette.secondary)
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Palette.background)
            .navigationTitle("Delete Account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .disabled(isBusy)
                }
            }
            .confirmationDialog(
                "Delete this account permanently?",
                isPresented: $confirming,
                titleVisibility: .visible
            ) {
                Button("Delete Account", role: .destructive) {
                    Task { await deleteAccount() }
                }
            } message: {
                Text("This can't be undone.")
            }
        }
    }

    private func deleteAccount() async {
        errorMessage = nil
        isBusy = true
        defer { isBusy = false }

        do {
            try await sync.deleteAccount(
                address: settings.serverURL,
                email: settings.accountEmail,
                password: password
            )
            password = ""

            if alsoEraseLocal {
                for device in devices { modelContext.delete(device) }
                for sale in sales { modelContext.delete(sale) }
                try? modelContext.save()
            }

            // The token now points at an account that no longer exists.
            settings.signOut()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

#Preview {
    DeleteAccountView()
        .modelContainer(PreviewData.container)
        .environment(SyncSettings())
        .environment(SyncService())
}
