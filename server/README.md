# FundTracker dashboard

Read-only web view of the repair fund. The iOS app is the source of truth and
pushes its whole dataset here; this side never edits anything.

## Access model

Two different callers, two different credentials:

| Caller        | Credential                        | Reaches                          |
|---------------|-----------------------------------|----------------------------------|
| iOS app       | Per-device Bearer token           | `POST /api/sync` only            |
| You, a browser| Email + password → session cookie | `GET /api/summary`, `/api/snapshot`, `/api/devices` |

The token can't read your data and the session can't push data. That asymmetry
is the point: a token lifted off a phone shows an attacker nothing.

**Device tokens.** The app signs in once with your email and password, and the
server hands back a random 32-byte token belonging to that phone alone. The
password is never stored on the device. Tokens are kept as SHA-256 hashes in
the `devices` table — plain SHA-256 rather than scrypt on purpose, because a
token is CSPRNG output with no dictionary to attack, unlike a human-chosen
password. Each phone can be revoked without disturbing the others.

Passwords are scrypt-hashed (N=16384). Sessions are
stateless HMAC-signed cookies — HttpOnly, SameSite=Lax, Secure behind TLS — so
they survive a restart and are unreadable from JavaScript.

Failed sign-ins are throttled to 10 per IP per 15 minutes, shared across
`/api/auth/login` and `/api/auth/device` so an attacker can't get a fresh budget
by switching endpoints. Unknown accounts run a dummy hash and return the same
message as a wrong password, so the response doesn't reveal which exist.

`FUNDTRACKER_TOKEN` still works if set — the single shared token from before
device tokens existed, kept so an already-configured phone doesn't break. Drop
it from `.env` once every device has signed in.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/health` | none | Liveness, and what the app probes during setup |
| POST | `/api/auth/login` | none | Sign in, sets the session cookie |
| POST | `/api/auth/register` | none | Create an account — requires an activation code |
| POST | `/api/auth/device` | none | Exchange a password for a device sync token |
| POST | `/api/auth/change-password` | Session | The only route open while a password change is pending |
| POST | `/api/auth/delete-account` | none | Delete your own account (password required) |
| POST | `/api/auth/logout` | none | Clears the cookie |
| GET | `/api/auth/me` | none | Who you are, or 401 |
| POST | `/api/sync` | Bearer | Push `{ devices, sales }` for the token's account |
| GET | `/api/summary` | User | Everything the dashboard renders |
| GET | `/api/snapshot` | User | Raw stored payload, for backups |
| GET | `/api/devices` | User | Your own phones |
| DELETE | `/api/devices/:id` | User | Revoke one of yours (404 if it isn't) |
| POST | `/api/photos/:hash` | Bearer | Upload a device photo (raw JPEG body) |
| GET | `/api/photos/:hash` | User | Serve one you own |
| GET | `/api/admin/accounts` | Admin | Paged, searchable account list |
| POST | `/api/admin/accounts` | Admin | Create one |
| GET | `/api/admin/accounts/:id` | Admin | One account with its devices, photos and fund summary |
| PATCH | `/api/admin/accounts/:id` | Admin | Rename, set role, enable/disable, reset password |
| DELETE | `/api/admin/accounts/:id` | Admin | Delete, cascading to everything it owns |
| GET | `/api/admin/accounts/:id/devices` | Admin | That account's phones |
| DELETE | `/api/admin/devices/:id` | Admin | Revoke any device |
| GET/POST | `/api/admin/invites` | Admin | List / generate activation codes |
| DELETE | `/api/admin/invites/:id` | Admin | Revoke one |
| POST | `/api/admin/invites/purge` | Admin | Drop used and expired |

**Auth column.** *Bearer* is a device sync token — write only, and scoped to the
account that owns the device. *Session* is any signed-in account. *User* is a
signed-in non-admin: admins are rejected from fund routes, because the admin
account manages the server rather than using it. *Admin* is the reverse.

Anything addressed by `:id` under `/api/devices` and `/api/photos` is checked for
ownership, and returns the same 404 whether the thing doesn't exist or isn't
yours — so ids can't be probed.

`/api/health` returns `{"service":"fundtracker"}`. The app checks that field
rather than just the status code — a 200 from an unrelated host is not proof you
typed the right address.

## Storage

SQLite at `$FUNDTRACKER_DATA_DIR/fundtracker.db` (a Docker volume at `/data`),
through Node's built-in `node:sqlite` — no native module, no build toolchain in
the image. Photo bytes sit beside it in `photos/`.

Back up by copying the whole directory. Foreign keys are on and WAL is enabled,
so copy while the server is stopped, or use `sqlite3 ... ".backup"`.

Accounts, devices, invites, snapshots and photo ownership are all keyed by
`accounts.id`, which is what makes renaming an account safe.

On first start the server migrates any `users.json` / `devices.json` /
`invites.json` / `snapshot.json` it finds and renames them `.migrated`. Password
hashes carry across unchanged, so nobody's password breaks.

Photos are stored as `photos/<sha256>.jpg`, named by their own content. The
sync response tells the phone which hashes are missing and only those are
uploaded, so a photo crosses the network once rather than on every sync. Uploads
are verified: the bytes must hash to the claimed name, start with a JPEG marker,
and be under 3MB. Photos the current snapshot doesn't reference are pruned on
the next sync.

## Run locally

```sh
npm install
export SESSION_SECRET=$(openssl rand -hex 32)
node scripts/set-password.js you@example.com
npm start                      # http://localhost:3100
```

No `FUNDTRACKER_TOKEN` needed: the app gets its own token by signing in.

## Accounts, roles and activation codes

Accounts have a role (`user` or `admin`) and an active flag. Records written
before roles existed are plain `{ password }` and read as active users, so
nothing had to be migrated.

**Registration is closed.** `POST /api/auth/register` creates nothing without a
one-time activation code, which only an admin can issue. That's what keeps a
publicly reachable server from being an open sign-up.

Codes read as `ABCD-EFGH-JKMN` — 12 symbols from an alphabet with I, L, O and U
removed so nothing is ambiguous when typed off a screen. 60 bits of entropy,
single use, expiring after 14 days by default. Only the SHA-256 is stored; the
plaintext exists once, in the response that created it.

### The admin interface

`/admin` — accounts, devices and codes. It needs an account with the admin role:

```sh
node scripts/set-password.js you@example.com --admin
```

A server with no accounts creates `admin` / `defaultadmin` on first start, with
`must_change_password` set — it can sign in and do nothing else until the
password is replaced. Change it immediately; the default is published here.

The admin account reaches `/admin` and nothing else. It has no fund data, can't
sync, and can't sign in from the iOS app.

Three invariants are enforced in `routes/admin.js` rather than in the page,
because the page isn't the only possible caller:

- the last active admin can't be deleted, demoted or deactivated — losing every
  admin means nobody can make one again without shell access
- you can't demote or deactivate yourself
- disabling an account or changing its password revokes its device tokens, so a
  phone that already holds one stops syncing

## Managing accounts and devices

```sh
node scripts/set-password.js you@example.com          # set or reset a password
node scripts/set-password.js you@example.com --admin # ...and grant admin

