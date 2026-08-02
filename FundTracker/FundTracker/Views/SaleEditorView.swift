import SwiftUI
import SwiftData

/// Creates a new sale when `sale` is nil, otherwise edits in place.
struct SaleEditorView: View {
    let sale: Sale?

    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss

    @State private var title = ""
    @State private var platform = SalePlatform.ebay
    @State private var date = Date()
    @State private var grossAmount: Double = 0
    @State private var fees: Double = 0
    @State private var shippingCost: Double = 0
    @State private var notes = ""

    private var isNew: Bool { sale == nil }

    private var net: Double { grossAmount - fees - shippingCost }

    private var canSave: Bool {
        !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && grossAmount > 0
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Sale") {
                    TextField("What did you sell?", text: $title)
                    Picker("Platform", selection: $platform) {
                        ForEach(SalePlatform.allCases) { platform in
                            Label(platform.rawValue, systemImage: platform.symbolName)
                                .tag(platform)
                        }
                    }
                    DatePicker("Date", selection: $date, displayedComponents: .date)
                }

                Section {
                    CurrencyField(label: "Sold for", amount: $grossAmount)
                    CurrencyField(label: "Platform fees", amount: $fees)
                    CurrencyField(label: "Postage you paid", amount: $shippingCost)
                } header: {
                    Text("Amounts")
                } footer: {
                    Text("Leave fees and postage at zero if they were covered by the buyer.")
                }

                Section {
                    LabeledContent("Into the fund") {
                        Text(net.currency)
                            .fontWeight(.semibold)
                            .foregroundStyle(net < 0 ? Palette.shortfall : Palette.moneyIn)
                    }
                }

                Section("Notes") {
                    TextField("Optional", text: $notes, axis: .vertical)
                        .lineLimit(2...5)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Palette.background)
            .navigationTitle(isNew ? "New Sale" : "Edit Sale")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", action: save)
                        .disabled(!canSave)
                }
            }
            .onAppear(perform: loadExisting)
        }
    }

    private func loadExisting() {
        guard let sale else { return }
        title = sale.title
        platform = sale.platform
        date = sale.date
        grossAmount = sale.grossAmount
        fees = sale.fees
        shippingCost = sale.shippingCost
        notes = sale.notes
    }

    private func save() {
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)

        if let sale {
            sale.title = trimmedTitle
            sale.platform = platform
            sale.date = date
            sale.grossAmount = grossAmount
            sale.fees = fees
            sale.shippingCost = shippingCost
            sale.notes = notes
        } else {
            context.insert(Sale(
                title: trimmedTitle,
                platform: platform,
                date: date,
                grossAmount: grossAmount,
                fees: fees,
                shippingCost: shippingCost,
                notes: notes
            ))
        }

        dismiss()
    }
}

#Preview {
    SaleEditorView(sale: nil)
        .modelContainer(PreviewData.container)
}
