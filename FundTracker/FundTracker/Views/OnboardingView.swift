import SwiftUI
import UIKit

/// First-run connection flow: point the app at a server, confirm it really is
/// one, then sign in. Two steps rather than one form, so the address is proven
/// reachable before anyone types a password into it.
struct OnboardingView: View {
    @Environment(SyncSettings.self) private var settings
    @Environment(SyncService.self) private var sync
    @Environment(\.dismiss) private var dismiss

    /// Screens pushed after the first one. The welcome screen is the stack's
    /// root, so it isn't in here.
    private enum Route: Hashable {
        case address
        case signIn
    }

    /// Sign in to an existing account, or make one with an activation code.
    private enum Mode: String, CaseIterable {
        case signIn = "Sign In"
        case createAccount = "Create Account"
    }

    @State private var path: [Route] = []
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
        // A real navigation stack rather than a hand-rolled transition. Pushing
        // a destination is what gives the standard slide-in from the right, and
        // brings the back button and the interactive swipe-back edge gesture
        // with it — none of which is worth reimplementing.
        NavigationStack(path: $path) {
            rootStep
                .navigationDestination(for: Route.self) { route in
                    switch route {
                    case .address:
                        addressStep.onboardingScreen(title: "Connect")
                    case .signIn:
                        signInStep.onboardingScreen(title: mode.rawValue)
                    }
                }
        }
        .onAppear {
            // Pre-fill after a sign-out, so reconnecting isn't a retype.
            if address.isEmpty { address = settings.serverURL }
        }
        .onChange(of: path) { _, newPath in
            // Leaving the sign-in screen, by the back button or the swipe
            // gesture, shouldn't leave a password sitting in memory.
            if !newPath.contains(.signIn) {
                password = ""
                confirmPassword = ""
            }
            errorMessage = nil
        }
    }

    /// A phone that has had an account can't go back offline, so there's nothing
    /// to choose — the address screen is the root instead, and no back button
    /// offers a way to a decision that isn't available.
    @ViewBuilder
    private var rootStep: some View {
        if settings.canGoOffline {
            chooseStep.onboardingScreen(title: "Welcome")
        } else {
            addressStep.onboardingScreen(title: "Connect")
        }
    }

    // MARK: - Step 0

    private var chooseStep: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 12)

            BrandLockup(logoSize: 150)

            Spacer(minLength: 24)

            Text("How do you want to use FundTracker?")
                .font(.title2.bold())
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.bottom, 24)

            VStack(spacing: 14) {
                Button {
                    path.append(.address)
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
            }
            // Same shape on both, so neither reads as the "real" one by virtue
            // of its outline.
            .buttonBorderShape(.roundedRectangle(radius: 26))

            Spacer(minLength: 24)

            // Stated up front rather than discovered later, because it's the one
            // direction that doesn't reverse.
            Text("Offline records can join an account later. Once an account holds them, they can't be taken back offline.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.bottom, 8)
        }
    }

    /// Both choices use this, so they end up the same height and shape however
    /// long the wording is.
    private func choice(title: String, detail: String, icon: String) -> some View {
        HStack(spacing: 14) {
            Image(systemName: icon)
                .font(.title2)
                .frame(width: 34)

            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.headline)
                Text(detail)
                    .font(.footnote)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 0)
        }
        .padding(.vertical, 4)
        // A fixed height is what actually makes the two match; without it the
        // shorter label gives a shorter button.
        .frame(height: 96)
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
            path.append(.signIn)
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

/// Shared chrome for every onboarding screen.
private extension View {
    func onboardingScreen(title: String) -> some View {
        self
            .padding(.horizontal)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            // `ignoresSafeArea` goes on the *background colour*, not the
            // container. That lets the colour run under the navigation bar and
            // home indicator while the content stays inside them. Clipping the
            // container instead — which is what the previous version did —
            // trims the colour back to the safe area and leaves white bands at
            // the top and bottom.
            .background(Palette.background.ignoresSafeArea())
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
    }
}

#Preview {
    OnboardingView()
        .environment(SyncSettings())
        .environment(SyncService())
}
