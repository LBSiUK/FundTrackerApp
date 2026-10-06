# Architecture

## Shape

```
┌─────────────────┐
│   iPhone        │  SwiftData store on device — the source of truth
│   FundTracker   │  Photos upload separately, by content hash
└────────┬────────┘
         │ POST /api/sync     (Bearer token, HTTPS) full replace, no merge
         │ GET  /api/sync     (Bearer token, HTTPS) restore an empty device
         │ POST /api/photos/… (Bearer token, HTTPS) only what's missing
         ▼
   internet ──443──▶ Caddy (TLS, Let's Encrypt)  ──▶  app:3100
                     fundtracker.example.com              Docker internal network
                                                      SQLite + photos on a volume
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
| iOS app | Per-device Bearer token | `POST`/`GET /api/sync` and photos, for its own account only |
| Browser | email + password → session cookie | `GET /api/summary`, `/api/snapshot`, `/api/devices` — read, no write |

The login cannot push data. The token can now read **its own account's records
and photos** — see "Sync is two-way" below — but nothing else, and it still can't
reach another account, the admin interface, or anyone else's anything.

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

Each phone gets its own token, hashed with SHA-256 in the `devices` table, and
one account can have many.
Plain SHA-256 rather than scrypt is deliberate: the token is 32 bytes of CSPRNG
output, so there's no dictionary to attack and no work factor worth paying.
Passwords need scrypt because humans choose them.

Revoking one phone doesn't disturb the others. `FUNDTRACKER_TOKEN` no longer
does anything: sync is per-account now, and a server-wide token has no account
to attribute a sync to.

Connecting is optional. First launch asks outright: **use an account** or **stay
offline**. The phone is the source of truth either way, and a dashboard only
adds a browser view.

That choice is one-way by design. Offline records can join an account later —
they simply sync up on first connection. Records that have lived under an
account can't be taken back offline, because the server also holds them and
"offline" would then be a half-truth. The app tracks this with a sticky
`hasEverConnected`, which signing out deliberately does not clear. Only a full
Reset does, and that discards the records too, so the question is genuinely
open again.

## Sync is two-way

Sync was push-only: the phone was the source of truth and the server a viewer.
That broke the moment a device could legitimately have an empty store — after
Reset App, or on a second device — because the first automatic push would replace
the account's records with nothing. **That was data loss, not just a missing
feature.**

```
POST /api/sync   push this device's records (full replace)
GET  /api/sync   pull the account's records back
```

The app pulls on launch **when it has no records of its own**, before the first
push. Non-empty stays authoritative: a device with records pushes them, so
connecting after using the app offline still uploads what you have rather than
wiping it.

Two guards, because one of them shouldn't be the only one:

- The **app** restores before it ever pushes.
- The **server** refuses a push that would replace stored records with an empty
  set (`409 would_erase`) unless the client says `allowEmpty` — which is how a
  deliberate "delete everything" still works.

This is what cost the read/write asymmetry. A device token can now read its own
account, because a device that can't read can't recover. Reading is still scoped
to the token's own account, so a leaked token exposes one account's records
rather than nothing — worth stating plainly, because the previous property was
stronger.

Photos come down with the records, using the same token; `GET /api/photos/:hash`
accepts either a session or the owning device's token.

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
server says it hasn't got them. **Ownership is per account even though the bytes
are shared** — two accounts with the same photo store one file and two rows, and
asking for a photo you don't own is a 404 whether or not the file exists, so one
user can't probe another's photos by guessing hashes. Content-addressing does a
lot of work here:

- **A photo crosses the network once.** Re-syncing doesn't re-upload it, which
  is the whole reason this isn't just base64 inside the sync payload.
- **Retrying is always safe.** The same bytes produce the same name, so a
  half-finished upload run costs nothing to repeat.
- **Filenames are never caller-chosen.** The name is derived from the content
  and checked against `^[a-f0-9]{64}$` before touching the filesystem.
- **The same photo on two devices is stored once.**

The server verifies that the uploaded bytes actually hash to the claimed name,
that the body starts with a JPEG marker, and that it's under 3MB. A photo the
snapshot no longer refers to is pruned on the next sync — first this account's
claim on it, then the file itself once no account references it at all.

Photo writes use the device token. Photo reads take either the browser session
or the owning device's token, because a restored phone needs its photos back.
Either way the read is scoped to the caller's own account.

## Accounts and the database

State lives in SQLite (`data/fundtracker.db`) via Node's built-in `node:sqlite`,
so there's no native module to compile and the Alpine image needs no toolchain.
It was JSON files until accounts needed identity separate from their name.

**Everything hangs off `accounts.id`, never off a username.** That's the whole
reason for the move: renaming an account is one `UPDATE`, and its devices,
invites, snapshot and photos follow because they reference the id. Sessions
carry the id too, so a rename doesn't sign anyone out.

```
accounts ──┬── devices    (one account, many phones)
           ├── invites    (created_by / used_by)
           ├── snapshots  (exactly one per account)
           └── photos     (ownership; bytes are shared on disk)
```

**Fund data is per account.** There used to be one server-wide `snapshot.json`,
which was fine with exactly one user and silently wrong with two — the second
phone's sync would replace the first's records. Every read and write is now
scoped to an account id.

Two roles: `user` and `admin`. Admins reach `/admin` and **nothing else** — no
dashboard, no sync, no photos. The admin account manages the server rather than
using it, so it has no fund of its own; `requireUser` rejects it from every fund
route. Role and active state are read from the database on every request rather
than carried in the cookie, so demoting an admin takes effect immediately.

An `admin` account is created at first startup with the password
`defaultadmin` and `must_change_password` set. That default is only tolerable
because the flag makes the account useless until it's replaced: `requireSession`
returns 428 for everything except the change-password endpoint. **Change it the
first time you sign in** — it is a published constant on an internet-facing
server.

**Registration is closed by design.** Creating an account requires a one-time
activation code, so a login page on the public internet isn't also a sign-up
page. The code is validated and marked used in a single operation — checking
first and marking later is how a code gets redeemed twice.

Deleting an account revokes its device tokens with it, so a phone can't outlive
the account it authenticated as. The same holds for disabling one or changing
its password.

## Time zones

Month bucketing is done in **UTC on both sides**. Doing it in local time and
serialising with `toISOString()` shifts every bucket back an hour under BST,
which is enough to relabel a whole chart by one month. `services/summary.js`
uses `monthIndex()` on UTC components; `public/app.js` formats with
`timeZone: 'UTC'`. Don't "simplify" either.
