// POST /api/owner/logout — end the session and clear the cookie.

import { ok, fail, isSameOrigin } from '../../_lib/http.js';
import { destroySession } from '../../_lib/session.js';

export async function onRequestPost({ request, env }) {
  if (!isSameOrigin(request)) return fail('Request rejected.', 403);

  // Deliberately not CSRF-guarded: a forced logout is a nuisance, not a
  // vulnerability, and failing to log out would be the worse outcome.
  const cookie = await destroySession(env.DB, request);
  return ok({}, { 'set-cookie': cookie });
}
