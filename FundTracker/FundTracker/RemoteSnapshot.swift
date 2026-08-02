import Foundation
import SwiftData

/// What the server holds for this account, in a form the app can write into
/// SwiftData.
///
/// Plain structs rather than `@Model` objects on purpose: nothing is inserted
/// until `restore` decides to, so a failed or partial download can't leave
/// half-built records in the store.
struct RemoteSnapshot {
    struct Part {
        let name: String
        let unitCost: Double
        let quantity: Int
        let isPurchased: Bool
        let purchaseDate: Date?
        let supplier: String
    }

    struct Device {
        let name: String
        let status: DeviceStatus
        let symbolName: String
        let notes: String
        let dateAdded: Date
        let photoHash: String?
        let parts: [Part]
    }

    struct Sale {
        let title: String
        let platform: SalePlatform
        let date: Date
        let grossAmount: Double
        let fees: Double
        let shippingCost: Double
        let notes: String
    }

    let devices: [Device]
    let sales: [Sale]

    var isEmpty: Bool { devices.isEmpty && sales.isEmpty }
}

@MainActor
enum SnapshotRestore {
    /// Replaces everything in the local store with the server's copy.
    ///
    /// A full replace in the same spirit as the push: the two sides hold the
    /// same set, so there is no merge to get wrong. Callers decide *when* this
    /// is the right thing — see `ContentView.restoreIfNeeded`.
    ///
    /// Photos come down afterwards and are best-effort: the records are the
    /// point, and an image that fails to download can be fetched on the next
    /// restore rather than failing this one.
    static func apply(
        _ snapshot: RemoteSnapshot,
        into context: ModelContext,
        settings: SyncSettings,
        sync: SyncService
    ) async {
        for device in (try? context.fetch(FetchDescriptor<Device>())) ?? [] {
            context.delete(device)
        }
        for sale in (try? context.fetch(FetchDescriptor<Sale>())) ?? [] {
            context.delete(sale)
        }

        var photoWanted: [(Device, String)] = []

        for remote in snapshot.devices {
            let device = Device(
                name: remote.name,
                notes: remote.notes,
                symbolName: remote.symbolName,
                status: remote.status
            )
            device.dateAdded = remote.dateAdded
            context.insert(device)

            for remotePart in remote.parts {
                let part = Part(
                    name: remotePart.name,
                    unitCost: remotePart.unitCost,
                    quantity: remotePart.quantity,
                    isPurchased: remotePart.isPurchased,
                    supplier: remotePart.supplier
                )
                part.purchaseDate = remotePart.purchaseDate
                part.device = device
                context.insert(part)
            }

            if let hash = remote.photoHash {
                photoWanted.append((device, hash))
            }
        }

        for remote in snapshot.sales {
            let sale = Sale(
                title: remote.title,
                platform: remote.platform,
                date: remote.date,
                grossAmount: remote.grossAmount,
                fees: remote.fees,
                shippingCost: remote.shippingCost,
                notes: remote.notes
            )
            context.insert(sale)
        }

        try? context.save()

        for (device, hash) in photoWanted {
            if let data = await sync.fetchPhoto(hash: hash, settings: settings) {
                device.photoData = data
            }
        }

        try? context.save()
    }
}
