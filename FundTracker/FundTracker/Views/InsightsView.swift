import SwiftUI
import SwiftData
import Charts

struct InsightsView: View {
    @Query private var sales: [Sale]
    @Query private var devices: [Device]

    @Environment(SyncSettings.self) private var settings
    @State private var isShowingSettings = false

    private var summary: FundSummary {
        FundSummary(sales: sales, devices: devices)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    if sales.isEmpty && devices.isEmpty {
                        ContentUnavailableView(
                            "Nothing to Show",
                            systemImage: "chart.bar",
                            description: Text("Add a sale or a device and your figures will appear here.")
                        )
                        .padding(.top, 60)
                    } else {
                        headlineCards
                        affordabilitySection
                        incomeChart
                        spendChart
                        platformBreakdown
                        syncFooter
                    }
                }
                .padding()
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Insights")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button("Settings", systemImage: "gearshape") {
                        isShowingSettings = true
                    }
                }
            }
            .sheet(isPresented: $isShowingSettings) {
                SettingsView()
            }
        }
    }

    // MARK: - Cards

    private var headlineCards: some View {
        VStack(spacing: 16) {
            StatCard(
                title: "Total Money In",
                amount: summary.totalIn,
                tint: .green,
                caption: summary.deductions > 0
                    ? "\(summary.grossIn.currency) in sales, less \(summary.deductions.currency) fees and postage"
                    : "From all your sales"
            )

            StatCard(
                title: "Total Money Out",
                amount: summary.totalOut,
                tint: .red,
                caption: "Parts you've actually bought"
            )

            StatCard(
                title: "Available Balance",
                amount: summary.balance,
                tint: summary.balance < 0 ? .red : .primary,
                caption: "Your repair fund right now"
            )
        }
    }

    /// The question the app really exists to answer: can I afford the rest?
    @ViewBuilder
    private var affordabilitySection: some View {
        if summary.outstanding > 0 {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Label("Parts Still To Buy", systemImage: "cart")
                        .font(.headline)
                    Spacer()
                    Text(summary.outstanding.currency)
                        .font(.headline)
                        .foregroundStyle(.orange)
                }

                Text("Across \(summary.devicesNeedingParts) device\(summary.devicesNeedingParts == 1 ? "" : "s")")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Divider()

                HStack {
                    Image(systemName: summary.canAffordOutstanding
                          ? "checkmark.circle.fill"
                          : "exclamationmark.triangle.fill")
                        .foregroundStyle(summary.canAffordOutstanding ? .green : .orange)

                    Text(summary.canAffordOutstanding
                         ? "Covered, with \(summary.shortfall.currency) left over"
                         : "You need \(abs(summary.shortfall).currency) more to cover it")
                        .font(.subheadline)
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 20))
        }
    }

    // MARK: - Charts

    @ViewBuilder
    private var incomeChart: some View {
        let months = summary.monthlyIncome()

        if !sales.isEmpty {
            ChartCard(title: "Money In by Month", subtitle: "Net of fees and postage") {
                Chart(months) { month in
                    BarMark(
                        x: .value("Month", month.month, unit: .month),
                        y: .value("Net income", month.amount)
                    )
                    .foregroundStyle(.green)
                    .cornerRadius(4)
                    .accessibilityLabel(month.month.formatted(.dateTime.month(.wide).year()))
                    .accessibilityValue(month.amount.currency)
                }
                .chartXAxis {
                    AxisMarks(values: .stride(by: .month)) { value in
                        AxisValueLabel(format: .dateTime.month(.abbreviated))
                        AxisTick().foregroundStyle(.quaternary)
                    }
                }
                .chartYAxis {
                    AxisMarks { value in
                        AxisGridLine().foregroundStyle(.quaternary)
                        if let amount = value.as(Double.self) {
                            AxisValueLabel(amount.compactCurrency)
                        }
                    }
                }
                .frame(height: 180)
            }
        }
    }

    @ViewBuilder
    private var spendChart: some View {
        let spend = summary.spendByDevice

        if !spend.isEmpty {
            ChartCard(title: "Spend by Device", subtitle: "Parts bought so far") {
                Chart(spend) { entry in
                    BarMark(
                        x: .value("Spent", entry.amount),
                        y: .value("Device", entry.name)
                    )
                    .foregroundStyle(.red)
                    .cornerRadius(4)
                    .annotation(position: .trailing, alignment: .leading) {
                        Text(entry.amount.currency)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    .accessibilityLabel(entry.name)
                    .accessibilityValue(entry.amount.currency)
                }
                .chartXAxis(.hidden)
                .chartYAxis {
                    AxisMarks(preset: .aligned, position: .leading) { _ in
                        AxisValueLabel()
                    }
                }
                // Extra trailing room so the value labels aren't clipped.
                .chartXScale(domain: 0...(spend.map(\.amount).max() ?? 1) * 1.35)
                .frame(height: CGFloat(spend.count) * 38 + 20)
            }
        }
    }

    @ViewBuilder
    private var syncFooter: some View {
        if settings.isConfigured {
            Text(settings.lastSyncedAt.map {
                "Dashboard synced \($0.formatted(date: .abbreviated, time: .shortened))"
            } ?? "Not synced to the dashboard yet")
            .font(.caption)
            .foregroundStyle(.secondary)
        }
    }

    /// A short ranked list reads better than a pie for three or four platforms.
    @ViewBuilder
    private var platformBreakdown: some View {
        let totals = summary.incomeByPlatform

        if totals.count > 1 {
            VStack(alignment: .leading, spacing: 12) {
                Text("Where It Came From")
                    .font(.headline)

                ForEach(totals) { entry in
                    HStack(spacing: 10) {
                        Image(systemName: entry.platform.symbolName)
                            .foregroundStyle(entry.platform.tint)
                            .frame(width: 22)

                        Text(entry.platform.rawValue)

                        Spacer()

                        Text(entry.amount.currency)
                            .foregroundStyle(.secondary)
                    }
                    .font(.subheadline)
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 20))
        }
    }
}

/// Shared chrome so both charts sit in identical cards.
private struct ChartCard<Content: View>: View {
    let title: String
    let subtitle: String
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.headline)
            Text(subtitle)
                .font(.caption)
                .foregroundStyle(.secondary)

            content
                .padding(.top, 12)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 20))
    }
}

#Preview {
    InsightsView()
        .modelContainer(PreviewData.container)
        .environment(SyncSettings())
        .environment(SyncService())
}
