import SwiftUI
import SwiftData

struct PartEditorView: View {
    let device: Device

    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var unitCost: Double = 0
    @State private var quantity = 1
    @State private var supplier = ""
    @State private var isPurchased = false
    @State private var purchaseDate = Date()

    private var canSave: Bool {
        !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Part") {
                    TextField("Name (e.g. screen)", text: $name)
                    CurrencyField(label: "Unit cost", amount: $unitCost)
                    Stepper("Quantity: \(quantity)", value: $quantity, in: 1...99)
                    TextField("Supplier (optional)", text: $supplier)
                }

                Section {
                    Toggle("Already bought", isOn: $isPurchased.animation())
                    if isPurchased {
                        DatePicker("Bought on", selection: $purchaseDate, displayedComponents: .date)
                    }
                } footer: {
                    Text(isPurchased
                         ? "This will count towards money out straight away."
                         : "This stays as a planned cost until you tick it off.")
                }

                if quantity > 1 {
                    Section {
                        LabeledContent("Total", value: (unitCost * Double(quantity)).currency)
                            .fontWeight(.semibold)
                    }
                }
            }
            .navigationTitle("Add Part")
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
        }
    }

    private func save() {
        let part = Part(
            name: name.trimmingCharacters(in: .whitespacesAndNewlines),
            unitCost: unitCost,
            quantity: quantity,
            isPurchased: isPurchased,
            purchaseDate: isPurchased ? purchaseDate : nil,
            supplier: supplier.trimmingCharacters(in: .whitespacesAndNewlines)
        )
        part.device = device
        context.insert(part)
        dismiss()
    }
}

#Preview {
    PartEditorView(device: PreviewData.sampleDevice)
        .modelContainer(PreviewData.container)
}
