import SwiftUI
import UIKit

/// First-run connection flow: point the app at a server, confirm it really is
/// one, then sign in. Two steps rather than one form, so the address is proven
/// reachable before anyone types a password into it.
struct OnboardingView: View {
    @Environment(SyncSettings.self) private var settings
    @Environment(SyncService.self) private var sync
    @Environment(\.dismiss) private var dismiss

    private enum Step {
        case address
        case signIn
    }

    /// Sign in to an existing account, or make one with an activation code.
    private enum Mode: String, CaseIterable {
        case signIn = "Sign In"
        case createAccount = "Create Account"
    }

    @State private var step: Step = .address
    @State private var mode: Mode = .signIn
    @State private var address = ""
    @State private var email = ""
    @State private var password = ""
    @State private var activationCode = ""
    @State private var isBusy = false
    @State private var errorMessage: String?

    /// Shown on the sign-in step so it's clear which host is about to receive
    /// the password. Self-hosted means the address came from somewhere, and
    /// "somewhere" deserves to be visible at the moment it matters.
    @State private var confirmedHost = ""

    var body: some View {
        NavigationStack {
            Group {
                switch step {
                case .address: addressStep
                case .signIn: signInStep
                }
            }
            .padding(.horizontal)
            .navigationTitle(step == .address ? "Connect" : "Sign In")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if step == .signIn {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Back") { backToAddress() }
                            .disabled(isBusy)
                    }
                }
            }
        }
        .onAppear {
            // Pre-fill after a sign-out, so reconnecting isn't a retype.
            if address.isEmpty { address = settings.serverURL }
        }
    }

    // MARK: - Step 1

    private var addressStep: some View {
        VStack(alignment: .leading, spacing: 20) {
            VStack(alignment: .leading, spacing: 8) {
                Image(systemName: "externaldrive.badge.wifi")
                    .font(.largeTitle)
                    .foregroundStyle(.tint)

                Text("Where is your dashboard?")
                    .font(.title2.bold())

                Text("FundTracker syncs to a server you run yourself. Enter its address to get started.")
                    .foregroundStyle(.secondary)
            }

            TextField("fundtracker.example.com", text: $address)
                .textFieldStyle(.roundedBorder)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.URL)
                .submitLabel(.continue)
                .disabled(isBusy)
                .onSubmit { Task { await checkAddress() } }

            Text("https:// is assumed if you leave it out.")
                .font(.footnote)
                .foregroundStyle(.secondary)

            if let errorMessage {
                Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                    .font(.footnote)
                    .foregroundStyle(Palette.secondary)
            }

            Button {
                Task { await checkAddress() }
            } label: {
                HStack {
                    Spacer()
                    if isBusy { ProgressView().padding(.trailing, 4) }
                    Text(isBusy ? "Checking…" : "Continue")
                    Spacer()
                }
            }
            .buttonStyle(.glassProminent)
            .disabled(address.trimmingCharacters(in: .whitespaces).isEmpty || isBusy)

            // The phone is the source of truth and works entirely offline, so
            // a dashboard is optional. Settings can pick this up later.
            Button("Set Up Later") { finish() }
                .buttonStyle(.glass)
                .disabled(isBusy)
                .frame(maxWidth: .infinity)

            Spacer()
        }
    }

    // MARK: - Step 2

    private var signInStep: some View {
        VStack(alignment: .leading, spacing: 20) {
            VStack(alignment: .leading, spacing: 8) {
                Image(systemName: "lock.shield")
                    .font(.largeTitle)
                    .foregroundStyle(.tint)

                Text(mode == .signIn ? "Sign in" : "Create an account")
                    .font(.title2.bold())

                Text("Your password goes to **\(confirmedHost)** and isn't kept on this phone. It's exchanged for a sync token that can upload records but can't read them back.")
                    .foregroundStyle(.secondary)
            }

            Picker("Mode", selection: $mode) {
                ForEach(Mode.allCases, id: \.self) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .disabled(isBusy)
            .onChange(of: mode) { errorMessage = nil }

            VStack(spacing: 12) {
                if mode == .createAccount {
                    TextField("Activation code", text: $activationCode)
                        .textFieldStyle(.roundedBorder)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .font(.body.monospaced())
                        .disabled(isBusy)
                }

                TextField("Email", text: $email)
                    .textFieldStyle(.roundedBorder)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.emailAddress)
                    .textContentType(.username)
                    .disabled(isBusy)

                SecureField("Password", text: $password)
                    .textFieldStyle(.roundedBorder)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .textContentType(mode == .signIn ? .password : .newPassword)
                    .submitLabel(.go)
                    .disabled(isBusy)
                    .onSubmit { Task { await submitSignIn() } }
            }

            if mode == .createAccount {
                Text("Accounts need a one-time activation code from whoever runs the server.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            if let errorMessage {
                Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                    .font(.footnote)
                    .foregroundStyle(Palette.secondary)
            }

            Button {
                Task { await submitSignIn() }
            } label: {
                HStack {
                    Spacer()
                    if isBusy { ProgressView().padding(.trailing, 4) }
                    Text(busyLabel)
                    Spacer()
                }
            }
            .buttonStyle(.glassProminent)
            .disabled(!canSubmit || isBusy)

            Spacer()
        }
    }

    private var canSubmit: Bool {
        guard !email.isEmpty, !password.isEmpty else { return false }
        return mode == .signIn || !activationCode.trimmingCharacters(in: .whitespaces).isEmpty
    }

    private var busyLabel: String {
        if isBusy { return mode == .signIn ? "Signing in…" : "Creating…" }
        return mode.rawValue
    }

    // MARK: - Actions

    private func finish() {
        settings.hasSeenOnboarding = true
        dismiss()
    }

    private func backToAddress() {
        password = ""
        errorMessage = nil
        step = .address
    }

    private func checkAddress() async {
        errorMessage = nil
        isBusy = true
        defer { isBusy = false }

        do {
            let setupRequired = try await sync.checkServer(address)

            guard !setupRequired else {
                errorMessage = SyncError.setupRequired.localizedDescription
                return
            }

            confirmedHost = ServerAddress.normalise(address)?.host ?? address
            step = .signIn
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func submitSignIn() async {
        errorMessage = nil
        isBusy = true
        defer { isBusy = false }

        do {
            let credential: DeviceCredential
            switch mode {
            case .signIn:
                credential = try await sync.signIn(
                    address: address,
                    email: email,
                    password: password,
                    deviceName: UIDevice.current.name
                )
            case .createAccount:
                credential = try await sync.register(
                    address: address,
                    email: email,
                    password: password,
                    code: activationCode,
                    deviceName: UIDevice.current.name
                )
            }
            // Clear the secrets from memory as soon as they've done their job.
            password = ""
            activationCode = ""
            settings.apply(credential, serverURL: address)
            finish()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

#Preview {
    OnboardingView()
        .environment(SyncSettings())
        .environment(SyncService())
}
