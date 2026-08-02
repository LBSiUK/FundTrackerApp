# FundTracker

Tracks money coming in from eBay/Vinted sales against the parts needed to fix
devices, so the question "can I afford the rest of the parts?" has an answer.

Two halves:

| Part | Where | What it is |
|---|---|---|
| iOS app | `FundTracker/` | SwiftUI + SwiftData, iOS 18+. The source of truth. |
| Dashboard | `server/` | Express + Caddy, read-only web view. Live at `https://fundtracker.example.com` |

## Quick reference

| | |
|---|---|
| Xcode project | `FundTracker/FundTracker.xcodeproj` |
| Bundle ID / team | see `PRODUCT_BUNDLE_IDENTIFIER` and `DEVELOPMENT_TEAM` in `project.pbxproj` |
| Dashboard | `https://fundtracker.example.com` — username `<username>` |
| Server | `ssh <user>@<SERVER_LAN_IP>` (hostname `homeserver`, Ubuntu 24.04) |
| Deploy dir | `~/fundtracker` on that box |
| Secrets | `~/fundtracker/.env` (mode 600, generated on the server) |

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

## The one rule to remember

`server/services/summary.js` is a deliberate mirror of
`FundTracker/FundTracker/FundSummary.swift`. Both compute the same money
figures. **Change a rule in one and you must change it in the other**, or the
app and the dashboard will quietly disagree about your balance.

## Status

Working end to end as of 2026-08-02. Under git since then, published at
`github.com/LBSiUK/FundTrackerApp` — see
[docs/NEXT-STEPS.md](docs/NEXT-STEPS.md) for what's outstanding.
