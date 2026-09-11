# Security notes

Companion to `SECURITY.md`. That file is the checklist; this one records the
decisions behind the code, including the one place this project deliberately
departs from the checklist and why.

---

## The one deliberate deviation: PBKDF2 instead of bcrypt or argon2

`SECURITY.md` says *"Passwords hashed with bcrypt or argon2 (never MD5/SHA1,
never plaintext)."* This project uses **PBKDF2-HMAC-SHA256 at 210,000
iterations**, with a 16-byte random salt and a constant-time comparison.

**Why.** Cloudflare Workers, the runtime behind Pages Functions, exposes
WebCrypto natively and has no native bcrypt or argon2. Getting either would
mean shipping a pure-JavaScript or WASM implementation as a dependency —
adding a supply-chain surface and a package to audit forever, for a single
password, and running far slower than the native primitive inside the
platform's CPU-time budget.

**Why this is acceptable here.** PBKDF2-HMAC-SHA256 at 210,000 iterations is
the current OWASP Password Storage Cheat Sheet recommendation for PBKDF2. It
is an approved KDF, not a bare hash — the thing the checklist is actually
warning against is MD5, SHA1 and plaintext, all of which are unsalted or
unstretched. The realistic risk is also unusually small here:

- There is **one** account and **no sign-up**, so there is no user database to
  breach.
- The password hash is stored in **Cloudflare Secrets**, not in D1. A database
  compromise exposes no password material at all.
- Sign-in is rate-limited per IP (8 attempts / 15 min) *and* per account
  (5 consecutive failures triggers a 15-minute lockout), so online guessing is
  not viable regardless of the KDF.

**If you would rather not deviate.** Swap `derive()` in
`functions/_lib/crypto.js` for a WASM argon2id build, bump the stored hash
prefix from `pbkdf2$` to `argon2$`, and re-run `npm run owner:hash`. The
verify path already parses the algorithm from the stored string, so both
formats can coexist during a migration.

---

## What protects what

| Threat | Control | Where |
|---|---|---|
| Password guessing | Per-IP + per-account rate limit with lockout | `functions/api/owner/login.js` |
| Credential theft from a DB leak | Password hash lives in Secrets, never in D1 | `login.js`, `.env.example` |
| Session hijacking | Only the SHA-256 of the token is stored; the raw token exists solely in the cookie | `functions/_lib/session.js` |
| Session fixation | A fresh token is minted on every sign-in; the CSRF token rotates on every session check | `session.js`, `api/owner/session.js` |
| CSRF | `__Host-` cookie with `SameSite=Strict`, plus an `X-CSRF-Token` header checked in constant time, plus an Origin/Referer check | `_lib/auth.js`, `_lib/http.js` |
| XSS | Strict CSP with no `unsafe-inline`; all client rendering uses `textContent`; preflight fails the build on any inline script, style or event handler | `public/_headers`, `assets/js/*.js`, `scripts/preflight.mjs` |
| SQL injection | Every query is a prepared statement with bound parameters. There is no string concatenation into SQL anywhere | all of `functions/` |
| Clickjacking | `X-Frame-Options: DENY` + `frame-ancestors 'none'` | `public/_headers` |
| Form spam | Honeypot + time-trap + per-IP rate limit + heuristics, with Turnstile available behind one env var | `_lib/validate.js`, `_lib/turnstile.js` |
| Booking race / forged slot | The server recomputes availability at submit time and rejects anything not genuinely open | `_lib/availability.js` |
| Enumeration | Sign-in returns one message for both a wrong email and a wrong password, and runs both comparisons either way | `login.js` |
| IP exposure | IPs are salted and SHA-256 hashed before storage; the raw address is never written | `_lib/crypto.js` |
| Unbounded growth | Expired sessions and rate-limit rows are swept on authenticated requests | `api/owner/state.js` |

---

## Things deliberately *not* done

- **No third-party scripts.** No analytics, no font CDN, no tag manager. That
  is what lets the CSP be `default-src 'self'` with nothing else, and why the
  site needs no cookie banner.
- **No password reset flow.** A reset endpoint is an attack surface, and there
  is one account. To change the password, run `npm run owner:hash` and update
  the Cloudflare secret.
- **No payment handling.** The site never sees card data. Deposits are taken
  out of band.
- **No raw IP storage.** Abuse tracking works on hashes only.
- **No `localStorage` for the CSRF token.** It lives in a closure variable in
  `owner.js`, so it is gone on reload and unreachable from other scripts.

---

## Reviewing this yourself

```bash
npm run check          # leaked artefacts, CSP violations, broken links, JSON-LD
npm audit              # dependency CVEs (wrangler is the only dependency)
```

Then, after deploying:

- <https://securityheaders.com> — expect A or A+
- <https://www.ssllabs.com/ssltest/> — expect A or A+
- <https://validator.schema.org> — check each page's structured data
- <https://pagespeed.web.dev> — Lighthouse, mobile and desktop
