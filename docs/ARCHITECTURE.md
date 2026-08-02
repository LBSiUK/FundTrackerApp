# Architecture

## Shape

```
┌─────────────────┐
│   iPhone        │  SwiftData store on device — the source of truth
│   FundTracker   │  Photos stay here, never uploaded
└────────┬────────┘
         │ POST /api/sync   (Bearer token, HTTPS)
         │ full replace, no merge
         ▼
   internet ──443──▶ Caddy (TLS, Let's Encrypt)  ──▶  app:3100
                     fundtracker.example.com              Docker internal network
                                                      snapshot.json on a volume
         ▲
         │ browser: username + password → session cookie
         │
   ┌─────┴─────┐
   │  You, in  │
   │ a browser │
   └───────────┘
```

The phone owns the data. The server holds a copy for viewing. Nothing on the
server is ever edited, which is why there is no merge logic, no conflict
resolution, and no risk in a full replace — there is nothing on that side to lose.

## The sync contract

`POST /api/sync` takes the entire dataset and replaces the stored snapshot:

```json
{
  "devices": [
    {
      "id": "...", "name": "iPhone 13", "status": "Needs Parts",
      "symbolName": "iphone", "notes": "", "dateAdded": "ISO8601",
      "parts": [
        { "id": "...", "name": "Screen", "unitCost": 78, "quantity": 1,
          "isPurchased": true, "purchaseDate": "ISO8601", "supplier": "" }
      ]
    }
  ],
  "sales": [
    { "id": "...", "title": "Canon AE-1", "platform": "eBay",
      "date": "ISO8601", "grossAmount": 145, "fees": 17.4,
      "shippingCost": 0, "notes": "" }
  ]
}
```

The DTOs in `SyncService.swift` are deliberately separate from the SwiftData
`@Model` classes, so adding a property to a model doesn't silently change the
wire format. If you add a field the dashboard needs, change both ends.

Dates are ISO8601 (`JSONEncoder.dateEncodingStrategy = .iso8601`).

## Data model

**Device** — a thing being fixed. Has a status (`Needs Parts`, `In Progress`,
`Fixed`, `Sold`), an optional photo, and many parts.

**Part** — belongs to a device. Has `unitCost`, `quantity`, and crucially
`isPurchased`:

- **not purchased** → a *planned* cost. Counts toward "still to buy".
- **purchased** → *actual* money out. Counts toward "total out".

That flag is the heart of the app. It's what lets the dashboard answer whether
the balance covers the outstanding parts.

**Sale** — money in. Has `grossAmount` (what the buyer paid), `fees` (platform
commission) and `shippingCost` (postage you paid). `netAmount = gross − fees −
shipping` is what actually reaches the fund. eBay takes a cut and Vinted
doesn't, so a single "amount made" figure would overstate the fund.

## Money rules (mirrored in two places)

| Figure | Rule |
|---|---|
| `totalIn` | sum of sale `netAmount` |
| `totalOut` | sum of **purchased** parts (`unitCost × quantity`) |
| `balance` | `totalIn − totalOut` |
| `outstanding` | sum of **unpurchased** parts |
| `shortfall` | `balance − outstanding` — negative means you can't cover the rest |

Implemented in `FundSummary.swift` and `server/services/summary.js`. These must
agree. Server-side figures are rounded to 2dp (`round2`) because floating-point
sums otherwise surface as `204.60000000000002`.

## Two credentials, deliberately separate

| Caller | Credential | Can reach |
|---|---|---|
| iOS app | Bearer token (`FUNDTRACKER_TOKEN`) | `POST /api/sync` only — write, no read |
| Browser | username + password → session cookie | `GET /api/summary`, `/api/snapshot` — read, no write |

The token cannot read your data; the login cannot push data. If the token leaked
off the phone, nobody could view your records with it.

## Time zones

Month bucketing is done in **UTC on both sides**. Doing it in local time and
serialising with `toISOString()` shifts every bucket back an hour under BST,
which is enough to relabel a whole chart by one month. `services/summary.js`
uses `monthIndex()` on UTC components; `public/app.js` formats with
`timeZone: 'UTC'`. Don't "simplify" either.
