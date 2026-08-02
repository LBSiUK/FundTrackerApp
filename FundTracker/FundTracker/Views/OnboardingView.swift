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
        case choose
        case address
        case signIn
    }

    /// Sign in to an existing account, or make one with an activation code.
    private enum Mode: String, CaseIterable {
        case signIn = "Sign In"
        case createAccount = "Create Account"
    }

    @State private var step: Step = .choose
    @State private var mode: Mode = .signIn
    @State private var address = ""
    @State private var email = ""
    @State private var password = ""
    @State private var confirmPassword = ""
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
                case .choose: chooseStep
                case .address: addressStep
                case .signIn: signInStep
                }
            }
            .padding(.horizontal)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if step != .choose {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Back") { goBack() }
                            .disabled(isBusy)
                    }
                }
            }
        }
        .onAppear {
            // Pre-fill after a sign-out, so reconnecting isn't a retype.
            if address.isEmpty { address = settings.serverURL }
            // A phone that has had an account can't go back to offline, so
            // there's nothing to choose — go straight to the address.
            if !settings.canGoOffline { step = .address }
        }
    }

    private var title: String {
        switch step {
        case .choose: "Welcome"
        case .address: "Connect"
        case .signIn: mode == .signIn ? "Sign In" : "Create Account"
        }
    }

    // MARK: - Step 0

    private var chooseStep: some View {
        VStack(alignment: .leading, spacing: 20) {
            VStack(alignment: .leading, spacing: 8) {
                Image(systemName: "sterlingsign.circle.fill")
                    .font(.largeTitle)
                    .foregroundStyle(.tint)

                Text("How do you want to use FundTracker?")
                    .font(.title2.bold())

                Text("Everything works on this phone either way. A dashboard just adds a browser view of the same figures.")
                    .foregroundStyle(.secondary)
            }

            Button {
                step = .address
            } label: {
                choice(
                    title: "Use an account",
                    detail: "Sync to a server you run, and view your fund in a browser.",
                    icon: "icloud.and.arrow.up"
                )
            }
            .buttonStyle(.glassProminent)

            Button {
                settings.mode = .offline
                finish()
            } label: {
                choice(
                    title: "Stay offline",
                    detail: "Keep everything on this phone. You can create an account later and bring these records with you.",
                    icon: "iphone"
                )
            }
            .buttonStyle(.glass)

            // Stated up front rather than discovered later, because it's the
            // one direction that doesn't reverse.
            Text("Offline records can join an account later. Once an account holds them, they can't be taken back offline.")
                .font(.footnote)
                .foregroundStyle(.secondary)

            Spacer()
        }
    }

    private func choice(title: String, detail: String, icon: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .font(.title3)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.headline)
                Text(detail)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 6)
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
                    .submitLabel(mode == .signIn ? .go : .next)
                    .disabled(isBusy)
                    .onSubmit { if mode == .signIn { Task { await submitSignIn() } } }

                if mode == .createAccount {
                    SecureField("Confirm password", text: $confirmPassword)
                        .textFieldStyle(.roundedBorder)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .textContentType(.newPassword)
                        .submitLabel(.go)
                        .disabled(isBusy)
                        .onSubmit { Task { await submitSignIn() } }
                }
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
        guard mode == .createAccount else { return true }
        return !activationCode.trimmingCharacters(in: .whitespaces).isEmpty && !confirmPassword.isEmpty
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

    private func goBack() {
        password = ""
        confirmPassword = ""
        errorMessage = nil
        step = step == .signIn ? .address : (settings.canGoOffline ? .choose : .address)
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
                guard password == confirmPassword else {
                    errorMessage = "The passwords don't match."
                    return
                }
                credential = try await sync.register(
                    address: address,
                    email: email,
                    password: password,
                    confirmPassword: confirmPassword,
                    code: activationCode,
                    deviceName: UIDevice.current.name
                )
            }
            // Clear the secrets from memory as soon as they've done their job.
            password = ""
            confirmPassword = ""
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
