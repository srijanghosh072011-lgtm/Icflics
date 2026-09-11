// GET /api/owner/session — is the current visitor signed in?
// POST /api/owner/session/logout is handled by ../logout.js

import { ok, fail } from '../../_lib/http.js';
import { getSession } from '../../_lib/session.js';
import { randomToken, sha256Hex } from '../../_lib/crypto.js';
import { nowSeconds } from '../../_lib/http.js';

export async function onRequestGet({ request, env }) {
  const session = await getSession(env.DB, request);
  if (!session) return fail('Not signed in.', 401);

  // The CSRF token is only ever held in the client's memory, so a page reload
  // needs a fresh one. Rotating it here also limits how long any single token
  // is useful.
  const csrf = randomToken(32);
  await env.DB
    .prepare('UPDATE sessions SET csrf_hash = ? WHERE token_hash = ?')
    .bind(await sha256Hex(csrf), session.token_hash)
    .run();

  return ok({ csrf, expiresIn: session.expires_at - nowSeconds() });
}
