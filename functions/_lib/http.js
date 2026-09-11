// Shared HTTP helpers: JSON responses, request parsing and origin checks.

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  // API responses are per-request and must never be cached by a shared proxy.
  'cache-control': 'no-store, no-cache, must-revalidate',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

export function ok(data = {}, extraHeaders = {}) {
  return json({ ok: true, ...data }, 200, extraHeaders);
}

export function fail(error, status = 400, extra = {}) {
  return json({ ok: false, error, ...extra }, status);
}

export function methodNotAllowed(allowed) {
  return json({ ok: false, error: 'Method not allowed.' }, 405,
    { allow: allowed.join(', ') });
}

/** Parse a JSON body, capped so a huge payload cannot exhaust memory. */
export async function readJson(request, maxBytes = 32 * 1024) {
  const type = request.headers.get('content-type') || '';
  if (!type.includes('application/json')) return null;

  const declared = parseInt(request.headers.get('content-length') || '0', 10);
  if (Number.isFinite(declared) && declared > maxBytes) return null;

  const text = await request.text();
  if (text.length > maxBytes) return null;

  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Reject cross-site state-changing requests.
 * Belt and braces alongside SameSite=Strict cookies: a same-origin post that
 * omits Origin still passes via Referer, and anything from another origin is
 * refused outright.
 */
export function isSameOrigin(request) {
  const self = new URL(request.url).origin;
  const origin = request.headers.get('origin');
  if (origin) return origin === self;

  const referer = request.headers.get('referer');
  if (referer) {
    try {
      return new URL(referer).origin === self;
    } catch {
      return false;
    }
  }
  // No Origin and no Referer: not a browser request we can vouch for.
  return false;
}

/** Best-effort client IP, as provided by Cloudflare's edge. */
export function clientIp(request) {
  const forwarded = request.headers.get('x-forwarded-for');
  return request.headers.get('cf-connecting-ip')
    || (forwarded ? forwarded.split(',')[0].trim() : '')
    || 'unknown';
}

export function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}
