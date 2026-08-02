import Foundation
import SwiftData

/// In-memory store used only by SwiftUI previews.
@MainActor
enum PreviewData {
    static let container: ModelContainer = {
        let container = try! ModelContainer(
            for: Device.self, Part.self, Sale.self,
            configurations: ModelConfiguration(isStoredInMemoryOnly: true)
        )
        seed(into: container.mainContext)
        return container
    }()

    static var sampleDevice: Device {
        let descriptor = FetchDescriptor<Device>()
        return (try? container.mainContext.fetch(descriptor).first) ?? Device(name: "iPhone 13")
    }

    private static func seed(into context: ModelContext) {
        let day: TimeInterval = 86_400

        let iphone = Device(name: "iPhone 13", symbolName: "iphone", status: .needsParts)
        let iphone2 = Device(name: "iPhone 13 Pro", symbolName: "iphone", status: .inProgress)
        let tab = Device(name: "Galaxy Tab S8", symbolName: "ipad", status: .needsParts)
        [iphone, iphone2, tab].forEach(context.insert)

        let parts: [(Device, String, Double, Bool)] = [
            (iphone, "Screen", 78, true),
            (iphone, "Battery", 22, true),
            (iphone, "Rear glass", 35, false),
            (iphone2, "Charging port", 14, true),
            (tab, "Screen", 120, false),
            (tab, "Battery", 45, false),
            (tab, "Charging port", 18, false)
        ]

        for (device, name, cost, bought) in parts {
            let part = Part(
                name: name,
                unitCost: cost,
                isPurchased: bought,
                purchaseDate: bought ? Date().addingTimeInterval(-day * 5) : nil
            )
            part.device = device
            context.insert(part)
        }

        let sales: [(String, SalePlatform, Double, Double, TimeInterval)] = [
            ("Vintage denim jacket", .vinted, 32, 0, -day * 1),
            ("Canon AE-1 film camera", .ebay, 145, 17.4, -day * 4),
            ("Job lot of phone cases", .ebay, 48, 5.8, -day * 12),
            ("Nike trainers", .vinted, 55, 0, -day * 34),
            ("Old MacBook charger", .ebay, 25, 3, -day * 51),
            ("Retro game console", .facebook, 90, 0, -day * 70)
        ]

        for (title, platform, gross, fees, offset) in sales {
            context.insert(Sale(
                title: title,
                platform: platform,
                date: Date().addingTimeInterval(offset),
                grossAmount: gross,
                fees: fees
            ))
        }
    }
}
