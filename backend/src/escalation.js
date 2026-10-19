import { config } from './config.js';
import { analyzeFeedback } from './agent/gemini.js';
import { getNotifier } from './notifier/index.js';

const iso = (date) => date.toISOString().replace('T', ' ').slice(0, 19);
const minutesFromNow = (m) => iso(new Date(Date.now() + m * 60_000));

export function createEscalation(db) {
  const logEvent = (actionId, kind, detail) =>
    db.prepare('INSERT INTO events (action_id, kind, detail) VALUES (?, ?, ?)').run(actionId, kind, detail ?? null);

  function loadContext(actionId) {
    const action = db.prepare('SELECT * FROM actions WHERE id = ?').get(actionId);
    if (!action) return null;
    const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(action.team_id);
    const person = (id) => db.prepare('SELECT * FROM people WHERE id = ?').get(id);
    return {
      action,
      team,
      assignee: person(action.assignee_id),
      lead: team.lead_id ? person(team.lead_id) : null,
      manager: team.manager_id ? person(team.manager_id) : null,
    };
  }

  async function notify(ctx, recipients, subject, text, kind) {
    const notifier = getNotifier();
    for (const to of recipients.filter(Boolean)) {
      try {
        await notifier.send({
          channel: ctx.team.channel,
          to,
          subject,
          text,
          rememberSlackId: (id) => db.prepare('UPDATE people SET slack_id = ? WHERE id = ?').run(id, to.id),
        });
        logEvent(ctx.action.id, `sent:${kind}`, `${ctx.team.channel} -> ${to.name}`);
      } catch (err) {
        logEvent(ctx.action.id, `send_failed:${kind}`, `${to.name}: ${err.message}`);
      }
    }
  }

  function cancelPending(actionId) {
    db.prepare("UPDATE jobs SET state = 'cancelled' WHERE action_id = ? AND state = 'pending'").run(actionId);
  }

  function schedule(actionId) {
    const insert = db.prepare('INSERT INTO jobs (action_id, type, run_at) VALUES (?, ?, ?)');
    insert.run(actionId, 'remind', minutesFromNow(config.remindAfterMinutes));
    insert.run(actionId, 'escalate', minutesFromNow(config.escalateAfterMinutes));
  }

  // Reviewer rejected the action or asked for improvement.
  async function review(actionId, decision, feedback) {
    const before = loadContext(actionId);
    if (!before) return null;
    const analysis = await analyzeFeedback(before.action, decision, feedback);

    cancelPending(actionId);
    db.prepare(
      `UPDATE actions SET review = ?, feedback = ?, ai_summary = ?, ai_source = ?, priority = ?,
       status = 'open', updated_at = datetime('now') WHERE id = ?`,
    ).run(decision, feedback, analysis.summary, analysis.source, analysis.priority, actionId);
    logEvent(actionId, `review:${decision}`, feedback);
    schedule(actionId);

    const ctx = loadContext(actionId);
    await notify(
      ctx,
      [ctx.assignee, ctx.lead],
      `Action ${decision}: ${ctx.action.title}`,
      `"${ctx.action.title}" was marked ${decision}. ${analysis.summary} (priority: ${analysis.priority}). Please fix it and mark it Done.`,
      'initial',
    );
    return ctx.action;
  }

  function setStatus(actionId, status) {
    const result = db
      .prepare("UPDATE actions SET status = ?, updated_at = datetime('now') WHERE id = ?")
      .run(status, actionId);
    if (!result.changes) return null;
    logEvent(actionId, `status:${status}`);
    if (status === 'done') {
      cancelPending(actionId);
      logEvent(actionId, 'timers_cancelled');
    }
    return db.prepare('SELECT * FROM actions WHERE id = ?').get(actionId);
  }

  async function runJob(job) {
    const ctx = loadContext(job.action_id);
    // Always re-check the live status so a finished action never gets a reminder.
    if (!ctx || ctx.action.status === 'done') {
      db.prepare("UPDATE jobs SET state = 'cancelled' WHERE id = ?").run(job.id);
      return;
    }
    const { action } = ctx;
    if (job.type === 'remind') {
      await notify(
        ctx,
        [ctx.assignee, ctx.lead],
        `Reminder: ${action.title}`,
        `Reminder: "${action.title}" is still ${action.status}. ${action.ai_summary || ''} Please update the status.`,
        'remind',
      );
    } else {
      await notify(
        ctx,
        [ctx.manager],
        `Escalation: ${action.title}`,
        `"${action.title}" (assignee: ${ctx.assignee.name}, priority: ${action.priority}) was not completed within ${config.escalateAfterMinutes} minutes. ${action.ai_summary || ''}`,
        'escalate',
      );
    }
    db.prepare("UPDATE jobs SET state = 'done' WHERE id = ?").run(job.id);
  }

  async function tick() {
    const due = db
      .prepare("SELECT * FROM jobs WHERE state = 'pending' AND run_at <= ? ORDER BY run_at")
      .all(iso(new Date()));
    for (const job of due) {
      try {
        await runJob(job);
      } catch (err) {
        db.prepare("UPDATE jobs SET state = 'failed', error = ? WHERE id = ?").run(err.message, job.id);
      }
    }
    return due.length;
  }

  return { review, setStatus, tick, loadContext };
}
