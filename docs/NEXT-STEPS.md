# Next steps

## Do these soon

**Raise the `fundtracker` DNS TTL to 3600.** It's still at 300 from the
setup phase. In IONOS: Domains & SSL → `example.com` → DNS → edit `fundtracker`.
Nothing left to iterate on, and a permanently short TTL adds pointless lookups
and gives you no cached answer to fall back on if a DNS server wobbles.

**Create your email login and sign the phone in.** On the server:
`docker exec -it fundtracker node scripts/set-password.js you@example.com`, then
remove the old one with `node scripts/users.js delete <old-username>`. On the
phone: Insights → gear → Sign Out, then sign back in with the email. That swaps
the shared token for one belonging to this phone. Finally drop
`FUNDTRACKER_TOKEN` from `~/fundtracker/.env` and `docker compose up -d`.

**Shorten the session cookie.** It's 30 days and stateless, so a stolen cookie
stays valid that long and the only remedy is rotating `SESSION_SECRET`.
`MAX_AGE_MS` in `server/middleware/session.js`.

**~~Put this under git.~~** Done — public at `github.com/LBSiUK/FundTrackerApp`.
Because it's public, the docs use placeholder hostnames, IPs and usernames; the
real values are in `docs/LOCAL-NOTES.md`, which is gitignored. Keep it that way:
anything you write into the docs is world-readable.

## Known gaps

**Sync is manual.** You have to open Settings and tap Sync Now. Options: sync
automatically on app background, or after any edit with a debounce. Neither is
built.

**Photos aren't uploaded.** Deliberate — they'd bloat the payload and the
dashboard doesn't show them. If you want them on the dashboard, it needs
multipart upload, server-side storage, and a size budget.

**The dashboard is read-only.** Editing from a browser would need bidirectional
sync, which breaks the "full replace" assumption that keeps the whole thing
simple. See [DECISIONS.md](DECISIONS.md).

**No tests.** Verification so far has been manual: running the app in the
simulator, screenshotting, and curling the API. The money rules in
`FundSummary.swift` / `summary.js` are the obvious first thing to cover, since
they're duplicated across two languages and must agree. The auth paths are the
second — token scoping and revocation were verified by hand with curl, which
proves they worked once, not that they still do.

**Device revocation has no dashboard UI.** `GET /api/devices` and
`DELETE /api/devices/:id` exist and are session-guarded, but nothing in
`public/` calls them yet. Use `scripts/devices.js` until it does.

**The onboarding flow hasn't been driven end to end in the simulator.** The
server side was exercised thoroughly with curl and the app compiles and presents
the first screen correctly, but nobody has typed a real password into a real
build and watched a token come back. Do that once before trusting it.

**Currency is hardcoded to GBP**, isolated to `Double.currency` in
`FundSummary.swift` and the `Intl.NumberFormat` in `public/app.js`.

## Ideas discussed but not started

**Move the website to `homeserver`.** Your site is on InfinityFree and currently
serves a **self-signed certificate**, so browsers warn on `https://example.com`.
Moving it to the same box would get a real Let's Encrypt cert automatically,
drop the anti-bot challenge, and collapse DNS to `@`, `www` and `fundtracker`
all pointing at `<SERVER_PUBLIC_IP>` — no wildcard, no `cpanel`, no
`_acme-challenge`. Adding it to the Caddyfile is about four lines.

The work depends on what the site is: static HTML is an hour; PHP + MySQL is a
real migration (export the database, move uploads, check hardcoded paths);
WordPress is fiddlier still. Also worth weighing that your home upload speed
becomes the site's speed for visitors.

Do it as its own change, not alongside anything else.

**Auto-import eBay sales.** eBay has an API; Vinted doesn't, so that side stays
manual regardless. Would need OAuth token storage and scheduled polling on the
server.

**Per-device profit.** Currently sales and devices are unlinked. If you start
selling the devices you fix, linking them would let the app show profit per
repair. Schema change.

## If security ever needs tightening

The login page is publicly reachable and will be scanned. If
`docker logs fundtracker-caddy | grep -c ' 401 '` climbs into the thousands,
putting Cloudflare or Tailscale in front needs **no application changes** —
only the exposure layer moves.
