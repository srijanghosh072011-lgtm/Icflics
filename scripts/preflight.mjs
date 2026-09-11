#!/usr/bin/env node
/**
 * Pre-launch and pre-deploy checks.
 *
 *   npm run check
 *
 * Automates the mechanical parts of SECURITY.md so they cannot rot: leaked
 * debug artefacts, missing alt text, broken internal links and image
 * references, unescaped JSON-LD, inline styles or scripts that would need an
 * unsafe CSP, and placeholder copy left in the shipped HTML.
 *
 * Exits non-zero when anything fails, so it can gate a deploy.
 */

import { readdir, readFile, access } from 'node:fs/promises';
import { join, relative, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC_DIR = join(ROOT, 'public');

const failures = [];
const warnings = [];

const fail = (file, message) => failures.push(`${file}: ${message}`);
const warn = (file, message) => warnings.push(`${file}: ${message}`);

async function* walk(dir, exts) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full, exts);
    else if (exts.some((ext) => entry.name.endsWith(ext))) yield full;
  }
}

const exists = (path) => access(path).then(() => true, () => false);

/* -------------------------------------------------------------------------
   1. Debug artefacts and internal notes in shipped files
   ------------------------------------------------------------------------- */

const LEAKS = [
  [/\bTODO\b/, 'contains TODO'],
  [/\bFIXME\b/, 'contains FIXME'],
  [/\bXXX\b/, 'contains XXX'],
  [/\bHACK\b/, 'contains HACK'],
  [/console\.log\s*\(/, 'contains console.log'],
  [/\bdebugger\b/, 'contains a debugger statement'],
  [/localhost:\d+/, 'references localhost'],
  [/127\.0\.0\.1/, 'references 127.0.0.1'],
  [/\bngrok\.io\b/, 'references an ngrok tunnel'],
  [/Lorem ipsum/i, 'contains Lorem ipsum'],
  [/\byour name here\b/i, 'contains placeholder copy'],
  [/\bcoming soon\b/i, 'contains "coming soon" placeholder copy'],
];

/* -------------------------------------------------------------------------
   2. Secrets that must never reach the client bundle
   ------------------------------------------------------------------------- */

const SECRETS = [
  [/OWNER_PASSWORD_HASH\s*[:=]\s*["'][^"']+/, 'appears to embed a password hash'],
  [/pbkdf2\$\d+\$/, 'contains a PBKDF2 hash'],
  [/TURNSTILE_SECRET\s*[:=]\s*["'][^"']+/, 'appears to embed the Turnstile secret'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'contains a private key'],
  [/\bsk_live_[A-Za-z0-9]{8,}/, 'contains a live secret key'],
];

async function checkPublicFiles() {
  for await (const file of walk(PUBLIC_DIR, ['.html', '.js', '.css', '.txt', '.json', '.webmanifest'])) {
    const name = relative(ROOT, file);
    const source = await readFile(file, 'utf8');

    for (const [pattern, message] of LEAKS) {
      if (pattern.test(source)) fail(name, message);
    }
    for (const [pattern, message] of SECRETS) {
      if (pattern.test(source)) fail(name, message);
    }
  }
}

/* -------------------------------------------------------------------------
   3. HTML: metadata, accessibility, CSP-compatibility, structured data
   ------------------------------------------------------------------------- */

async function checkHtml() {
  const routes = new Set(['/']);
  const files = [];

  for await (const file of walk(PUBLIC_DIR, ['.html'])) {
    files.push(file);
    let route = '/' + relative(PUBLIC_DIR, file).replace(/\\/g, '/');
    route = route.replace(/\/index\.html$/, '/').replace(/\.html$/, '');
    routes.add(route);
    if (route !== '/' && route.endsWith('/')) routes.add(route.slice(0, -1));
  }

  for (const file of files) {
    const name = relative(ROOT, file);
    const html = await readFile(file, 'utf8');
    const isOwner = name.includes('owner');
    const is404 = name.endsWith('404.html');

    // --- Required metadata ---
    if (!/<html[^>]+lang=/.test(html)) fail(name, 'missing lang on <html>');
    if (!/<meta\s+charset=/i.test(html)) fail(name, 'missing charset');
    if (!/name=["']viewport["']/.test(html)) fail(name, 'missing viewport meta');
    if (!/<title>[^<]{10,}<\/title>/.test(html)) fail(name, 'missing or too-short <title>');

    const description = /<meta\s+name=["']description["']\s+content=["']([^"']*)["']/.exec(html);
    if (!description) {
      fail(name, 'missing meta description');
    } else if (!isOwner && (description[1].length < 50 || description[1].length > 320)) {
      warn(name, `meta description is ${description[1].length} chars (aim for 50-160)`);
    }

    if (!isOwner && !is404 && !/rel=["']canonical["']/.test(html)) {
      fail(name, 'missing canonical link');
    }
    if (!isOwner && !is404 && !/property=["']og:image["']/.test(html)) {
      fail(name, 'missing og:image');
    }

    // --- Headings ---
    const h1s = html.match(/<h1[\s>]/g) || [];
    if (h1s.length === 0) fail(name, 'has no <h1>');
    if (h1s.length > 1) fail(name, `has ${h1s.length} <h1> elements (expected exactly 1)`);

    // --- Images need alt text and intrinsic size ---
    for (const tag of html.match(/<img\b[^>]*>/g) || []) {
      if (!/\balt=/.test(tag)) {
        fail(name, `<img> without alt: ${tag.slice(0, 90)}`);
      } else if (/\balt=["']\s*["']/.test(tag) && !/aria-hidden=["']true["']/.test(tag)) {
        warn(name, `<img> with empty alt and no aria-hidden: ${tag.slice(0, 90)}`);
      }
      if (!/\bwidth=/.test(tag) || !/\bheight=/.test(tag)) {
        warn(name, `<img> without width/height (causes layout shift): ${tag.slice(0, 90)}`);
      }
    }

    // --- CSP compatibility: no inline style or executable inline script ---
    if (/\sstyle=["']/.test(html)) {
      fail(name, 'has an inline style attribute, which would require unsafe-inline in the CSP');
    }
    for (const tag of html.match(/<script\b[^>]*>/g) || []) {
      const hasSrc = /\bsrc=/.test(tag);
      const isDataBlock = /type=["']application\/(ld\+json|json)["']/.test(tag);
      if (!hasSrc && !isDataBlock) {
        fail(name, `inline <script> would require unsafe-inline: ${tag.slice(0, 80)}`);
      }
    }
    if (/\son(click|load|error|mouseover|submit|change|focus|blur)\s*=/i.test(html)) {
      fail(name, 'has an inline event handler attribute, which the CSP blocks');
    }

    // --- External links must not leak the opener ---
    for (const tag of html.match(/<a\b[^>]*target=["']_blank["'][^>]*>/g) || []) {
      if (!/rel=["'][^"']*noopener/.test(tag)) {
        fail(name, `target="_blank" without rel="noopener": ${tag.slice(0, 90)}`);
      }
    }

    // --- Structured data must be real JSON with no HTML entities ---
    for (const block of html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || []) {
      const body = block.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
      try {
        JSON.parse(body);
      } catch (error) {
        fail(name, `invalid JSON-LD: ${error.message}`);
        continue;
      }
      if (/&(amp|lt|gt|quot|#\d+);/.test(body)) {
        fail(name, 'JSON-LD contains HTML entities; they are not decoded inside a data block');
      }
    }

    // --- Internal links and asset references must resolve ---
    const refs = [
      ...(html.match(/(?:href|src)=["'](\/[^"'#?]*)["']/g) || []),
    ].map((m) => /["'](\/[^"']*)["']/.exec(m)[1]);

    for (const ref of new Set(refs)) {
      if (ref.startsWith('/api/')) continue;
      if (/\.(webp|jpg|jpeg|png|svg|woff2|css|js|xml|txt|webmanifest|ico)$/.test(ref)) {
        if (!await exists(join(PUBLIC_DIR, ref))) fail(name, `missing asset: ${ref}`);
      } else if (!routes.has(ref)) {
        fail(name, `internal link has no matching page: ${ref}`);
      }
    }
  }
}

/* -------------------------------------------------------------------------
   4. Required files
   ------------------------------------------------------------------------- */

async function checkRequiredFiles() {
  const required = [
    'public/robots.txt',
    'public/sitemap.xml',
    'public/_headers',
    'public/favicon.svg',
    'public/site.webmanifest',
    'public/404.html',
    '.gitignore',
    'schema.sql',
    'SECURITY.md',
  ];

  for (const path of required) {
    if (!await exists(join(ROOT, path))) fail(path, 'is missing');
  }

  const gitignore = await readFile(join(ROOT, '.gitignore'), 'utf8').catch(() => '');
  for (const entry of ['.env', '.dev.vars', 'node_modules']) {
    if (!gitignore.includes(entry)) fail('.gitignore', `does not exclude ${entry}`);
  }

  const headers = await readFile(join(PUBLIC_DIR, '_headers'), 'utf8').catch(() => '');
  for (const header of [
    'Content-Security-Policy',
    'Strict-Transport-Security',
    'X-Content-Type-Options',
    'X-Frame-Options',
    'Referrer-Policy',
    'Permissions-Policy',
  ]) {
    if (!headers.includes(header)) fail('public/_headers', `is missing ${header}`);
  }
  if (/unsafe-inline|unsafe-eval/.test(headers)) {
    fail('public/_headers', 'CSP contains unsafe-inline or unsafe-eval');
  }
}

/* -------------------------------------------------------------------------
   5. Sitemap agrees with what is actually on disk
   ------------------------------------------------------------------------- */

async function checkSitemap() {
  const xml = await readFile(join(PUBLIC_DIR, 'sitemap.xml'), 'utf8').catch(() => '');
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

  if (!locs.length) {
    fail('public/sitemap.xml', 'lists no URLs');
    return;
  }

  for (const loc of locs) {
    const route = new URL(loc).pathname;
    const candidates = route === '/'
      ? ['index.html']
      : [`${route.slice(1)}.html`, `${route.slice(1)}/index.html`];
    const found = await Promise.all(candidates.map((c) => exists(join(PUBLIC_DIR, c))));
    if (!found.some(Boolean)) fail('public/sitemap.xml', `lists ${route}, which has no page`);
    if (route.startsWith('/owner')) fail('public/sitemap.xml', 'lists the private owner panel');
  }
}

/* -------------------------------------------------------------------------
   Run
   ------------------------------------------------------------------------- */

await checkPublicFiles();
await checkHtml();
await checkRequiredFiles();
await checkSitemap();

if (warnings.length) {
  console.log(`\nWarnings (${warnings.length}):`);
  for (const line of warnings) console.log(`  - ${line}`);
}

if (failures.length) {
  console.log(`\nFailures (${failures.length}):`);
  for (const line of failures) console.log(`  x ${line}`);
  console.log('\nPreflight FAILED.\n');
  process.exit(1);
}

console.log(`\nPreflight passed${warnings.length ? ` with ${warnings.length} warning(s)` : ''}.\n`);
