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
        case success(Date)
        case failure(String)
    }

    private(set) var state: State = .idle

    var isSyncing: Bool { state == .syncing }

    func sync(devices: [Device], sales: [Sale], settings: SyncSettings) async {
        guard settings.isConfigured else {
            state = .failure(SyncError.notConfigured.localizedDescription)
            return
        }

        state = .syncing
        do {
            let response = try await push(devices: devices, sales: sales, settings: settings)
            settings.lastSyncedAt = Date()
            state = .success(Date())
            _ = response
        } catch {
            state = .failure(error.localizedDescription)
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

        if response.statusCode == 401 { throw SyncError.badCredentials }
        if response.statusCode == 429 { throw SyncError.tooManyAttempts }

        guard (200..<300).contains(response.statusCode) else {
            let detail = (try? JSONDecoder().decode(ServerError.self, from: data))?.message
            throw SyncError.server(detail ?? "Server returned \(response.statusCode).")
        }

        let issued = try JSONDecoder().decode(DeviceResponse.self, from: data)
        return DeviceCredential(
            token: issued.token,
            deviceId: issued.deviceId,
            deviceName: issued.deviceName,
            username: issued.username
        )
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
                    // Photos stay on the phone — they'd bloat the payload and the
                    // dashboard doesn't show them.
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
