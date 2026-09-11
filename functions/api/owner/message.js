// POST /api/owner/message — mark a contact message handled, or delete it.

import { ok, fail, readJson } from '../../_lib/http.js';
import { requireOwner } from '../../_lib/auth.js';

export async function onRequestPost(context) {
  const guard = await requireOwner(context);
  if (guard.response) return guard.response;

  const body = await readJson(context.request);
  if (!body) return fail('Malformed request.', 400);

  const id = typeof body.id === 'string' ? body.id : '';
  if (id.length < 8 || id.length > 64) return fail('Invalid message id.', 400);

  try {
    if (body.action === 'delete') {
      await context.env.DB.prepare('DELETE FROM messages WHERE id = ?').bind(id).run();
      return ok({ id, deleted: true });
    }

    if (body.action === 'handled') {
      const handled = body.handled ? 1 : 0;
      const result = await context.env.DB
        .prepare('UPDATE messages SET handled = ? WHERE id = ?')
        .bind(handled, id)
        .run();
      if (!result.meta?.changes) return fail('That message no longer exists.', 404);
      return ok({ id, handled: !!handled });
    }

    return fail('Unknown action.', 400);
  } catch (error) {
    console.error('message update failed', error);
    return fail('Could not update the message.', 500);
  }
}
