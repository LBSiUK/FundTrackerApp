import CryptoKit
import Foundation
import SwiftData

// MARK: - Wire format
//
// Deliberately separate from the SwiftData models: the payload the server sees
// shouldn't change just because a @Model gains a property. Keys here must match
// what server/services/summary.js reads.

private struct SyncPayload: Encodable {
    let devices: [DeviceDTO]
    let sales: [SaleDTO]
}

private struct DeviceDTO: Encodable {
    let id: String
    let name: String
    let status: String
    let symbolName: String
    let notes: String
    let dateAdded: Date
    /// SHA-256 of the JPEG, or nil. The photo itself is uploaded separately —
    /// see `uploadPhotos`.
    let photoHash: String?
    let parts: [PartDTO]
}

private struct PartDTO: Encodable {
    let id: String
    let name: String
    let unitCost: Double
    let quantity: Int
    let isPurchased: Bool
    let purchaseDate: Date?
    let supplier: String
}

private struct SaleDTO: Encodable {
    let id: String
    let title: String
    let platform: String
    let date: Date
    let grossAmount: Double
    let fees: Double
    let shippingCost: Double
    let notes: String
}

private struct SyncResponse: Decodable {
    let ok: Bool
    let syncedAt: String
    let deviceCount: Int
    let saleCount: Int
    /// Hashes the server doesn't hold yet. Absent on an older server.
    let missingPhotos: [String]?
}

private struct ServerError: Decodable {
    let error: String
    let message: String
}

private struct HealthResponse: Decodable {
    let ok: Bool
    let service: String
    let setupRequired: Bool?
}

private struct DeviceResponse: Decodable {
    let token: String
    let deviceId: String
    let deviceName: String
    let username: String
}

/// What the server hands back when this device signs in. The password that
/// obtained it is deliberately not part of this — it is never persisted.
struct DeviceCredential {
    let token: String
    let deviceId: String
    let deviceName: String
    let username: String
}

// MARK: - Errors

enum SyncError: LocalizedError {
    case notConfigured
    case invalidURL
    case unauthorized
    case notFundTracker
    case setupRequired
    case badCredentials
    case tooManyAttempts
    case codeInvalid
    case codeUsed
    case codeExpired
    case accountExists
    case weakPassword(Int)
    case server(String)
    case transport(String)

    var errorDescription: String? {
        switch self {
        case .notConfigured:
            "Sign in to your dashboard first."
        case .invalidURL:
            "That server address isn't a valid URL."
        case .unauthorized:
            "The server rejected this device. Sign in again."
        case .notFundTracker:
            "Something answered, but it isn't a FundTracker server."
        case .setupRequired:
            "That server has no accounts yet. Create one with scripts/set-password.js."
        case .badCredentials:
            "Incorrect email or password."
        case .tooManyAttempts:
            "Too many attempts. Try again in 15 minutes."
        case .codeInvalid:
            "That activation code isn't valid."
        case .codeUsed:
            "That activation code has already been used."
        case .codeExpired:
            "That activation code has expired. Ask for a new one."
        case .accountExists:
            "There's already an account with that email. Sign in instead."
        case .weakPassword(let minimum):
            "Use at least \(minimum) characters."
        case .server(let message):
            message
        case .transport(let message):
            message
        }
    }
}

// MARK: - Server address

enum ServerAddress {
    /// Turns what someone types into a URL worth sending a password to.
    /// A bare host gets `https://`, never `http://` — the app has no ATS
    /// exemptions, so cleartext would fail at the network layer anyway, and
    /// silently defaulting to it would be the wrong thing even if it worked.
    static func normalise(_ input: String) -> URL? {
        var text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }

        if !text.contains("://") { text = "https://\(text)" }
        while text.hasSuffix("/") { text.removeLast() }

        guard
            let url = URL(string: text),
            url.scheme?.lowercased() == "https" || url.scheme?.lowercased() == "http",
            let host = url.host, !host.isEmpty
        else { return nil }

        return url
    }
}

// MARK: - Service

/// Pushes the whole local dataset to the dashboard. The phone is the source of
/// truth and the dashboard is read-only, so a full replace is safe and avoids
/// any merge or conflict handling.
@MainActor
@Observable
final class SyncService {
    enum State: Equatable {
        case idle
        case syncing
        case uploadingPhotos(done: Int, total: Int)
        case success(Date)
        /// Records went up but some photos didn't. Worth distinguishing from a
        /// failed sync — the figures on the dashboard are correct either way.
        case partial(String)
        case failure(String)
    }

    private(set) var state: State = .idle

    var isSyncing: Bool {
        switch state {
        case .syncing, .uploadingPhotos: true
        case .idle, .success, .partial, .failure: false
        }
    }

