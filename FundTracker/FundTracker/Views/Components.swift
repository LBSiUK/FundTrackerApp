import SwiftUI

/// The rounded icon tile used in both list rows.
struct IconTile: View {
    let systemName: String
    var tint: Color = .accentColor
    var size: CGFloat = 44

    var body: some View {
        Image(systemName: systemName)
            .font(.system(size: size * 0.45, weight: .medium))
            .foregroundStyle(tint)
            .frame(width: size, height: size)
            .background(tint.opacity(0.12), in: RoundedRectangle(cornerRadius: size * 0.27))
    }
}

/// One of the big number cards on the Insights tab.
struct StatCard<Footer: View>: View {
    let title: String
    let amount: Double
    var tint: Color = .primary
    var caption: String?
    @ViewBuilder var footer: Footer

    var body: some View {
        VStack(spacing: 6) {
            Text(title)
                .font(.headline)
                .foregroundStyle(.secondary)

            Text(amount.currency)
                .font(.system(size: 44, weight: .bold, design: .rounded))
                .foregroundStyle(tint)
                .contentTransition(.numericText(value: amount))
                .animation(.snappy, value: amount)
                .minimumScaleFactor(0.5)
                .lineLimit(1)

            if let caption {
                Text(caption)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }

            footer
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 26)
        .padding(.horizontal, 16)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 20))
    }
}

extension StatCard where Footer == EmptyView {
    init(title: String, amount: Double, tint: Color = .primary, caption: String? = nil) {
        self.init(title: title, amount: amount, tint: tint, caption: caption) { EmptyView() }
    }
}

/// A text field that edits a currency amount without fighting the keyboard.
struct CurrencyField: View {
    let label: String
    @Binding var amount: Double

    var body: some View {
        LabeledContent(label) {
            TextField(
                label,
                value: $amount,
                format: .currency(code: "GBP")
            )
            .keyboardType(.decimalPad)
            .multilineTextAlignment(.trailing)
        }
    }
}

/// Grid of SF Symbols for choosing a device icon.
struct SymbolPicker: View {
    @Binding var selection: String

    private let columns = [GridItem(.adaptive(minimum: 52), spacing: 10)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: 10) {
            ForEach(DeviceSymbol.all, id: \.self) { symbol in
                Button {
                    selection = symbol
                } label: {
                    Image(systemName: symbol)
                        .font(.title3)
                        .frame(width: 52, height: 44)
                        .foregroundStyle(symbol == selection ? Color.white : Color.accentColor)
                        .background(
                            symbol == selection ? Color.accentColor : Color.accentColor.opacity(0.12),
                            in: RoundedRectangle(cornerRadius: 10)
                        )
                }
                .buttonStyle(.plain)
                .accessibilityLabel(symbol)
                .accessibilityAddTraits(symbol == selection ? .isSelected : [])
            }
        }
        .padding(.vertical, 4)
    }
}
