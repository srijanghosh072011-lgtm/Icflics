# Icflic

Marketing site and booking system for Icflic, a sports photography studio
working with athletes.

Hand-written HTML, CSS and JavaScript with **no build step**, plus Cloudflare
Pages Functions and a D1 database for the booking engine and the owner panel.
The only dependency is `wrangler`, and it is a dev tool — nothing ships to the
browser but the files in `public/`.

---

## Quick start

```bash
npm install
cp .env.example .dev.vars              # then fill it in — see below
npm run owner:hash -- "a long passphrase"   # paste the result into .dev.vars
npm run db:init                        # create the local tables
npm run dev                            # http://localhost:8788
```

Useful commands:

| Command | What it does |
|---|---|
| `npm run dev` | Local server with the real Functions and a local D1 |
| `npm run check` | Preflight: leaked artefacts, CSP violations, broken links, JSON-LD, alt text |
| `npm run sitemap` | Regenerate `public/sitemap.xml` from the pages on disk |
| `npm run owner:hash -- "passphrase"` | Generate `OWNER_PASSWORD_HASH` |
| `npm run set-domain -- --domain https://…` | Rewrite the domain, email and brand everywhere |
| `npm run deploy` | Deploy to Cloudflare Pages |
| `npm audit` | Dependency CVEs |

**Before launching, work through [`docs/LAUNCH.md`](docs/LAUNCH.md).** It covers
the values that still need real data, adding the real photos, deploying, DNS
and email records, and registering with search engines.

---

## Layout

```
public/                 Everything served to the browser
  index.html            Home
  work.html             Portfolio
  services.html         Packages and pricing
  about.html            Story and approach
  faq.html              Expanded FAQ (the main answer-engine surface)
  book.html             Booking calendar
  contact.html          Contact form
  privacy.html          Privacy policy
  terms.html            Terms of service
  404.html
  owner/index.html      Private booking panel (noindex, password-protected)
  assets/
    css/site.css        The whole design system
    css/owner.css       Panel-only styles
    js/site.js          Nav and scroll reveals
    js/booking.js       Booking calendar
    js/contact.js       Contact form
    js/owner.js         Owner panel
    fonts/              Self-hosted Bodoni Moda + Inter
    img/                Photography (placeholders until real photos land)
  _headers              Security headers and the CSP
  _redirects            URL aliases
  robots.txt            Includes explicit rules for AI crawlers
  sitemap.xml           Generated
  llms.txt              Structured summary for answer engines

functions/              Cloudflare Pages Functions (the server)
  _lib/                 Shared modules (not routed — the underscore prefix)
    config.js           Timezone, slot length, rate limits, lead time
    crypto.js           Password hashing, session tokens, IP hashing
    time.js             Timezone-correct slot maths
    availability.js     The scheduling engine
    session.js          Owner sessions and CSRF
    auth.js             Guard for owner-only endpoints
    validate.js         Server-side input validation
    ratelimit.js        Fixed-window rate limiting
    http.js             JSON responses, origin checks
    turnstile.js        Optional CAPTCHA
  api/
    availability.js     GET — public calendar data
    bookings.js         POST — create a booking request
    contact.js          POST — contact message
    owner/              Sign-in, panel state, and every mutation

schema.sql              D1 tables
scripts/                Dev tools (never deployed)
docs/                   Launch checklist and security notes
SECURITY.md             The pre-launch checklist this project was built against
```

---

## How the booking system works

1. `/book` asks `/api/availability` for a month of open slots.
2. The engine offers a slot only when **all** of these hold: bookings are
   globally enabled, it falls inside an active weekly rule, it is at least
   24 hours away, it does not overlap a blackout, and it does not overlap an
   existing booking plus its buffer.
3. On submit, the server **recomputes availability from scratch** and rejects
   anything not genuinely open. Two people racing for the last slot cannot
   both win, and a crafted request cannot book a time never offered.
4. The request lands as `pending`. The owner confirms, declines or cancels it
   in the panel.

Slot length, buffer, lead time and timezone all live in
`functions/_lib/config.js`.

### Turning bookings off

The owner panel has a master switch. With it off, `/book` shows a custom
message instead of the calendar and the booking endpoint refuses new requests.
For finer control, blackout windows take specific dates or hours off the
calendar without closing everything.

---

## Design system

Everything is driven by custom properties at the top of `public/assets/css/site.css`.

- **Type:** Bodoni Moda for display (set in caps, which reads architectural
  rather than fashion), Inter for everything else. Both self-hosted, so no
  third-party font CDN appears in the CSP.
- **Palette:** warm near-black `--ink`, warm paper `--cream`, and a single
  accent, brass `--brass`. Near-monochrome by design: the photographs are
  meant to be the only real colour on the page. `--pitch` (deep field green)
  is kept for the rare full-bleed green ground.
- **Contrast:** every text pairing meets WCAG AA, measured rather than
  estimated. The constraints are written into the token comments — notably
  `--brass` is only 2.1:1 on cream, so brass **text** on a light ground uses
  `--brass-ink`, and the focus ring switches tone with the ground.
- **Grounds:** put `data-ground="dark"`, `"pitch"` or `"cream-2"` on a section
  and every component inside adapts. Forgetting it is why a ghost button can
  end up invisible.

---

## Replacing the placeholder images

Images in `public/assets/img/` are generated abstract compositions, each
labelled with the shot it stands in for. **Drop a real photo in at the same
filename and it swaps in with no code change.** Sizes and subjects are listed
in `docs/LAUNCH.md`.

Regenerate them (after a palette change, say) with:

```bash
pip install Pillow fonttools brotli
python3 scripts/make-placeholders.py
```

Remember to update each image's `alt` text to describe the real photo.

---

## Why there are HTML files in the repository root

GitHub Pages on this repo is set to **Deploy from a branch**, and that mode
serves the branch **root**. With only `README.md` there, Pages rendered the
readme through Jekyll instead of the site — a white page with the repo name on
it. So the built preview is committed to the root alongside a `.nojekyll` file.

**`public/` is still the source of truth.** The root copies are generated
output. After changing anything in `public/`, regenerate them:

```bash
npm run preview:root
```

then commit the result, or the preview goes stale.

If you switch the Pages source to **GitHub Actions**, the workflow in
`.github/workflows/pages.yml` publishes `dist/` for you and every one of those
root files can be deleted. None of this affects Cloudflare Pages, which serves
`public/` directly and is the real deployment.

---

## A note on the chrome

The header and footer are duplicated in each HTML file. That is deliberate:
it keeps the site buildless and hand-editable. If you change the navigation,
change it in every page in `public/` — `npm run check` will catch a link that
points at a page which does not exist, but it cannot tell you that one page's
menu is now out of step with the others.

---

## Security

Built against `SECURITY.md`. `docs/SECURITY-NOTES.md` records the design
decisions, the threat-to-control mapping, and the one documented deviation
from the checklist (PBKDF2 instead of bcrypt/argon2, with the reasoning).

`npm run check` enforces the mechanical parts on every run, so they cannot
quietly rot.