    func sync(devices: [Device], sales: [Sale], settings: SyncSettings) async {
        guard settings.isConfigured else {
            state = .failure(SyncError.notConfigured.localizedDescription)
            return
        }

        state = .syncing
        do {
            let response = try await push(devices: devices, sales: sales, settings: settings)
            settings.lastSyncedAt = Date()

            // Records are safely stored by this point. Photos are a second
            // pass, so a failure here doesn't cost you the sync.
            let failed = await uploadPhotos(
                hashes: response.missingPhotos ?? [],
                devices: devices,
                settings: settings
            )

            if failed > 0 {
                state = .partial("Synced, but \(failed) photo\(failed == 1 ? "" : "s") didn't upload. Try again.")
            } else {
                state = .success(Date())
            }
        } catch {
            state = .failure(error.localizedDescription)
        }
    }

    /// Sends only the photos the server said it was missing. Returns how many
    /// failed. Content-addressed, so retrying is always safe.
    private func uploadPhotos(
        hashes: [String],
        devices: [Device],
        settings: SyncSettings
    ) async -> Int {
        guard !hashes.isEmpty else { return 0 }

        // Hash -> bytes, built once. Two devices sharing a photo upload it once.
        var byHash: [String: Data] = [:]
        for device in devices {
            if let hash = device.photoHash, let data = device.photoData {
                byHash[hash] = data
            }
        }

        var failed = 0
        var done = 0
        let wanted = hashes.filter { byHash[$0] != nil }
        state = .uploadingPhotos(done: 0, total: wanted.count)

        for hash in wanted {
            guard let data = byHash[hash] else { continue }
            do {
                try await uploadPhoto(hash: hash, data: data, settings: settings)
            } catch {
                failed += 1
            }
            done += 1
            state = .uploadingPhotos(done: done, total: wanted.count)
        }

        return failed
    }

    private func uploadPhoto(hash: String, data: Data, settings: SyncSettings) async throws {
        guard let base = ServerAddress.normalise(settings.serverURL) else {
            throw SyncError.invalidURL
        }

        var request = URLRequest(url: base.appendingPathComponent("api/photos/\(hash)"))
        request.httpMethod = "POST"
        request.setValue("image/jpeg", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(settings.token)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 60
        request.httpBody = data

        let (body, http) = try await send(request)

        if http.statusCode == 401 { throw SyncError.unauthorized }

        guard (200..<300).contains(http.statusCode) else {
            let detail = (try? JSONDecoder().decode(ServerError.self, from: body))?.message
            throw SyncError.server(detail ?? "Photo upload returned \(http.statusCode).")
        }
    }

    // MARK: Onboarding

    /// Checks that an address is reachable and is actually a FundTracker
    /// server, before the sign-in step asks for a password. Returns true when
    /// the server has no accounts yet.
    func checkServer(_ address: String) async throws -> Bool {
        guard let base = ServerAddress.normalise(address) else { throw SyncError.invalidURL }

        var request = URLRequest(url: base.appendingPathComponent("api/health"))
        request.timeoutInterval = 15

        let (data, response) = try await send(request)

        guard (200..<300).contains(response.statusCode) else {
            throw SyncError.notFundTracker
        }

        guard
            let health = try? JSONDecoder().decode(HealthResponse.self, from: data),
            health.service == "fundtracker"
        else {
            // A 200 from an unrelated host isn't proof you typed the right address.
            throw SyncError.notFundTracker
        }

        return health.setupRequired ?? false
    }

    /// Exchanges an email and password for this device's own sync token.
    /// The password is used for exactly this call and never stored.
    func signIn(
        address: String,
        email: String,
        password: String,
        deviceName: String
    ) async throws -> DeviceCredential {
        guard let base = ServerAddress.normalise(address) else { throw SyncError.invalidURL }

        var request = URLRequest(url: base.appendingPathComponent("api/auth/device"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 20
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "email": email.trimmingCharacters(in: .whitespaces).lowercased(),
            "password": password,
            "deviceName": deviceName,
        ])

        let (data, response) = try await send(request)

        guard (200..<300).contains(response.statusCode) else {
            throw failure(status: response.statusCode, body: data)
        }

        let issued = try JSONDecoder().decode(DeviceResponse.self, from: data)
        return DeviceCredential(
            token: issued.token,
            deviceId: issued.deviceId,
            deviceName: issued.deviceName,
            username: issued.username
        )
    }

    /// Turns a non-2xx response into the most specific error available.
    /// The server names its failures; matching on those beats string-matching
    /// a message that might be reworded later.
    private func failure(status: Int, body: Data) -> SyncError {
        let detail = try? JSONDecoder().decode(ServerError.self, from: body)

        switch detail?.error {
        case "code_invalid": return .codeInvalid
        case "code_used": return .codeUsed
        case "code_expired": return .codeExpired
        case "exists": return .accountExists
        case "weak_password": return .weakPassword(12)
        case "invalid_credentials": return .badCredentials
        case "too_many_attempts": return .tooManyAttempts
        default: break
        }

        if status == 401 { return .badCredentials }
        if status == 429 { return .tooManyAttempts }
        return .server(detail?.message ?? "Server returned \(status).")
    }

    /// Creates an account. Requires a one-time activation code from an admin —
    /// this server doesn't allow open sign-up.
    func register(
        address: String,
        email: String,
        password: String,
        code: String,
        deviceName: String
    ) async throws -> DeviceCredential {
        guard let base = ServerAddress.normalise(address) else { throw SyncError.invalidURL }

        var request = URLRequest(url: base.appendingPathComponent("api/auth/register"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 20
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "email": email.trimmingCharacters(in: .whitespaces).lowercased(),
            "password": password,
            "code": code.trimmingCharacters(in: .whitespaces),
            "deviceName": deviceName,
        ])

        let (data, response) = try await send(request)

        guard (200..<300).contains(response.statusCode) else {
            throw failure(status: response.statusCode, body: data)
        }

        let issued = try JSONDecoder().decode(DeviceResponse.self, from: data)
        return DeviceCredential(
            token: issued.token,
            deviceId: issued.deviceId,
            deviceName: issued.deviceName,
            username: issued.username
        )
    }

    /// Deletes the account on the server. Password-gated deliberately: the sync
    /// token on this phone can write records, and that shouldn't be enough to
    /// destroy the account.
    func deleteAccount(address: String, email: String, password: String) async throws {
        guard let base = ServerAddress.normalise(address) else { throw SyncError.invalidURL }

        var request = URLRequest(url: base.appendingPathComponent("api/auth/delete-account"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 20
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "email": email.trimmingCharacters(in: .whitespaces).lowercased(),
            "password": password,
        ])

        let (data, response) = try await send(request)

        guard (200..<300).contains(response.statusCode) else {
            throw failure(status: response.statusCode, body: data)
        }
    }

    // MARK: Transport

    private func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw SyncError.transport(error.localizedDescription)
        }

