import SwiftUI

/// The app's colour scheme, in one place.
///
/// Four brand colours: 5F021F (burgundy), BD3E2B (brick), E96B0B (orange),
/// FFF984 (pale yellow). They're the two ends and the middle of one warm ramp,
/// which has two consequences worth knowing before reaching for them:
///
/// 1. **5F021F vanishes on dark, FFF984 vanishes on light** — 1.26:1 and 1.07:1
///    against the respective surfaces. So the asset catalog swaps them out per
///    mode rather than flipping automatically, and `highlightFill` is only ever
///    a background behind dark ink, never a mark or text colour.
///
/// 2. **Brick and orange sit ΔE 13.7 apart**, under the 15 floor for telling two
///    categories apart at a glance. The palette therefore carries *emphasis*,
///    not *identity*: anything categorical (device status, sale platform) keeps
///    its text label doing the identifying, with colour as a second cue only.
enum Palette {
    /// Headline emphasis and the app tint. Burgundy on light, brick on dark.
    static let primary = Color("BrandPrimary")

    /// Second-rank emphasis: spend, warnings, anything that should read heavier
    /// than body text without shouting.
    static let secondary = Color("BrandSecondary")

    /// The brightest step. Money in, positive states, chart fills.
    static let accent = Color("BrandAccent")

    /// Pale yellow. A background only — put `.primary` ink on top of it.
    static let highlightFill = Color("BrandHighlightFill")

    // MARK: Semantic roles
    //
    // Named by the job rather than the colour, so a future palette change is one
    // edit here instead of a hunt through the views.

    /// Money arriving in the fund.
    static let moneyIn = accent

    /// Money leaving it.
    static let moneyOut = primary

    /// You can cover what's outstanding.
    static let affordable = accent

    /// You can't.
    static let shortfall = secondary
}
