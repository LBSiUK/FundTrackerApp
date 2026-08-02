import SwiftUI

/// The FundTracker mark: two circular arrows turning around a £.
///
/// The arrows are the sync idea and the £ is what's being tracked, so the two
/// halves of the app are in one glyph. Drawn rather than shipped as an image so
/// it stays sharp at any size and picks up the tint in both colour schemes.
struct BrandLogo: View {
    var size: CGFloat = 120

    /// The ring is `arrow.triangle.2.circlepath` — two arcs, each ending in a
    /// solid arrowhead. Weight is tied to the size so the stroke stays in
    /// proportion when it's rendered small.
    private var ringWeight: Font.Weight {
        size >= 96 ? .regular : .medium
    }

    var body: some View {
        ZStack {
            Image(systemName: "arrow.triangle.2.circlepath")
                .font(.system(size: size, weight: ringWeight))
                .foregroundStyle(Palette.primary)

            Text("£")
                // Sized off the ring so the two scale together, and kept small
                // enough to sit inside it rather than crowd the arcs.
                .font(.system(size: size * 0.4, weight: .semibold, design: .serif))
                .foregroundStyle(Palette.primary)
        }
        .frame(width: size * 1.15, height: size * 1.15)
        .accessibilityElement()
        .accessibilityLabel("FundTracker")
    }
}

/// The logo with the wordmark under it, as used on the welcome screen.
struct BrandLockup: View {
    var logoSize: CGFloat = 150

    var body: some View {
        VStack(spacing: 10) {
            BrandLogo(size: logoSize)

            // Didot ships with iOS. If it were ever missing, SwiftUI falls back
            // to the system face rather than failing to render.
            Text("FundTracker")
                .font(.custom("Didot", size: logoSize * 0.3))
                .foregroundStyle(Palette.primary)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("FundTracker")
    }
}

#Preview("Lockup") {
    BrandLockup()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Palette.background)
}

#Preview("Small") {
    BrandLogo(size: 44)
}