        guard let http = response as? HTTPURLResponse else {
            throw SyncError.transport("Unexpected response from the server.")
        }

        return (data, http)
    }

    private func push(
        devices: [Device],
        sales: [Sale],
        settings: SyncSettings
    ) async throws -> SyncResponse {
        guard let base = ServerAddress.normalise(settings.serverURL) else {
            throw SyncError.invalidURL
        }

        var request = URLRequest(url: base.appendingPathComponent("api/sync"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(settings.token)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 20

        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        request.httpBody = try encoder.encode(payload(devices: devices, sales: sales))

        let (data, http) = try await send(request)

        // The token was valid once, so a 401 now means it was revoked from the
        // server. Settings turns this into an invitation to sign in again.
        if http.statusCode == 401 { throw SyncError.unauthorized }

        guard (200..<300).contains(http.statusCode) else {
            let detail = (try? JSONDecoder().decode(ServerError.self, from: data))?.message
            throw SyncError.server(detail ?? "Server returned \(http.statusCode).")
        }

        return try JSONDecoder().decode(SyncResponse.self, from: data)
    }

    private func payload(devices: [Device], sales: [Sale]) -> SyncPayload {
        SyncPayload(
            devices: devices.map { device in
                DeviceDTO(
                    id: device.persistentModelID.storeIdentifier ?? UUID().uuidString,
                    name: device.name,
                    status: device.status.rawValue,
                    symbolName: device.symbolName,
                    notes: device.notes,
                    dateAdded: device.dateAdded,
                    // Just the hash here; the bytes go up separately and only
                    // when the server says it hasn't got them.
                    photoHash: device.photoHash,
                    parts: device.partList.map { part in
                        PartDTO(
                            id: part.persistentModelID.storeIdentifier ?? UUID().uuidString,
                            name: part.name,
                            unitCost: part.unitCost,
                            quantity: part.quantity,
                            isPurchased: part.isPurchased,
                            purchaseDate: part.purchaseDate,
                            supplier: part.supplier
                        )
                    }
                )
            },
            sales: sales.map { sale in
                SaleDTO(
                    id: sale.persistentModelID.storeIdentifier ?? UUID().uuidString,
                    title: sale.title,
                    platform: sale.platform.rawValue,
                    date: sale.date,
                    grossAmount: sale.grossAmount,
                    fees: sale.fees,
                    shippingCost: sale.shippingCost,
                    notes: sale.notes
                )
            }
        )
    }
}
