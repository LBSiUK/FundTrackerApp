# FundTracker

Tracks money coming in from eBay/Vinted sales against the parts needed to fix
devices, so the question "can I afford the rest of the parts?" has an answer.

Two halves:

| Part | Where | What it is |
|---|---|---|
| iOS app | `FundTracker/` | SwiftUI + SwiftData, iOS 26+. The source of truth for fund records. |
| Server | `server/` | Express + Caddy + SQLite. A read-only dashboard per account, plus `/admin`. |

Multi-user: many accounts on one server, each with its own records, photos and
any number of phones. Registration is closed — creating an account needs a
one-time activation code from an admin.

## Quick reference

| | |
|---|---|
| Xcode project | `FundTracker/FundTracker.xcodeproj` |
| Bundle ID / team | see `PRODUCT_BUNDLE_IDENTIFIER` and `DEVELOPMENT_TEAM` in `project.pbxproj` |
| Dashboard | `https://fundtracker.example.com` — one account's own records |
| Admin | `https://fundtracker.example.com/admin` — accounts, devices, activation codes |
| Server | `ssh <user>@<SERVER_LAN_IP>` (hostname `homeserver`, Ubuntu 24.04) |
| Deploy dir | `~/fundtracker` on that box |
| Secrets | `~/fundtracker/.env` (mode 600, generated on the server) |
| Database | `~/fundtracker/data/fundtracker.db` (SQLite) |
| Sideloadable IPA | `build/FundTracker.ipa` — unsigned, rebuild per [docs/IOS-APP.md](docs/IOS-APP.md) |

Hostnames, IP addresses and usernames throughout the docs are placeholders —
this is a public repository. The real values live in `docs/LOCAL-NOTES.md`,
which is gitignored and stays on the author's machine.

## Documentation

- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — how the halves fit together, the data model, the sync contract
- **[docs/IOS-APP.md](docs/IOS-APP.md)** — the app: files, screens, conventions
- **[docs/OPERATIONS.md](docs/OPERATIONS.md)** — runbook: deploy, restart, backup, certificates, DNS, troubleshooting
- **[docs/DECISIONS.md](docs/DECISIONS.md)** — why things are the way they are, including options rejected
- **[docs/NEXT-STEPS.md](docs/NEXT-STEPS.md)** — what's outstanding
- **[server/README.md](server/README.md)** — server-specific detail and endpoint reference

## Two rules to remember

**`server/services/summary.js` mirrors `FundTracker/FundTracker/FundSummary.swift`.**
Both compute the same money figures. Change a rule in one and you must change it
in the other, or the app and the dashboard will quietly disagree about your
balance.

**Everything server-side hangs off `accounts.id`, never a username.** Usernames
are a label that can change at any time. Anything keyed by name breaks the moment
an account is renamed.

## Status

Working end to end as of 2026-08-02, published at
`github.com/LBSiUK/FundTrackerApp`.

Since first release: per-device sync tokens and email logins, uploaded photos,
a SQLite rewrite with per-account isolation, an admin interface with activation
codes, and an offline/online first-run choice. The two things never driven by
hand are listed at the top of [docs/NEXT-STEPS.md](docs/NEXT-STEPS.md).
