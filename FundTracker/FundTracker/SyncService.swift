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

// MARK: - Errors

enum SyncError: LocalizedError {
    case notConfigured
    case invalidURL
    case unauthorized
    case server(String)
    case transport(String)

    var errorDescription: String? {
        switch self {
        case .notConfigured:
            "Set your server address and token in Settings first."
        case .invalidURL:
            "That server address isn't a valid URL."
        case .unauthorized:
            "The server rejected your token."
        case .server(let message):
            message
        case .transport(let message):
            message
        }
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

    private func push(
        devices: [Device],
        sales: [Sale],
        settings: SyncSettings
    ) async throws -> SyncResponse {
        guard
            let base = URL(string: settings.serverURL.trimmingCharacters(in: .whitespaces)),
            base.scheme != nil
        else {
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
