import SwiftUI
import SwiftData

struct DevicesView: View {
    @Environment(\.modelContext) private var context
    @Query(sort: \Device.dateAdded, order: .reverse) private var devices: [Device]

    @State private var editingDevice: Device?
    @State private var isAddingDevice = false

    /// Grouped so the things still waiting on parts stay at the top.
    private var sections: [(status: DeviceStatus, devices: [Device])] {
        DeviceStatus.allCases.compactMap { status in
            let matching = devices.filter { $0.status == status }
            return matching.isEmpty ? nil : (status, matching)
        }
    }

    var body: some View {
        NavigationStack {
            Group {
                if devices.isEmpty {
                    ContentUnavailableView {
                        Label("No Devices Yet", systemImage: "wrench.and.screwdriver")
                    } description: {
                        Text("Add a device you're fixing and list the parts it needs.")
                    } actions: {
                        Button("Add Device") { isAddingDevice = true }
                            .buttonStyle(.glassProminent)
                    }
                } else {
                    deviceList
                }
            }
            .navigationTitle("Devices")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button("Add Device", systemImage: "plus") {
                        isAddingDevice = true
                    }
                }
            }
            .sheet(isPresented: $isAddingDevice) {
                DeviceEditorView(device: nil)
            }
            .sheet(item: $editingDevice) { device in
                DeviceEditorView(device: device)
            }
        }
    }

    private var deviceList: some View {
        List {
            ForEach(sections, id: \.status) { section in
                Section {
                    ForEach(section.devices) { device in
                        NavigationLink {
                            DeviceDetailView(device: device)
                        } label: {
                            DeviceRow(device: device)
                        }
                        .swipeActions(edge: .trailing) {
                            Button("Delete", systemImage: "trash", role: .destructive) {
                                delete(device)
                            }
                            Button("Edit", systemImage: "pencil") {
                                editingDevice = device
                            }
                            .tint(Palette.primary)
                        }
                    }
                } header: {
                    Label(section.status.rawValue, systemImage: section.status.symbolName)
                }
            }
        }
    }

    private func delete(_ device: Device) {
        context.delete(device)
    }
}

private struct DeviceRow: View {
    let device: Device

    var body: some View {
        HStack(spacing: 12) {
            DevicePhoto(
                photoData: device.photoData,
                symbolName: device.symbolName,
                tint: device.status.tint
            )

            VStack(alignment: .leading, spacing: 3) {
                Text(device.name)
                    .font(.headline)

                Text(device.outstandingSummary)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }

            Spacer(minLength: 8)

            VStack(alignment: .trailing, spacing: 3) {
                if device.outstanding > 0 {
                    Text(device.outstanding.currency)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Palette.secondary)
                    Text("to buy")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                } else if device.spent > 0 {
                    Text(device.spent.currency)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Text("spent")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 4)
    }
}

#Preview {
    DevicesView()
        .modelContainer(PreviewData.container)
}
