# Architecture

## Shape

```
┌─────────────────┐
│   iPhone        │  SwiftData store on device — the source of truth
│   FundTracker   │  Photos upload separately, by content hash
└────────┬────────┘
         │ POST /api/sync     (Bearer token, HTTPS) full replace, no merge
         │ POST /api/photos/… (Bearer token, HTTPS) only what's missing
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
      "photoHash": "sha256 hex, or null",
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

**Photo** — optional, one per device, downscaled to 1280px JPEG at quality 0.8
before it leaves the phone. See "Photos" below.

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
| iOS app | Per-device Bearer token | `POST /api/sync` only — write, no read |
| Browser | email + password → session cookie | `GET /api/summary`, `/api/snapshot`, `/api/devices` — read, no write |

The token cannot read your data; the login cannot push data. If the token leaked
off the phone, nobody could view your records with it.

## Connecting a phone

First launch asks for a server address before it asks for anything else:

```
   enter address  ──▶  GET /api/health  ──▶  is service == "fundtracker"?
                                                    │
                                                    ▼
   email + password  ──▶  POST /api/auth/device  ──▶  { token, deviceId }
                                                    │
                                                    ▼
                                        token → Keychain, password discarded
```

Two steps rather than one form, so the address is proven to be a FundTracker
server before anyone types a password into it. Checking `service` matters: a 200
from an unrelated host is not evidence you typed the right address.

**The password is never stored on the phone.** It exists only for the duration
of that one request, and what persists is the token it returns. So the phone
still holds a write-only credential, exactly as before — the sign-in screen
changes how the token is obtained, not what it can do.

Each phone gets its own token, hashed with SHA-256 in `data/devices.json`.
Plain SHA-256 rather than scrypt is deliberate: the token is 32 bytes of CSPRNG
output, so there's no dictionary to attack and no work factor worth paying.
Passwords need scrypt because humans choose them.

Revoking one phone (`scripts/devices.js revoke <id>`) doesn't disturb the
others. The single shared `FUNDTRACKER_TOKEN` couldn't do that — it's still
accepted so an already-configured phone keeps working, and should be dropped
from `.env` once every device has signed in.

Connecting is optional. The phone is the source of truth and works entirely
offline; a dashboard only adds a browser view, so onboarding offers "Set Up
Later" rather than blocking the app behind a server.

## Photos

Photos used to stay on the phone. They don't any more — they're uploaded and
served on the dashboard. That's a real change in exposure, and worth stating
plainly: **your device photos now live on the server**, are included in
`data/` backups, and are readable by anyone who can sign in to the dashboard.
The phone is still where they originate and still the source of truth.

They travel separately from the sync payload, addressed by the SHA-256 of the
JPEG:

```
POST /api/sync            → { …, missingPhotos: ["<hash>", …] }
POST /api/photos/<hash>   → raw JPEG body, Bearer token
GET  /api/photos/<hash>   → the JPEG, session cookie only
```

The snapshot carries `photoHash` per device; the bytes go up only when the
server says it hasn't got them. Content-addressing does a lot of work here:

- **A photo crosses the network once.** Re-syncing doesn't re-upload it, which
  is the whole reason this isn't just base64 inside the sync payload.
- **Retrying is always safe.** The same bytes produce the same name, so a
  half-finished upload run costs nothing to repeat.
- **Filenames are never caller-chosen.** The name is derived from the content
  and checked against `^[a-f0-9]{64}$` before touching the filesystem.
- **The same photo on two devices is stored once.**

The server verifies that the uploaded bytes actually hash to the claimed name,
that the body starts with a JPEG marker, and that it's under 3MB. A photo the
snapshot no longer refers to is pruned on the next sync, so deleting one on the
phone deletes it here too.

Photo writes use the device token and photo reads use the browser session, so
the read/write split survives: a token lifted off a phone can add a photo but
still can't look at one.

## Time zones

Month bucketing is done in **UTC on both sides**. Doing it in local time and
serialising with `toISOString()` shifts every bucket back an hour under BST,
which is enough to relabel a whole chart by one month. `services/summary.js`
uses `monthIndex()` on UTC components; `public/app.js` formats with
`timeZone: 'UTC'`. Don't "simplify" either.