node scripts/accounts.js list [search]
node scripts/accounts.js devices <accountId>
node scripts/accounts.js delete <accountId>          # cascades to its devices,
                                                     # snapshot and photos
```

Any string works as a login — email is a convention, not a constraint, so a
self-hoster can use a plain username. Accounts are addressed by numeric id
everywhere else, which is what makes renaming one safe: the id doesn't move, so
its devices, codes, snapshot and photos follow it.

These scripts are the fallback for when nobody can sign in. Everything they do
is also in `/admin`.

## Deployment (homeserver, <SERVER_LAN_IP>)

Runs as Docker containers — no sudo needed, matching how `remote-camera` runs.
Port 3100 stays clear of the Spotify server on 3000.

```
internet ──443──▶ Caddy (TLS, Let's Encrypt) ──▶ app:3100 (internal network only)
```

The app is published to `127.0.0.1:3100` for local debugging and is otherwise
unreachable except through Caddy.

`.env` on the server holds `SESSION_SECRET` and `FUND_DOMAIN`, mode 600, plus
`FUNDTRACKER_TOKEN` until every phone has signed in. Secrets were generated with
`openssl rand -hex 32` directly on the box.

```sh
# push code
rsync -az --exclude node_modules --exclude data --exclude .env \
  ~/FundTrackerApp/server/ <user>@<SERVER_LAN_IP>:~/fundtracker/

# bring it up
ssh <user>@<SERVER_LAN_IP>
cd ~/fundtracker && docker compose up -d --build

# create or change a login (prompts, no echo)
docker exec -it fundtracker node scripts/set-password.js <username>

# accounts and their devices (day to day, use /admin instead)
docker exec -it fundtracker node scripts/accounts.js list
docker exec -it fundtracker node scripts/accounts.js devices <accountId>
```

### Router / DNS prerequisites

- DNS `A` record `fundtracker.example.com` → `<SERVER_PUBLIC_IP>` (static, IONOS-hosted DNS)
- Router forwards TCP **80** and **443** → `<SERVER_LAN_IP>` (verified: Let's Encrypt validated from five global vantage points)
  - 80 is needed for the HTTPS redirect; Caddy validated via TLS-ALPN on 443
- The public IP is static, so no dynamic DNS is needed

### Certificates

Caddy obtains and renews automatically. Certificates and ACME state live in the
`caddy_data` volume — don't delete it, or you'll re-request from Let's Encrypt
and can hit their rate limits.

## Exposure notes

The login page is on the public internet and will be scanned. What stands in
front of the data: TLS, a scrypt-hashed password, per-IP lockout, and a signed
HttpOnly cookie. Worth doing periodically:

```sh
docker logs fundtracker-caddy | grep -c ' 401 '   # failed sign-ins
```

Device photos **are** uploaded and are readable by anyone who can sign in, so
the dashboard password now guards your photos as well as your figures.
