// Guard for every owner-only endpoint.
//
// Usage:
//   const guard = await requireOwner(context);
//   if (guard.response) return guard.response;
//   // ... guard.session is the authenticated session

import { fail, isSameOrigin } from './http.js';
import { getSession, checkCsrf } from './session.js';

/**
 * @param {{request: Request, env: object}} context
 * @param {{csrf?: boolean}} options  csrf defaults to true for non-GET methods
 */
export async function requireOwner({ request, env }, options = {}) {
  const needsCsrf = options.csrf ?? request.method !== 'GET';

  if (needsCsrf && !isSameOrigin(request)) {
    return { response: fail('Request rejected.', 403) };
  }

  const session = await getSession(env.DB, request);
  if (!session) {
    return { response: fail('Not signed in.', 401) };
  }

  if (needsCsrf && !await checkCsrf(session, request)) {
    return { response: fail('Session expired. Please sign in again.', 403) };
  }

  return { session };
}
