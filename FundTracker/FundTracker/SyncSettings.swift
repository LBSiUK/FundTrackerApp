import Foundation
import Security
import SwiftUI

/// Server address and access token for the web dashboard.
/// The address is an ordinary preference; the token is a credential, so it
/// lives in the Keychain rather than UserDefaults.
@MainActor
@Observable
final class SyncSettings {
    private static let urlKey = "sync.serverURL"
    private static let lastSyncKey = "sync.lastSyncedAt"
    private static let emailKey = "sync.accountEmail"
    private static let deviceIdKey = "sync.deviceId"
    private static let onboardedKey = "sync.hasSeenOnboarding"
    // Unchanged from when this held the shared FUNDTRACKER_TOKEN, so a phone
    // that was set up before device tokens existed keeps the token it has and
    // isn't dragged back through onboarding.
    private static let keychainAccount = "dashboard-token"

    var serverURL: String {
        didSet { UserDefaults.standard.set(serverURL, forKey: Self.urlKey) }
    }

    /// The sync token. Issued by the server at sign-in; the password that
    /// obtained it is never stored.
    var token: String {
        didSet { Keychain.set(token, account: Self.keychainAccount) }
    }

    /// Which account signed this device in. Display only — empty on a phone
    /// still carrying a pre-onboarding shared token.
    var accountEmail: String {
        didSet { UserDefaults.standard.set(accountEmail, forKey: Self.emailKey) }
    }

    /// The server's id for this device, so it can be matched up with the entry
    /// shown by `scripts/devices.js list`.
    var deviceId: String {
        didSet { UserDefaults.standard.set(deviceId, forKey: Self.deviceIdKey) }
    }

    var lastSyncedAt: Date? {
        didSet { UserDefaults.standard.set(lastSyncedAt, forKey: Self.lastSyncKey) }
    }

    /// Whether first-run setup has been dealt with, either by signing in or by
    /// declining. The app is the source of truth and works fully offline, so
    /// connecting a dashboard is an offer, not a gate — but it shouldn't keep
    /// asking once you've said no.
    var hasSeenOnboarding: Bool {
        didSet { UserDefaults.standard.set(hasSeenOnboarding, forKey: Self.onboardedKey) }
    }

    init() {
        serverURL = UserDefaults.standard.string(forKey: Self.urlKey) ?? ""
        token = Keychain.get(account: Self.keychainAccount) ?? ""
        accountEmail = UserDefaults.standard.string(forKey: Self.emailKey) ?? ""
        deviceId = UserDefaults.standard.string(forKey: Self.deviceIdKey) ?? ""
        lastSyncedAt = UserDefaults.standard.object(forKey: Self.lastSyncKey) as? Date
        hasSeenOnboarding = UserDefaults.standard.bool(forKey: Self.onboardedKey)

        // A phone that already had a token from before onboarding existed is
        // configured by definition; don't greet it with a setup screen.
        if isConfigured { hasSeenOnboarding = true }
    }

    var isConfigured: Bool {
        !serverURL.trimmingCharacters(in: .whitespaces).isEmpty && !token.isEmpty
    }

    /// True for a phone set up before device tokens, still using the shared
    /// FUNDTRACKER_TOKEN. It syncs fine; it just can't be revoked individually.
    var isUsingLegacyToken: Bool {
        isConfigured && deviceId.isEmpty
    }

    func apply(_ credential: DeviceCredential, serverURL url: String) {
        serverURL = url
        token = credential.token
        accountEmail = credential.username
        deviceId = credential.deviceId
    }

    /// Forgets the token and the account, keeping the server address so signing
    /// back in doesn't mean retyping it. Local records are untouched — this
    /// only severs the link to the dashboard.
    func signOut() {
        token = ""
        accountEmail = ""
        deviceId = ""
        lastSyncedAt = nil
    }
}

// MARK: - Keychain

enum Keychain {
    private static let service = "uk.lbsi.FundTracker"

    private static func query(account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    static func set(_ value: String, account: String) {
        let base = query(account: account)
        SecItemDelete(base as CFDictionary)

        guard !value.isEmpty, let data = value.data(using: .utf8) else { return }

        var attributes = base
        attributes[kSecValueData as String] = data
        // The token is only needed while the app is in use on this device.
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        SecItemAdd(attributes as CFDictionary, nil)
    }

    static func get(account: String) -> String? {
        var attributes = query(account: account)
        attributes[kSecReturnData as String] = true
        attributes[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: AnyObject?
        guard SecItemCopyMatching(attributes as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }

        return String(data: data, encoding: .utf8)
    }
}
