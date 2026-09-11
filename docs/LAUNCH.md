# Launch checklist

Work top to bottom. Nothing here takes more than a few minutes, but the order
matters — the domain has to exist before the SSL and email steps make sense.

---

## 1. Fill in the real details

Six facts are currently set to sensible defaults and need the real values.

| What | Current value | Where to change it |
|---|---|---|
| Domain | `https://icflic.com` | `npm run set-domain -- https://therealdomain.com` |
| Contact email | `hello@icflic.com` | same command, `--email` flag |
| Brand spelling | `Icflic` | same command, `--brand` flag |
| Studio timezone | `America/New_York` | `functions/_lib/config.js`, `timezone` |
| City / region (local SEO) | not set | see **Local SEO** below |
| Prices | $295 / $450 / $850 / $650 | `public/services.html`, `public/faq.html`, `public/llms.txt` |

```bash
npm run set-domain -- --domain https://icflic.com --email hello@icflic.com --brand Icflic
npm run sitemap
npm run check
```

### Local SEO

The single highest-value SEO change available is naming the city. "sports
photographer [city]" is what athletes actually search. Once you know it:

1. Add the city to the `<h1>` or first paragraph on the home page.
2. In `public/index.html`, change the `ProfessionalService` block's
   `areaServed` from the `Country` object to the real service area, and add
   an `address` with `addressLocality` and `addressRegion`.
3. Create a Google Business Profile and use the exact same name, address and
   phone as the site. Inconsistency between the two is the usual reason local
   listings do not rank.

---

## 2. Add the photos

Placeholder images live in `public/assets/img/`. Each one is labelled with the
shot it stands in for. **Replace a file with a real photo of the same name and
it swaps in with no code change.**

Priority order — the first five are what people see before they scroll:

| File | What it should be | Target size |
|---|---|---|
| `hero-01.webp` | Portrait, athlete holding the camera's gaze | 900 x 1200 |
| `hero-02.webp` | Action, sprint, low angle | 900 x 1380 |
| `hero-03.webp` | Detail, boots on grass | 900 x 1530 |
| `hero-04.webp` | Action, aerial duel | 900 x 1380 |
| `hero-05.webp` | Portrait in full kit | 900 x 1200 |
| `portrait-owner.webp` | His actual headshot | 1000 x 1250 |
| `service-*.webp` | One frame per package | 1200 x 900 |
| `work-*.webp` | Portfolio, 12 frames | 1200 x 1500 (or 1600 x 1067 for the wide ones) |
| `og-default.jpg` | Social share card | 1200 x 630 |

Export as WebP at quality 80-85. Keep every file under ~250KB. If you only
have three or four photos, use the best one for `hero-01` and duplicate across
the other hero slots rather than mixing real photos with placeholders in the
same row — a half-filled collage reads worse than a repeated frame.

Then update the `alt` text for each replaced image to describe the real photo.
`npm run check` will not catch a stale description, and search engines and
screen readers both rely on it.

---

## 3. Deploy to Cloudflare Pages

```bash
npx wrangler login
npx wrangler d1 create icflic-db          # paste the id into wrangler.toml
npm run db:init:remote                     # create the tables
npx wrangler pages project create icflic-site
npm run deploy
```

Or connect the GitHub repo in the Cloudflare dashboard and let it build on
push. Build command: none. Output directory: `public`.

### Set the secrets

In the Cloudflare dashboard, **Pages → your project → Settings → Environment
variables**, add these as **encrypted** variables for Production:

| Name | Value |
|---|---|
| `OWNER_EMAIL` | the email he signs in with |
| `OWNER_PASSWORD_HASH` | output of `npm run owner:hash -- "a long passphrase"` |
| `IP_HASH_SALT` | any long random string |

Bind the D1 database as `DB` under **Settings → Functions → D1 bindings**.

Never commit `.dev.vars`. It is already in `.gitignore`.

---

## 4. Domain, SSL and email

- Point the domain at Cloudflare (free tier is enough).
- Enable **DNSSEC** at the registrar.
- Set SSL/TLS mode to **Full (strict)** and turn on **Always Use HTTPS**.
- Add `SPF`, `DKIM` and `DMARC` records for the domain. Start DMARC at
  `p=quarantine`. Verify at [mxtoolbox.com](https://mxtoolbox.com).
- Make the contact address a real mailbox on the domain, not a personal Gmail.

---

## 5. Verify

| Check | Expect |
|---|---|
| `npm run check` | Passes |
| `npm audit` | 0 vulnerabilities |
| [securityheaders.com](https://securityheaders.com) | A or A+ |
| [ssllabs.com/ssltest](https://www.ssllabs.com/ssltest/) | A or A+ |
| [pagespeed.web.dev](https://pagespeed.web.dev) | 90+ mobile and desktop |
| [validator.schema.org](https://validator.schema.org) | No errors on any page |
| [search.google.com/test/rich-results](https://search.google.com/test/rich-results) | FAQ and Service recognised |

Then walk the site by hand:

- Submit a real booking request. Confirm it appears in `/owner`.
- Sign in at `/owner`, toggle bookings off, reload `/book` — the calendar
  should be replaced by the paused message. Toggle it back on.
- Block out a date, reload `/book`, confirm it disappeared.
- Submit the contact form. Confirm it appears under Messages.
- Open the site on a phone. Check the hero, the calendar and the menu.

---

## 6. Register with search engines

1. [Google Search Console](https://search.google.com/search-console) — add the
   domain, verify by DNS, submit `https://yourdomain.com/sitemap.xml`.
2. [Bing Webmaster Tools](https://www.bing.com/webmasters) — import from
   Search Console in one click. Bing feeds ChatGPT search results.
3. Create a Google Business Profile once the city is decided.

---

## 7. Monitoring

- [UptimeRobot](https://uptimerobot.com) — free, ping the home page every
  5 minutes.
- Watch the Cloudflare Pages **Functions** logs for the first week. Errors
  from the booking endpoint show up there.

---

## Ongoing, monthly

- `npm audit`
- Re-check securityheaders.com and ssllabs.com
- Review booking requests and messages for spam patterns
- Rotate `IP_HASH_SALT` if it has been more than 90 days (this only resets
  abuse counters; nothing user-facing breaks)
