import Foundation

/// Every headline figure in the app, derived from the stored records.
/// Nothing here is hardcoded — change a sale or tick off a part and the
/// numbers move with it.
struct FundSummary {
    let sales: [Sale]
    let devices: [Device]

    /// Sale prices before fees and postage.
    var grossIn: Double {
        sales.reduce(0) { $0 + $1.grossAmount }
    }

    /// Fees and postage you paid out of those sales.
    var deductions: Double {
        sales.reduce(0) { $0 + $1.fees + $1.shippingCost }
    }

    /// What actually reached the fund.
    var totalIn: Double {
        sales.reduce(0) { $0 + $1.netAmount }
    }

    /// Parts you have actually bought.
    var totalOut: Double {
        devices.reduce(0) { $0 + $1.spent }
    }

    /// Spendable right now.
    var balance: Double { totalIn - totalOut }

    /// Parts still on the list, not yet bought.
    var outstanding: Double {
        devices.reduce(0) { $0 + $1.outstanding }
    }

    /// Negative means the outstanding parts cost more than you have.
    var shortfall: Double { balance - outstanding }

    var canAffordOutstanding: Bool { shortfall >= 0 }

    var devicesNeedingParts: Int {
        devices.filter { $0.outstanding > 0 }.count
    }

    /// Net income per calendar month, oldest first, for the sales chart.
    func monthlyIncome(monthsBack: Int = 6, calendar: Calendar = .current) -> [MonthlyTotal] {
        let now = Date()
        guard let start = calendar.date(
            byAdding: .month,
            value: -(monthsBack - 1),
            to: calendar.startOfMonth(for: now)
        ) else { return [] }

        // Seed every month in range so gaps render as zero rather than vanishing.
        var buckets: [Date: Double] = [:]
        for offset in 0..<monthsBack {
            if let month = calendar.date(byAdding: .month, value: offset, to: start) {
                buckets[month] = 0
            }
        }

        for sale in sales {
            let month = calendar.startOfMonth(for: sale.date)
            guard month >= start else { continue }
            buckets[month, default: 0] += sale.netAmount
        }

        return buckets
            .map { MonthlyTotal(month: $0.key, amount: $0.value) }
            .sorted { $0.month < $1.month }
    }

    /// Net income grouped by platform, largest first.
    var incomeByPlatform: [PlatformTotal] {
        let grouped: [SalePlatform: [Sale]] = Dictionary(grouping: sales, by: \.platform)
        let totals: [PlatformTotal] = grouped.map { platform, sales in
            PlatformTotal(platform: platform, amount: sales.reduce(0) { $0 + $1.netAmount })
        }
        return totals
            .filter { $0.amount != 0 }
            .sorted { $0.amount > $1.amount }
    }

    /// Money spent on parts per device, largest first.
    var spendByDevice: [DeviceSpend] {
        devices
            .filter { $0.spent > 0 }
            .map { DeviceSpend(name: $0.name, amount: $0.spent) }
            .sorted { $0.amount > $1.amount }
    }
}

struct MonthlyTotal: Identifiable {
    let month: Date
    let amount: Double
    var id: Date { month }
}

struct PlatformTotal: Identifiable {
    let platform: SalePlatform
    let amount: Double
    var id: String { platform.rawValue }
}

struct DeviceSpend: Identifiable {
    let name: String
    let amount: Double
    var id: String { name }
}

extension Calendar {
    func startOfMonth(for date: Date) -> Date {
        self.date(from: dateComponents([.year, .month], from: date)) ?? date
    }
}

// MARK: - Currency

extension Double {
    /// One place to change if the currency ever needs to.
    var currency: String {
        formatted(.currency(code: "GBP").precision(.fractionLength(2)))
    }

    /// Compact form for chart axes, e.g. "£1.2k".
    var compactCurrency: String {
        if abs(self) >= 1000 {
            return "£" + (self / 1000).formatted(.number.precision(.fractionLength(1))) + "k"
        }
        return "£" + formatted(.number.precision(.fractionLength(0)))
    }

    var signedCurrency: String {
        (self >= 0 ? "+" : "") + currency
    }
}
