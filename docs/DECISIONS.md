# Decisions

Why things are the way they are, including what was considered and rejected.

## Parts became records instead of a text field

The original mockup had `partsNeeded: String` ("screen, battery, rear glass")
and a hardcoded `totalSpentOnParts = 600.00`, with `totalMoneyIn` returning a
fixed `1250.00`. That reads correctly in a mockup but can't function as a
tracker — the numbers never move.

Parts became real records with a cost and an `isPurchased` flag. That flag is
what makes the app worth having: unpurchased parts are a *planned* cost,
purchased ones are *actual* spend, and the difference is what answers "can I
afford to finish these repairs?"

## Sales track fees and postage separately

eBay takes commission, Vinted doesn't. A single "amount made" figure would
overstate the fund by whatever the platform kept. `netAmount = gross − fees −
shipping` is what actually reaches the fund, and the UI only shows the gross
figure when something was deducted from it.

## SwiftData, not a server-side database

The app works fully offline and owns its data. The dashboard is a viewer.

The alternative — server as source of truth, app as a thin client — would have
meant rewriting the app's whole data layer and made it useless without a
connection. Rejected.

## Full replace on sync, not a merge

Because the dashboard never edits anything, there is nothing on the server to
lose. That removes merge logic, conflict resolution, tombstones, and clock-skew
problems entirely. If the dashboard ever becomes editable, this decision has to
be revisited — and it would be a significant piece of work.

## Devices and sales aren't linked

The sample data ("Vintage jacket", "Old camera") showed sales funding repairs
rather than being the repaired devices. So sales are a general income stream,
not tied to a particular device. If you start selling the devices you fix and
want per-device profit, that's a schema change.

## Two credentials rather than one

Originally a single shared token guarded everything. That's fine for a
machine-to-machine call but weak as a human login: one secret, no accounts, no
logout, no lockout.

Now the phone has a write-only token and you have a read-only login. Neither can
do the other's job, so a leaked phone token exposes nothing.

## Hand-rolled session cookies

Stateless HMAC-signed cookies rather than `express-session`. They survive a
restart without a session store, and the implementation is small enough to read
in one sitting. Passwords use Node's built-in `scrypt` — no bcrypt dependency.

The whole server has exactly one runtime dependency (`express`), matching the
existing SpotifyServer's minimal-deps style.

## Docker, not systemd

There's no passwordless sudo on `homeserver`, and installing a systemd unit needs
root. You're in the `docker` group, and the existing `remote-camera` app already
runs as a container, so containers with `restart: unless-stopped` give the same
outcome with no privilege escalation.

## Caddy and port forwarding, over Cloudflare Tunnel

Offered: Cloudflare Tunnel (no open ports, but Cloudflare terminates TLS and
sees the traffic), Caddy plus port forwarding (end-to-end TLS you control, but a
publicly reachable login page), and Tailscale (nothing public at all, but only
reachable from devices running Tailscale).

Chose Caddy + port forwarding for end-to-end TLS with no third party in the
path, accepting that the login page is publicly scannable. The auth in front of
it was strengthened accordingly. Swapping in a tunnel or VPN later needs no
application changes.

## DNS moved from InfinityFree to IONOS

InfinityFree served DNS for `example.com` and their panel doesn't expose arbitrary A
records — their own staff direct custom-domain users to "add A records at your
domain registrar", which requires the registrar to be authoritative. So the
nameservers moved to IONOS, with all six existing records reproduced first so
the website never went dark during the changeover.

Cloudflare DNS would also have worked, but it meant a new third party for
someone who'd just chosen to avoid one.

## Charts

Single-hue per chart, because both are single-series magnitude — there's no
categorical identity to encode, so no palette to validate and no legend needed.
The platform breakdown is a ranked list rather than a pie; pies read poorly and
would have needed a categorical palette for three items.

## Bugs worth remembering

These were all caught by running things and looking at the output, not by
reading the code:

- **Express router mounted at `/` under `/api`** — `POST /api/sync` 404'd.
- **Month buckets built in local time, serialised with `toISOString()`** — BST
  shifted every label back a month, producing a duplicate "Mar" and filing
  July's sales under June. Now UTC on both sides.
- **Floating-point money** surfacing as `204.60000000000002`. Hence `round2`.
- **`.gate { display: grid }` beat the UA stylesheet's `[hidden]`** — the login
  form and dashboard rendered on top of each other. Fixed globally with
  `[hidden] { display: none !important }`.
- **`.month(.narrow)`** rendered both March and May as "M".
- **Y-axis ticks at £0/£67/£133/£200** — replaced with a nice-number scale.
