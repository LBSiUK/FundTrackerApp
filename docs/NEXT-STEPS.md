# Next steps

## Do these soon

**Change the admin password.** The `admin` account still holds the default
`defaultadmin` until someone signs in and replaces it. It can't do anything else
until then — every route but change-password returns 428 — but it is a published
default on a server reachable from the internet. Sign in at
`https://fundtracker.example.com/admin`.

**Delete `FUNDTRACKER_TOKEN` from `~/fundtracker/.env`.** It is ignored now that
sync is per-account. The server logs a reminder at startup while it's set.

**Raise the `fundtracker` DNS TTL to 3600.** Still at 300 from the setup phase.
IONOS → Domains & SSL → `example.com` → DNS → edit `fundtracker`. Nothing left to
iterate on, and a permanently short TTL adds pointless lookups.

**Shorten the session cookie.** 30 days and stateless, so a stolen cookie stays
valid that long and the only remedy is rotating `SESSION_SECRET`, which signs
everyone out. `MAX_AGE_MS` in `server/middleware/session.js`.

**Tidy the migrated JSON.** `~/fundtracker/data/*.json.migrated` are leftovers
from the move to SQLite. Nothing reads them; delete once you're happy.

## Known gaps

**Two flows have never been driven end to end.** Everything server-side is
exercised with curl, and the app compiles and has been screenshotted, but nobody
has typed a real password through the app's sign-in, nor tapped Reset App and
watched it return to onboarding. Both are code-correct as far as reading goes.
Driving the simulator by touch needs accessibility permission that wasn't
available; see the recording technique in [IOS-APP.md](IOS-APP.md) for what
*can* be checked without it.

**No tests.** Verification has been manual throughout: curl against a running
server, builds, and screenshots. Two things deserve covering first — the money
rules in `FundSummary.swift` / `summary.js`, because they're duplicated across
two languages and must agree, and the auth boundaries (account isolation, admin
separation, token scoping), because those were verified once by hand and nothing
would catch a regression.

**The dashboard is read-only.** Editing from a browser would need bidirectional
sync, which breaks the full-replace assumption. See [DECISIONS.md](DECISIONS.md).

**Sync is manual.** Settings → Sync Now. Could sync on background, or after an
edit with a debounce. Neither is built.

**Photo storage has no overall budget.** Uploads are capped at 3MB each and
orphans are pruned per account on each sync, but nothing caps the total. At
200–400KB a photo it would take a lot to matter; `du -sh ~/fundtracker/data/photos`
if the box gets tight.

**Currency is hardcoded to GBP**, isolated to `Double.currency` in
`FundSummary.swift` and the `Intl.NumberFormat` in `public/app.js`.

**The dashboard's web CSS still uses its original green/red palette.** The iOS
app moved to the brand colours; `server/public/style.css` didn't.

## Ideas discussed but not started

**Move the website to `homeserver`.** The site is on InfinityFree and serves a
self-signed certificate, so browsers warn on `https://example.com`. Moving it
would get a real Let's Encrypt cert, drop the anti-bot challenge, and collapse
DNS to `@`, `www` and `fundtracker` — no wildcard, no `cpanel`, no
`_acme-challenge`. About four lines of Caddyfile.

The work depends on what the site is: static HTML is an hour; PHP + MySQL is a
real migration; WordPress is fiddlier still. Also worth weighing that home upload
speed becomes the site's speed for visitors. Do it as its own change.

**Auto-import eBay sales.** eBay has an API; Vinted doesn't, so that side stays
manual regardless. Needs OAuth token storage and scheduled polling.

**Per-device profit.** Sales and devices are unlinked. Linking them would show
profit per repair. Schema change on both sides.

## If security ever needs tightening

The login page is publicly reachable and will be scanned. If
`docker logs fundtracker-caddy | grep -c ' 401 '` climbs into the thousands,
putting Cloudflare or Tailscale in front needs **no application changes** — only
the exposure layer moves.
