import Foundation
import SwiftData

/// Sample devices, parts and sales. Every `#Preview` uses the in-memory
/// container, and Debug builds launched with `-demo` copy the same records into
/// the real store (see `DemoData`).
///
/// Everything here is made up. Dates are relative to today so the monthly chart
/// always has something in it.
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

    static func seed(into context: ModelContext) {
        let day: TimeInterval = 86_400
        func ago(_ days: Double) -> Date { Date().addingTimeInterval(-day * days) }

        let iphone12 = Device(
            name: "iPhone 12",
            notes: "Cracked screen and a tired battery. Rear glass is fine.",
            symbolName: "iphone",
            status: .inProgress,
            dateAdded: ago(38)
        )
        let iphone14 = Device(
            name: "iPhone 14 Pro",
            notes: "Bought as spares: lines across the screen, Face ID not working.",
            symbolName: "iphone",
            status: .needsParts,
            dateAdded: ago(9)
        )
        let ipad = Device(
            name: "iPad Air 2",
            notes: "Digitiser cracked, LCD underneath is fine.",
            symbolName: "ipad",
            status: .needsParts,
            dateAdded: ago(21)
        )
        let macbook = Device(
            name: "MacBook Pro 13\" 2015",
            notes: "Swollen battery lifting the trackpad. Keyboard and screen fine.",
            symbolName: "laptopcomputer",
            status: .needsParts,
            dateAdded: ago(15)
        )
        let headphones = Device(
            name: "Sony WH-1000XM3",
            notes: "Ear pads worn through and a cracked headband.",
            symbolName: "headphones",
            status: .needsParts,
            dateAdded: ago(5)
        )
        let switchConsole = Device(
            name: "Nintendo Switch",
            notes: "Left Joy-Con drift and a loose USB-C port.",
            symbolName: "gamecontroller.fill",
            status: .fixed,
            dateAdded: ago(64)
        )
        let galaxy = Device(
            name: "Galaxy S21",
            notes: "Back glass smashed. Fixed and sold on eBay.",
            symbolName: "iphone",
            status: .sold,
            dateAdded: ago(120)
        )
        [iphone12, iphone14, ipad, macbook, headphones, switchConsole, galaxy].forEach(context.insert)

        // (device, part, unit cost, quantity, bought how many days ago or nil, supplier)
        let parts: [(Device, String, Double, Int, Double?, String)] = [
            (iphone12, "Screen assembly (OLED)", 64.99, 1, 30, "PartsHub"),
            (iphone12, "Battery", 18.50, 1, 30, "PartsHub"),
            (iphone12, "Adhesive and screw kit", 4.99, 1, 30, "PartsHub"),
            (iphone12, "Earpiece speaker", 9.99, 1, nil, ""),
            (iphone14, "Screen assembly (OLED)", 189.00, 1, nil, ""),
            (iphone14, "Face ID flex cable", 32.50, 1, nil, ""),
            (ipad, "Digitiser", 27.50, 1, nil, ""),
            (ipad, "Home button flex", 8.99, 1, nil, ""),
            (macbook, "Battery", 54.00, 1, nil, ""),
            (macbook, "Trackpad", 45.00, 1, nil, ""),
            (macbook, "Pentalobe and Torx driver set", 12.99, 1, 14, "ToolDepot"),
            (headphones, "Ear pads (pair)", 16.99, 1, nil, ""),
            (headphones, "Headband", 22.00, 1, nil, ""),
            (switchConsole, "Joy-Con analogue stick", 4.25, 2, 60, "PartsHub"),
            (switchConsole, "USB-C charging port", 9.80, 1, 60, "PartsHub"),
            (galaxy, "Rear glass", 12.00, 1, 115, "PartsHub"),
            (galaxy, "Charging port", 11.50, 1, 115, "PartsHub"),
            (galaxy, "Battery", 21.00, 1, 115, "PartsHub")
        ]

        for (device, name, cost, quantity, boughtDaysAgo, supplier) in parts {
            let part = Part(
                name: name,
                unitCost: cost,
                quantity: quantity,
                isPurchased: boughtDaysAgo != nil,
                purchaseDate: boughtDaysAgo.map(ago),
                supplier: supplier
            )
            part.device = device
            context.insert(part)
        }

        // (title, platform, gross, fees, postage, days ago)
        let sales: [(String, SalePlatform, Double, Double, Double, Double)] = [
            ("Canon AE-1 film camera", .ebay, 145, 18.86, 4.20, 3),
            ("Denim jeans", .vinted, 28, 0, 0, 6),
            ("Fleece jacket", .vinted, 35, 0, 0, 13),
            ("Sealed Lego set", .ebay, 62, 8.24, 3.69, 24),
            ("Box of paperbacks", .facebook, 15, 0, 0, 31),
            ("Kindle Paperwhite", .ebay, 48, 6.44, 3.20, 40),
            ("Leather boots", .vinted, 45, 0, 0, 49),
            ("Galaxy S21, refurbished", .ebay, 165, 21.42, 3.99, 88),
            ("Car boot sale takings", .cash, 37.50, 0, 0, 96),
            ("Winter coat", .vinted, 22, 0, 0, 118),
            ("PS4 controller", .ebay, 24, 3.37, 2.70, 131)
        ]

        for (title, platform, gross, fees, postage, daysAgo) in sales {
            context.insert(Sale(
                title: title,
                platform: platform,
                date: ago(daysAgo),
                grossAmount: gross,
                fees: fees,
                shippingCost: postage
            ))
        }
    }
}
