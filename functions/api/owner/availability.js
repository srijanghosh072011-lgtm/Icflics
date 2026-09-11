// POST /api/owner/availability — replace the weekly availability rules.
//
// Sent as a complete set rather than individual edits: the panel always knows
// the whole week, so a full replace avoids any partial-update states.

import { ok, fail, readJson } from '../../_lib/http.js';
import { requireOwner } from '../../_lib/auth.js';

const MAX_RULES = 40;

export async function onRequestPost(context) {
  const guard = await requireOwner(context);
  if (guard.response) return guard.response;

  const body = await readJson(context.request);
  if (!body || !Array.isArray(body.rules)) {
    return fail('Provide a "rules" array.', 400);
  }
  if (body.rules.length > MAX_RULES) {
    return fail(`At most ${MAX_RULES} rules.`, 400);
  }

  const rules = [];
  for (const raw of body.rules) {
    const weekday = Number(raw.weekday);
    const startMin = Number(raw.start_min);
    const endMin = Number(raw.end_min);

    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      return fail('Weekday must be 0 (Sunday) through 6 (Saturday).', 400);
    }
    if (!Number.isInteger(startMin) || startMin < 0 || startMin > 1439) {
      return fail('Start time is out of range.', 400);
    }
    if (!Number.isInteger(endMin) || endMin < 1 || endMin > 1440) {
      return fail('End time is out of range.', 400);
    }
    if (endMin <= startMin) {
      return fail('Each window must end after it starts.', 400);
    }
    rules.push([weekday, startMin, endMin, raw.active === false ? 0 : 1]);
  }

  try {
    const statements = [context.env.DB.prepare('DELETE FROM availability_rules')];
    for (const [weekday, startMin, endMin, active] of rules) {
      statements.push(context.env.DB
        .prepare('INSERT INTO availability_rules (weekday, start_min, end_min, active) VALUES (?, ?, ?, ?)')
        .bind(weekday, startMin, endMin, active));
    }
    await context.env.DB.batch(statements);
    return ok({ count: rules.length });
  } catch (error) {
    console.error('availability rules update failed', error);
    return fail('Could not save the schedule.', 500);
  }
}
