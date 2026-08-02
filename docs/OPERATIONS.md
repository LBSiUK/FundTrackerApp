# Operations runbook

## The setup

| | |
|---|---|
| Server | `homeserver`, Ubuntu 24.04, `ssh <user>@<SERVER_LAN_IP>` |
| Deploy dir | `~/fundtracker` |
| Public URL | `https://fundtracker.example.com` |
| Public IP | `<SERVER_PUBLIC_IP>` (static) |
| Login | username `<username>` |
| Containers | `fundtracker` (app), `fundtracker-caddy` (TLS) |

There is **no passwordless sudo** on that box. Everything runs as Docker
containers under your own user, which is why nothing here needs root. You are in
the `docker` group.

Port choice: the app uses **3100**. Port 3000 is the existing `remote-camera`
nginx vhost, 3002 its container. Don't collide with those.

## Deploying a change

```sh
rsync -az --exclude node_modules --exclude data --exclude .env --exclude logs \
  ~/FundTrackerApp/server/ <user>@<SERVER_LAN_IP>:~/fundtracker/

ssh <user>@<SERVER_LAN_IP>
cd ~/fundtracker && docker compose up -d --build
```

`.env` is excluded from rsync deliberately — it holds the secrets and lives only
on the server.

## Everyday commands

```sh
cd ~/fundtracker

docker compose ps                     # what's running
docker compose logs -f app            # app logs
docker compose logs -f caddy          # TLS / certificate logs
docker compose restart app            # restart just the app
docker compose down && docker compose up -d   # full cycle

# change or add a login (prompts twice, no echo, 12 char minimum)
docker exec -it fundtracker node scripts/set-password.js <username>

# logins
docker exec -it fundtracker node scripts/users.js list
docker exec -it fundtracker node scripts/users.js delete <username>

# grant admin (needed for /admin, which is where activation codes come from)
docker exec -it fundtracker node scripts/set-password.js <email> --admin

# phones allowed to sync
docker exec -it fundtracker node scripts/devices.js list
docker exec -it fundtracker node scripts/devices.js revoke <id>
```

Deleting a login also revokes the device tokens issued to it, so a phone can't
outlive the account it signed in as.

## Secrets

`~/fundtracker/.env`, mode 600:

| Key | Purpose | If rotated |
|---|---|---|
| `SESSION_SECRET` | signs login cookies | everyone is signed out |
| `FUND_DOMAIN` | the hostname Caddy gets a cert for | Caddy re-requests a certificate |
| `FUNDTRACKER_TOKEN` | *legacy.* The old shared sync token | any phone still using it stops syncing until it signs in |

`FUNDTRACKER_TOKEN` is no longer required. Phones now sign in and get their own
token, stored hashed in `data/devices.json`. Once
`docker exec -it fundtracker node scripts/devices.js list` shows every phone you
own, delete the line from `.env` and `docker compose up -d` — the server logs a
reminder on startup while it's still set.

All generated on the server with `openssl rand -hex 32`. To read one:
`grep FUNDTRACKER_TOKEN ~/fundtracker/.env`.

To force every browser session to log in again, rotate `SESSION_SECRET` and
`docker compose up -d`.

## Backups

Everything that matters is in `~/fundtracker/data/`:

- `snapshot.json` — your synced records
- `users.json` — login hashes (mode 600)
- `devices.json` — hashed device tokens (mode 600). Lose it and every phone
  needs to sign in again; nothing else breaks.
- `invites.json` — hashed activation codes (mode 600). Losing it invalidates
  any unused codes; issue new ones.
- `photos/` — device photos, named by content hash. Lose them and the next sync
  re-uploads from the phone, since that's still where they originate.

```sh
du -sh ~/fundtracker/data/photos     # how much space photos are taking
```

```sh
tar czf ~/fundtracker-backup-$(date +%F).tar.gz -C ~/fundtracker data
```

The phone is the source of truth, so losing `snapshot.json` costs you nothing
permanent — sync again and it's rebuilt. Losing `users.json` just means running
`set-password.js` again.

**Don't delete the `caddy_data` volume.** It holds the certificate and ACME
account state. Deleting it forces a fresh certificate request, and Let's Encrypt
rate-limits to 5 failures per hostname per hour.

## DNS

Nameservers are **IONOS** (`ns1110.ui-dns.de`), moved off InfinityFree because
their panel won't let you add arbitrary A records for a custom domain.

