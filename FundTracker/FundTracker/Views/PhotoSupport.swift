import SwiftUI
import UIKit

extension UIImage {
    /// Photos straight from the camera are far bigger than a list thumbnail needs.
    /// Downscale and re-encode before storing so the database stays manageable.
    func compressedForStorage(maxDimension: CGFloat = 1280, quality: CGFloat = 0.8) -> Data? {
        let longestSide = max(size.width, size.height)
        let scale = longestSide > maxDimension ? maxDimension / longestSide : 1
        let target = CGSize(width: size.width * scale, height: size.height * scale)

        let renderer = UIGraphicsImageRenderer(size: target)
        let resized = renderer.image { _ in
            draw(in: CGRect(origin: .zero, size: target))
        }
        return resized.jpegData(compressionQuality: quality)
    }
}

/// Shows a device's photo, falling back to its SF Symbol when there isn't one.
struct DevicePhoto: View {
    let photoData: Data?
    let symbolName: String
    var tint: Color = .accentColor
    var size: CGFloat = 44

    private var cornerRadius: CGFloat { size * 0.27 }

    var body: some View {
        if let photoData, let image = UIImage(data: photoData) {
            Image(uiImage: image)
                .resizable()
                .scaledToFill()
                .frame(width: size, height: size)
                .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
                .accessibilityLabel("Device photo")
        } else {
            IconTile(systemName: symbolName, tint: tint, size: size)
        }
    }
}

/// Camera capture. `PhotosPicker` covers the library, but photographing the
/// device you're holding is the main way a photo gets added here.
struct CameraPicker: UIViewControllerRepresentable {
    @Binding var imageData: Data?
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(imageData: $imageData, dismiss: { dismiss() })
    }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        private let imageData: Binding<Data?>
        private let dismiss: () -> Void

        init(imageData: Binding<Data?>, dismiss: @escaping () -> Void) {
            self.imageData = imageData
            self.dismiss = dismiss
        }

        func imagePickerController(
            _ picker: UIImagePickerController,
            didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
        ) {
            if let image = info[.originalImage] as? UIImage {
                imageData.wrappedValue = image.compressedForStorage()
            }
            dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            dismiss()
        }
    }
}

extension UIImagePickerController {
    static var isCameraAvailable: Bool {
        isSourceTypeAvailable(.camera)
    }
}
