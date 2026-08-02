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
    private static let keychainAccount = "dashboard-token"

    var serverURL: String {
        didSet { UserDefaults.standard.set(serverURL, forKey: Self.urlKey) }
    }

    var token: String {
        didSet { Keychain.set(token, account: Self.keychainAccount) }
    }

    var lastSyncedAt: Date? {
        didSet { UserDefaults.standard.set(lastSyncedAt, forKey: Self.lastSyncKey) }
    }

    init() {
        serverURL = UserDefaults.standard.string(forKey: Self.urlKey) ?? ""
        token = Keychain.get(account: Self.keychainAccount) ?? ""
        lastSyncedAt = UserDefaults.standard.object(forKey: Self.lastSyncKey) as? Date
    }

    var isConfigured: Bool {
        !serverURL.trimmingCharacters(in: .whitespaces).isEmpty && !token.isEmpty
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