| Type | Name | Value | Note |
|---|---|---|---|
| A | `@` | `<SHARED_HOST_IP>` | website, on InfinityFree |
| A | `www` | `<SHARED_HOST_IP>` | website |
| A | `cpanel` | `<CPANEL_IP>` | InfinityFree control panel |
| A | `*` | `<WILDCARD_IP>` | wildcard — see the warning below |
| CNAME | `_acme-challenge` | `<uuid>.acmedns.infinityfree.net.` | how InfinityFree renews the website's SSL |
| A | `fundtracker` | `<SERVER_PUBLIC_IP>` | this dashboard |

The real values are in `docs/LOCAL-NOTES.md`, which is not in this repository.

**The wildcard is a trap.** Anything not explicitly listed resolves to
InfinityFree. If the `fundtracker` record is ever deleted, the dashboard won't
fail loudly — it'll silently start serving iFastNet's error page with a
certificate warning. If the website ever moves off InfinityFree, delete the
wildcard so mistakes announce themselves.

## Certificates

Caddy obtains and renews automatically via Let's Encrypt, validated over
TLS-ALPN on port 443. Current certificate expires **30 Oct 2026**; renewal
happens well before that with no action needed.

Requirements that must stay true: ports **80 and 443 forwarded** to
`<SERVER_LAN_IP>`, and the `fundtracker` A record pointing at the public IP.

To check:
```sh
echo | openssl s_client -connect fundtracker.example.com:443 \
  -servername fundtracker.example.com 2>/dev/null | openssl x509 -noout -dates
```

## Troubleshooting

**Certificate warning, then an iFastNet "DNS Resolution Error" page**
Your resolver has a stale cached answer pointing at the old wildcard. Check with
`dig +short A fundtracker.example.com` — `<SERVER_PUBLIC_IP>` is right,
`<WILDCARD_IP>` is stale. This bit once already: the old wildcard had a 24-hour
TTL and Virgin Media's resolvers held it. Flushing your Mac's cache doesn't
help, because the stale copy is upstream. Either wait it out or switch DNS to
`8.8.8.8` / `9.9.9.9`.

**Dashboard loads but shows nothing**
Nothing has been synced. Open the app → Insights → gear → Sync Now.

**Sync fails from the phone**
"The server rejected this device" means the token was revoked (or the account
deleted) — sign in again from Settings. Anything else is a transport failure:
check the server address, which Settings shows as a hostname.

**Onboarding says "it isn't a FundTracker server"**
Something answered but `/api/health` didn't return `service: fundtracker`. Either
the address is wrong, or the wildcard DNS trap below sent you to InfinityFree.

**Onboarding says "that server has no accounts yet"**
`/api/health` reported `setupRequired`. Run
`docker exec -it fundtracker node scripts/set-password.js <email> --admin`.

**/admin says "Not an admin"**
The account signed in is a normal user. Promote it, or sign in as one that
already has the role. The server logs a warning at startup when no admin exists
at all, because then nobody can issue codes and nobody can register.

**"That activation code isn't valid"**
Codes are single use and expire after 14 days. Check the Activation codes table
in `/admin` — used and expired ones are listed with their status. Generate a
fresh one; they cost nothing.

**Locked out after too many attempts**
10 failed logins per IP per 15 minutes. Wait it out, or
`docker compose restart app` — the throttle is in memory.

**Testing from inside the house is misleading**
Your Mac is on the same LAN. `curl` to the public IP depends on hairpin NAT (it
does work here, but it isn't proof of anything external). The real proof that
port forwarding works is that Let's Encrypt validated from five global vantage
points during issuance.

## Health check

```sh
curl -s https://fundtracker.example.com/api/health          # {"ok":true,...}
curl -s https://fundtracker.example.com/api/summary         # 401 when signed out — correct
curl -sI https://fundtracker.example.com/ | grep -i strict  # HSTS present
```

## Security posture

Publicly reachable, so the login page **will** be scanned. In front of the data:
TLS, a scrypt-hashed password (N=16384), per-IP lockout, signed HttpOnly
`SameSite=Lax` cookie, CSP, HSTS, `X-Frame-Options: DENY`. The app container is
bound to `127.0.0.1` only — Caddy is the sole route in, and nothing on the LAN
can reach port 3100 directly.

Occasionally worth a look:
```sh
docker logs fundtracker-caddy | grep -c ' 401 '
```

If that climbs into the thousands, put a VPN or Cloudflare in front. No app
changes would be needed.
