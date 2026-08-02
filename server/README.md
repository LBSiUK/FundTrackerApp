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
`data/devices.json` — plain SHA-256 rather than scrypt on purpose, because a
token is CSPRNG output with no dictionary to attack, unlike a human-chosen
password. Each phone can be revoked without disturbing the others.

Passwords are scrypt-hashed (N=16384) in `data/users.json`. Sessions are
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

| Method | Path                | Auth    | Purpose                          |
|--------|---------------------|---------|----------------------------------|
| GET    | `/api/health`       | none    | Liveness, and what the app probes during setup. Returns `service` and `setupRequired` |
| POST   | `/api/auth/login`   | none    | Sign in, sets the session cookie |
| POST   | `/api/auth/device`  | none    | Exchange email + password for a device token |
| POST   | `/api/auth/logout`  | none    | Clears the cookie                |
| POST   | `/api/sync`         | Bearer  | The app pushes `{ devices, sales }` |
| GET    | `/api/summary`      | Session | Everything the dashboard renders |
| GET    | `/api/snapshot`     | Session | Raw payload, for backups         |
| GET    | `/api/devices`      | Session | Phones that can sync             |
| DELETE | `/api/devices/:id`  | Session | Revoke one                       |

`/api/health` returns `{"service":"fundtracker"}`. The app checks that field
rather than just the status code — a 200 from an unrelated host is not proof you
typed the right address.

## Storage

`$FUNDTRACKER_DATA_DIR/snapshot.json` (a Docker volume at `/data`). Writes go to
a temp file and are renamed into place, so an interrupted write can't corrupt
it. Back up by copying that directory — it also holds `users.json` and
`devices.json`.

## Run locally

```sh
npm install
export SESSION_SECRET=$(openssl rand -hex 32)
node scripts/set-password.js you@example.com
npm start                      # http://localhost:3100
```

No `FUNDTRACKER_TOKEN` needed: the app gets its own token by signing in.

## Managing accounts and devices

```sh
node scripts/set-password.js you@example.com   # create or change a password
node scripts/users.js list
node scripts/users.js delete you@example.com   # also revokes that account's devices

node scripts/devices.js list
node scripts/devices.js revoke <id>            # that phone 401s on its next sync
```

Any string works as a login — email is a convention, not a constraint, so a
self-hoster can use a plain username.

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

# see which phones can sync, and revoke one
docker exec -it fundtracker node scripts/devices.js list
docker exec -it fundtracker node scripts/devices.js revoke <id>
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

Device photos are never uploaded; they stay on the phone.
