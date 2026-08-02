import SwiftUI
import SwiftData
import PhotosUI

/// Creates a new device when `device` is nil, otherwise edits in place.
struct DeviceEditorView: View {
    let device: Device?

    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var notes = ""
    @State private var symbolName = "iphone"
    @State private var status = DeviceStatus.needsParts
    @State private var photoData: Data?
    @State private var pickedItem: PhotosPickerItem?
    @State private var isShowingCamera = false
    /// Only used when creating — lets you list the parts without a second screen.
    @State private var draftParts: [DraftPart] = []

    private var isNew: Bool { device == nil }

    private var canSave: Bool {
        !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Device") {
                    TextField("Name (e.g. iPhone 13)", text: $name)
                    Picker("Status", selection: $status) {
                        ForEach(DeviceStatus.allCases) { status in
                            Text(status.rawValue).tag(status)
                        }
                    }
                }

                Section {
                    photoRow
                } header: {
                    Text("Photo")
                } footer: {
                    Text(photoData == nil
                         ? "No photo? Pick an icon below instead."
                         : "The photo replaces the icon in your device list.")
                }

                if photoData == nil {
                    Section("Icon") {
                        SymbolPicker(selection: $symbolName)
                    }
                }

                if isNew {
                    Section {
                        ForEach($draftParts) { $part in
                            HStack {
                                TextField("Part name", text: $part.name)
                                TextField("Cost", value: $part.cost, format: .currency(code: "GBP"))
                                    .keyboardType(.decimalPad)
                                    .multilineTextAlignment(.trailing)
                                    .frame(width: 90)
                            }
                        }
                        .onDelete { draftParts.remove(atOffsets: $0) }

                        Button("Add Part", systemImage: "plus") {
                            draftParts.append(DraftPart())
                        }
                    } header: {
                        Text("Parts Needed")
                    } footer: {
                        Text("You can add more parts, suppliers, and quantities later from the device screen.")
                    }
                }

                Section("Notes") {
                    TextField("Anything worth remembering", text: $notes, axis: .vertical)
                        .lineLimit(3...6)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Palette.background)
            .navigationTitle(isNew ? "New Device" : "Edit Device")
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
            .fullScreenCover(isPresented: $isShowingCamera) {
                CameraPicker(imageData: $photoData)
                    .ignoresSafeArea()
            }
            .task(id: pickedItem) {
                guard let pickedItem else { return }
                if let data = try? await pickedItem.loadTransferable(type: Data.self),
                   let image = UIImage(data: data) {
                    photoData = image.compressedForStorage()
                }
            }
        }
    }

    @ViewBuilder
    private var photoRow: some View {
        HStack(spacing: 14) {
            DevicePhoto(
                photoData: photoData,
                symbolName: symbolName,
                tint: status.tint,
                size: 72
            )

            VStack(alignment: .leading, spacing: 8) {
                if UIImagePickerController.isCameraAvailable {
                    Button("Take Photo", systemImage: "camera") {
                        isShowingCamera = true
                    }
                }

                PhotosPicker(selection: $pickedItem, matching: .images) {
                    Label(photoData == nil ? "Choose Photo" : "Replace Photo", systemImage: "photo")
                }

                if photoData != nil {
                    Button("Remove Photo", systemImage: "trash", role: .destructive) {
                        photoData = nil
                        pickedItem = nil
                    }
                }
            }
            .font(.subheadline)
        }
        .padding(.vertical, 4)
    }

    private func loadExisting() {
        guard let device else { return }
        name = device.name
        notes = device.notes
        symbolName = device.symbolName
        status = device.status
        photoData = device.photoData
    }

    private func save() {
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)

        if let device {
            device.name = trimmedName
            device.notes = notes
            device.symbolName = symbolName
            device.status = status
            device.photoData = photoData
        } else {
            let new = Device(name: trimmedName, notes: notes, symbolName: symbolName, status: status)
            new.photoData = photoData
            context.insert(new)

            for draft in draftParts where !draft.name.trimmingCharacters(in: .whitespaces).isEmpty {
                let part = Part(name: draft.name.trimmingCharacters(in: .whitespaces), unitCost: draft.cost)
                part.device = new
                context.insert(part)
            }
        }

        dismiss()
    }
}

/// Lightweight stand-in so new parts aren't inserted into the store until you save.
private struct DraftPart: Identifiable {
    let id = UUID()
    var name = ""
    var cost: Double = 0
}

#Preview {
    DeviceEditorView(device: nil)
        .modelContainer(PreviewData.container)
}
