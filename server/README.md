# FundTracker dashboard

Read-only web view of the repair fund. The iOS app is the source of truth and
pushes its whole dataset here; this side never edits anything.

## Access model

Two different callers, two different credentials:

| Caller        | Credential                        | Reaches                          |
|---------------|-----------------------------------|----------------------------------|
| iOS app       | Bearer token (`FUNDTRACKER_TOKEN`)| `POST /api/sync` only            |
| You, a browser| Username + password → session cookie | `GET /api/summary`, `/api/snapshot` |

The token can't read your data and the session can't push data. Passwords are
scrypt-hashed (N=16384) in `data/users.json`. Sessions are stateless
HMAC-signed cookies — HttpOnly, SameSite=Lax, Secure behind TLS — so they
survive a restart and are unreadable from JavaScript.

Failed logins are throttled to 10 per IP per 15 minutes. Unknown usernames run
a dummy hash and return the same message as a wrong password, so the response
doesn't reveal which accounts exist.

## Endpoints

| Method | Path                | Auth    | Purpose                          |
|--------|---------------------|---------|----------------------------------|
| GET    | `/api/health`       | none    | Liveness                         |
| POST   | `/api/auth/login`   | none    | Sign in, sets the session cookie |
| POST   | `/api/auth/logout`  | none    | Clears it                        |
| POST   | `/api/sync`         | Bearer  | The app pushes `{ devices, sales }` |
| GET    | `/api/summary`      | Session | Everything the dashboard renders |
| GET    | `/api/snapshot`     | Session | Raw payload, for backups         |

## Storage

`$FUNDTRACKER_DATA_DIR/snapshot.json` (a Docker volume at `/data`). Writes go to
a temp file and are renamed into place, so an interrupted write can't corrupt
it. Back up by copying that directory — it also holds `users.json`.

## Run locally

```sh
npm install
export FUNDTRACKER_TOKEN=$(openssl rand -hex 32)
export SESSION_SECRET=$(openssl rand -hex 32)
node scripts/set-password.js <username>
npm start                      # http://localhost:3100
```

## Deployment (homeserver, <SERVER_LAN_IP>)

Runs as Docker containers — no sudo needed, matching how `remote-camera` runs.
Port 3100 stays clear of the Spotify server on 3000.

```
internet ──443──▶ Caddy (TLS, Let's Encrypt) ──▶ app:3100 (internal network only)
```

The app is published to `127.0.0.1:3100` for local debugging and is otherwise
unreachable except through Caddy.

`.env` on the server holds `FUNDTRACKER_TOKEN`, `SESSION_SECRET` and
`FUND_DOMAIN`, mode 600. Secrets were generated with `openssl rand -hex 32`
directly on the box.

```sh
# push code
rsync -az --exclude node_modules --exclude data --exclude .env \
  ~/FundTrackerApp/server/ <user>@<SERVER_LAN_IP>:~/fundtracker/

# bring it up
ssh <user>@<SERVER_LAN_IP>
cd ~/fundtracker && docker compose up -d --build

# create or change a login (prompts, no echo)
docker exec -it fundtracker node scripts/set-password.js <username>
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
