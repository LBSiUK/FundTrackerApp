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

That survived the move to accounts: the app signs in with a password once and
gets a per-device token back, and the password is never stored on the phone. The
sign-in screen changed how the token is obtained, not what it can do.

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

## SQLite, after the JSON files stopped fitting

State was four JSON files, which was right while there was one user. Two things
broke it at once: renaming an account meant rewriting the key every other file
pointed at, and there was a single server-wide `snapshot.json`, so a second user
would have silently replaced the first's records. Both are relational problems.

Now SQLite, and **everything hangs off `accounts.id`, never a username**. A
rename is one `UPDATE`; devices, invites, snapshots and photo ownership follow
because they reference the id, and sessions carry the id so a rename doesn't sign
anyone out.

`node:sqlite` — built into Node — over `better-sqlite3`, which would have needed
python, make and g++ in the Alpine image for a dependency the standard library
already provides. The server still has exactly one runtime dependency.

Migration runs once at startup, carries password hashes across unchanged so
nobody's password breaks, and renames the old files `.migrated` so a restart
can't replay it. It was rehearsed against a reproduction of the live server's
exact layout before being pointed at the real thing.

## Registration is closed

A login page on the public internet should not also be a sign-up page. Creating
an account needs a one-time activation code that only an admin can issue.

Codes are 12 symbols from an alphabet without I, L, O or U, so nothing is
ambiguous typed off a screen into a phone — 60 bits, single use, 14-day expiry,
stored only as SHA-256. Validation and consumption are one statement
(`UPDATE ... WHERE used_at IS NULL`); checking first and marking used afterwards
is how a code gets redeemed twice.

## The admin account is not a user

It reaches `/admin` and nothing else — no dashboard, no sync, no photos, and it
can't sign in from the app. It manages the server rather than using it, so it has
no fund of its own and `requireUser` rejects it everywhere.

A fresh server creates `admin` / `defaultadmin` with `must_change_password` set.
A published default is only tolerable because that flag makes the account inert:
428 on everything except change-password until it's replaced.

Three invariants live in `routes/admin.js` rather than the page, because the page
isn't the only possible caller: the last active admin can't be deleted, demoted
or deactivated; you can't demote or deactivate yourself; and disabling an account
or changing its password revokes its device tokens.

## Photos are uploaded now — a reversal

They used to stay on the phone deliberately. They're uploaded and shown on the
dashboard because that was asked for, and the trade is real and worth restating:
**device photos live on the server**, are in backups, and are readable by anyone
who can sign in.

They travel separately from the sync payload, addressed by the SHA-256 of the
JPEG, so a photo crosses the network once rather than on every sync — which is
the whole reason this isn't base64 in the sync body. Bytes are shared on disk and
deduped; ownership is per account, so requesting a photo you don't own is a 404
whether or not the file exists.

## Offline or online, asked once and one-way

First launch asks outright. Offline records can join an account later — they sync
up on first connection. Records that have lived under an account can't go back
offline, because the server also holds them and "offline" would be a half-truth.

Tracked by a sticky `hasEverConnected` that signing out deliberately does *not*
clear. Only a full Reset does, and that discards the records too, so the question
is genuinely open again.

## iOS 26, for the Liquid Glass buttons

`.glass` and `.glassProminent` are `@available(iOS 26.0, *)`. Using them without
availability branches everywhere means requiring 26, which drops older devices.
Acceptable for a single-user app; worth knowing before sharing a build.

## Push screens, don't animate a switch

Onboarding steps go onto a `NavigationStack` path. An earlier version animated a
`switch` with `.transition` and `.id` — it took two attempts to get the modifier
order right, still didn't match the system feel, and threw away the back button
and the swipe-back gesture. If a flow reads as a stack of screens, push them.

## The brand palette carries emphasis, not identity

5F021F, BD3E2B, E96B0B, FFF984 are one warm ramp, and a validator run on them
says two things that shaped how they're used. Its ends are mode-specific — 5F021F
is 1.26:1 on a dark surface and FFF984 is 1.07:1 on a light one, so each is
invisible in one mode and the colorsets substitute per mode rather than reusing a
value. And brick and orange sit ΔE 13.7 apart, under the 15 floor for telling two
series apart, so nothing categorical may rely on colour alone: every status and
platform keeps the symbol and label that identify it.

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
- **`.transition` outside `.id`** — the transition landed on a wrapper that was
  never inserted or removed, so the step swapped instantly. Both modifiers are
  valid; the order is the whole bug and nothing warns you. Superseded by using a
  real navigation push.
- **`.clipped()` ate `ignoresSafeArea`** — clipping the container trimmed the
  background back to the safe area and left white bands at the top and bottom.
  Put `ignoresSafeArea` on the colour, not a clip on the container.
- **State seeded once in `.task`** — Reset App cleared `hasSeenOnboarding` and
  nothing happened, because the task had already run and never ran again. Derive
  from the source of truth instead of copying it into `@State`.
- **`/api/devices` survived the SQLite rewrite unchanged** and broke two ways at
  once: it called a `devices.list()` that no longer existed (500), and its
  delete used `requireSession` with no ownership check, so any signed-in user
  could revoke another account's phone. Found by diffing the documented endpoint
  list against the routes the server actually mounts — worth doing after any
  storage change, because a route nobody calls doesn't fail loudly.
- **zsh doesn't word-split unquoted variables** — `$FILES` and `$CURL_ARGS`
  arrived as one argument, which silently sent test requests without their
  cookies and made a working endpoint look broken. Twice.
