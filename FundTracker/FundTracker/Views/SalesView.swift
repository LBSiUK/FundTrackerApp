import SwiftUI
import SwiftData

struct SalesView: View {
    @Environment(\.modelContext) private var context
    @Query(sort: \Sale.date, order: .reverse) private var sales: [Sale]

    @State private var editingSale: Sale?
    @State private var isAddingSale = false
    @State private var platformFilter: SalePlatform?

    private var filteredSales: [Sale] {
        guard let platformFilter else { return sales }
        return sales.filter { $0.platform == platformFilter }
    }

    /// Newest month first, so the most recent sales are at the top.
    private var months: [(month: Date, sales: [Sale])] {
        let calendar = Calendar.current
        let grouped = Dictionary(grouping: filteredSales) { sale in
            calendar.startOfMonth(for: sale.date)
        }
        return grouped
            .map { (month: $0.key, sales: $0.value) }
            .sorted { $0.month > $1.month }
    }

    private var filteredTotal: Double {
        filteredSales.reduce(0) { $0 + $1.netAmount }
    }

    var body: some View {
        NavigationStack {
            Group {
                if sales.isEmpty {
                    ContentUnavailableView {
                        Label("No Sales Yet", systemImage: "sterlingsign.circle")
                    } description: {
                        Text("Log what you sell on eBay and Vinted to build up your repair fund.")
                    } actions: {
                        Button("Add Sale") { isAddingSale = true }
                            .buttonStyle(.borderedProminent)
                    }
                } else {
                    salesList
                }
            }
            .navigationTitle("Sales Log")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button("Add Sale", systemImage: "plus") {
                        isAddingSale = true
                    }
                }
                if !sales.isEmpty {
                    ToolbarItem(placement: .topBarLeading) {
                        filterMenu
                    }
                }
            }
            .sheet(isPresented: $isAddingSale) {
                SaleEditorView(sale: nil)
            }
            .sheet(item: $editingSale) { sale in
                SaleEditorView(sale: sale)
            }
        }
    }

    private var filterMenu: some View {
        Menu {
            Picker("Platform", selection: $platformFilter) {
                Text("All Platforms").tag(SalePlatform?.none)
                ForEach(SalePlatform.allCases) { platform in
                    Text(platform.rawValue).tag(SalePlatform?.some(platform))
                }
            }
        } label: {
            Label(
                "Filter",
                systemImage: platformFilter == nil
                    ? "line.3.horizontal.decrease.circle"
                    : "line.3.horizontal.decrease.circle.fill"
            )
        }
    }

    private var salesList: some View {
        List {
            Section {
                LabeledContent(
                    platformFilter == nil ? "Total in" : "\(platformFilter!.rawValue) total",
                    value: filteredTotal.currency
                )
                .font(.headline)
            }

            ForEach(months, id: \.month) { section in
                Section {
                    ForEach(section.sales) { sale in
                        Button {
                            editingSale = sale
                        } label: {
                            SaleRow(sale: sale)
                        }
                        .buttonStyle(.plain)
                        .swipeActions(edge: .trailing) {
                            Button("Delete", systemImage: "trash", role: .destructive) {
                                context.delete(sale)
                            }
                        }
                    }
                } header: {
                    HStack {
                        Text(section.month.formatted(.dateTime.month(.wide).year()))
                        Spacer()
                        Text(section.sales.reduce(0) { $0 + $1.netAmount }.currency)
                    }
                }
            }
        }
    }
}

private struct SaleRow: View {
    let sale: Sale

    var body: some View {
        HStack(spacing: 12) {
            IconTile(systemName: sale.platform.symbolName, tint: sale.platform.tint)

            VStack(alignment: .leading, spacing: 3) {
                Text(sale.title)
                    .font(.headline)
                    .lineLimit(2)

                HStack(spacing: 5) {
                    Text(sale.platform.rawValue)
                    Text("·")
                    Text(sale.date.formatted(date: .abbreviated, time: .omitted))
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }

            Spacer(minLength: 8)

            VStack(alignment: .trailing, spacing: 2) {
                Text(sale.netAmount.signedCurrency)
                    .font(.headline)
                    .foregroundStyle(.green)

                // Only worth showing the gross when something was taken off it.
                if sale.hasDeductions {
                    Text("of \(sale.grossAmount.currency)")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
    }
}

#Preview {
    SalesView()
        .modelContainer(PreviewData.container)
}
