import Foundation
import SwiftData
import SwiftUI

// MARK: - Device

/// A device waiting on parts, being worked on, or finished.
@Model
final class Device {
    var name: String = ""
    var notes: String = ""
    var symbolName: String = "iphone"
    var statusRaw: String = DeviceStatus.needsParts.rawValue
    var dateAdded: Date = Date()

    /// A photo of the actual device. Kept out of the main store file so the
    /// database stays small; `symbolName` is the fallback when there's no photo.
    @Attribute(.externalStorage) var photoData: Data?

    /// Deleting a device takes its parts with it.
    @Relationship(deleteRule: .cascade, inverse: \Part.device)
    var parts: [Part]? = []

    init(
        name: String,
        notes: String = "",
        symbolName: String = "iphone",
        status: DeviceStatus = .needsParts,
        dateAdded: Date = Date()
    ) {
        self.name = name
        self.notes = notes
        self.symbolName = symbolName
        self.statusRaw = status.rawValue
        self.dateAdded = dateAdded
        self.parts = []
    }

    var status: DeviceStatus {
        get { DeviceStatus(rawValue: statusRaw) ?? .needsParts }
        set { statusRaw = newValue.rawValue }
    }

    /// SwiftData relationships are optional under the hood; unwrap in one place.
    var partList: [Part] { parts ?? [] }

    var hasPhoto: Bool { photoData != nil }

    /// What this device has actually cost so far.
    var spent: Double {
        partList.filter(\.isPurchased).reduce(0) { $0 + $1.total }
    }

    /// What it still needs before it can be finished.
    var outstanding: Double {
        partList.filter { !$0.isPurchased }.reduce(0) { $0 + $1.total }
    }

    /// Short summary used in the list rows, e.g. "screen, battery, rear glass".
    var outstandingSummary: String {
        let names = partList.filter { !$0.isPurchased }.map(\.name)
        return names.isEmpty ? "All parts bought" : names.joined(separator: ", ")
    }
}

enum DeviceStatus: String, Codable, CaseIterable, Identifiable {
    case needsParts = "Needs Parts"
    case inProgress = "In Progress"
    case fixed = "Fixed"
    case sold = "Sold"

    var id: String { rawValue }

    var symbolName: String {
        switch self {
        case .needsParts: "shippingbox"
        case .inProgress: "wrench.and.screwdriver"
        case .fixed: "checkmark.seal"
        case .sold: "banknote"
        }
    }

    var tint: Color {
        switch self {
        case .needsParts: .orange
        case .inProgress: .blue
        case .fixed: .green
        case .sold: .purple
        }
    }
}

// MARK: - Part

/// A single part needed for a device. Unpurchased parts are a planned cost;
/// purchased parts are real money out.
@Model
final class Part {
    var name: String = ""
    var unitCost: Double = 0
    var quantity: Int = 1
    var isPurchased: Bool = false
    var purchaseDate: Date?
    var supplier: String = ""
    var device: Device?

    init(
        name: String,
        unitCost: Double = 0,
        quantity: Int = 1,
        isPurchased: Bool = false,
        purchaseDate: Date? = nil,
        supplier: String = ""
    ) {
        self.name = name
        self.unitCost = unitCost
        self.quantity = quantity
        self.isPurchased = isPurchased
        self.purchaseDate = purchaseDate
        self.supplier = supplier
    }

    var total: Double { unitCost * Double(quantity) }
}

// MARK: - Sale

/// Money in from selling something on eBay, Vinted, or elsewhere.
@Model
final class Sale {
    var title: String = ""
    var platformRaw: String = SalePlatform.ebay.rawValue
    var date: Date = Date()
    /// What the buyer paid, before any deductions.
    var grossAmount: Double = 0
    /// Platform commission, payment processing, etc.
    var fees: Double = 0
    /// Postage and packaging you paid for.
    var shippingCost: Double = 0
    var notes: String = ""

    init(
        title: String,
        platform: SalePlatform = .ebay,
        date: Date = Date(),
        grossAmount: Double = 0,
        fees: Double = 0,
        shippingCost: Double = 0,
        notes: String = ""
    ) {
        self.title = title
        self.platformRaw = platform.rawValue
        self.date = date
        self.grossAmount = grossAmount
        self.fees = fees
        self.shippingCost = shippingCost
        self.notes = notes
    }

    var platform: SalePlatform {
        get { SalePlatform(rawValue: platformRaw) ?? .other }
        set { platformRaw = newValue.rawValue }
    }

    /// What actually lands in the repair fund.
    var netAmount: Double { grossAmount - fees - shippingCost }

    var hasDeductions: Bool { fees > 0 || shippingCost > 0 }
}

enum SalePlatform: String, Codable, CaseIterable, Identifiable {
    case ebay = "eBay"
    case vinted = "Vinted"
    case facebook = "Facebook"
    case cash = "Cash / Other"
    case other = "Other"

    var id: String { rawValue }

    var symbolName: String {
        switch self {
        case .ebay: "shippingbox.fill"
        case .vinted: "tshirt.fill"
        case .facebook: "person.2.fill"
        case .cash: "banknote.fill"
        case .other: "tag.fill"
        }
    }

    var tint: Color {
        switch self {
        case .ebay: .blue
        case .vinted: .teal
        case .facebook: .indigo
        case .cash: .green
        case .other: .gray
        }
    }
}

// MARK: - Symbol catalogue

/// The SF Symbols offered when picking an icon for a device.
enum DeviceSymbol {
    static let all = [
        "iphone", "ipad", "laptopcomputer", "desktopcomputer", "applewatch",
        "airpods", "headphones", "gamecontroller.fill", "tv", "camera.fill",
        "printer.fill", "cpu", "display", "keyboard", "hifispeaker.fill"
    ]
}
