import SwiftUI
import SwiftData

struct DeviceDetailView: View {
    @Bindable var device: Device
    @Environment(\.modelContext) private var context

    @State private var isAddingPart = false
    @State private var isEditingDevice = false

    private var parts: [Part] {
        device.partList.sorted { lhs, rhs in
            // Outstanding parts first, then alphabetical.
            if lhs.isPurchased != rhs.isPurchased { return !lhs.isPurchased }
            return lhs.name.localizedStandardCompare(rhs.name) == .orderedAscending
        }
    }

    var body: some View {
        List {
            Section {
                HStack(spacing: 14) {
                    DevicePhoto(
                        photoData: device.photoData,
                        symbolName: device.symbolName,
                        tint: device.status.tint,
                        size: 60
                    )

                    VStack(alignment: .leading, spacing: 4) {
                        Text(device.name)
                            .font(.title3.weight(.semibold))
                        Label(device.status.rawValue, systemImage: device.status.symbolName)
                            .font(.caption)
                            .foregroundStyle(device.status.tint)
                    }
                }
                .padding(.vertical, 6)

                Picker("Status", selection: $device.status) {
                    ForEach(DeviceStatus.allCases) { status in
                        Text(status.rawValue).tag(status)
                    }
                }
            }

            Section("Costs") {
                LabeledContent("Spent so far", value: device.spent.currency)
                LabeledContent("Still to buy", value: device.outstanding.currency)
                LabeledContent("Total when finished", value: (device.spent + device.outstanding).currency)
                    .fontWeight(.semibold)
            }

            Section {
                if parts.isEmpty {
                    Text("No parts listed yet.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(parts) { part in
                        PartRow(part: part)
                    }
                    .onDelete(perform: deleteParts)
                }
            } header: {
                Text("Parts")
            } footer: {
                Text("Tick a part once you've bought it — only bought parts count as money out.")
            }

            if !device.notes.isEmpty {
                Section("Notes") {
                    Text(device.notes)
                }
            }
        }
        .navigationTitle(device.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button("Add Part", systemImage: "plus") { isAddingPart = true }
                    Button("Edit Device", systemImage: "pencil") { isEditingDevice = true }
                } label: {
                    Label("More", systemImage: "ellipsis.circle")
                }
            }
        }
        .sheet(isPresented: $isAddingPart) {
            PartEditorView(device: device)
        }
        .sheet(isPresented: $isEditingDevice) {
            DeviceEditorView(device: device)
        }
    }

    private func deleteParts(at offsets: IndexSet) {
        for index in offsets {
            context.delete(parts[index])
        }
    }
}

private struct PartRow: View {
    @Bindable var part: Part

    var body: some View {
        HStack(spacing: 12) {
            Button {
                togglePurchased()
            } label: {
                Image(systemName: part.isPurchased ? "checkmark.circle.fill" : "circle")
                    .font(.title2)
                    .foregroundStyle(part.isPurchased ? Palette.accent : Color.secondary)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(part.isPurchased ? "Mark as not bought" : "Mark as bought")

            VStack(alignment: .leading, spacing: 2) {
                Text(part.name)
                    .strikethrough(part.isPurchased, color: .secondary)

                HStack(spacing: 6) {
                    if part.quantity > 1 {
                        Text("×\(part.quantity)")
                    }
                    if !part.supplier.isEmpty {
                        Text(part.supplier)
                    }
                    if let date = part.purchaseDate, part.isPurchased {
                        Text(date.formatted(date: .abbreviated, time: .omitted))
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }

            Spacer(minLength: 8)

            Text(part.total.currency)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(part.isPurchased ? .secondary : .primary)
        }
        .padding(.vertical, 2)
    }

    private func togglePurchased() {
        part.isPurchased.toggle()
        // Record when it was bought so the spend has a date attached.
        part.purchaseDate = part.isPurchased ? (part.purchaseDate ?? Date()) : nil
    }
}

#Preview {
    NavigationStack {
        DeviceDetailView(device: PreviewData.sampleDevice)
    }
    .modelContainer(PreviewData.container)
}
