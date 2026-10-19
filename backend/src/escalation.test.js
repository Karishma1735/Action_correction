import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from './db.js';
import { createEscalation } from './escalation.js';

function setup() {
  const db = openDb(':memory:');
  const person = (name) => db.prepare('INSERT INTO people (name) VALUES (?)').run(name).lastInsertRowid;
  const [assignee, lead, manager] = ['Asha', 'Lee', 'Boss'].map(person);
  const team = db
    .prepare('INSERT INTO teams (name, lead_id, manager_id) VALUES (?, ?, ?)')
    .run('Ops', lead, manager).lastInsertRowid;
  const action = db
    .prepare('INSERT INTO actions (title, team_id, assignee_id) VALUES (?, ?, ?)')
    .run('Fix invoice', team, assignee).lastInsertRowid;
  return { db, escalation: createEscalation(db), action };
}

const makeDue = (db, type) =>
  db.prepare("UPDATE jobs SET run_at = '2000-01-01 00:00:00' WHERE type = ? AND state = 'pending'").run(type);
const kinds = (db, id) => db.prepare('SELECT kind FROM events WHERE action_id = ?').all(id).map((e) => e.kind);

test('rejection notifies assignee and lead and schedules reminder + escalation', async () => {
  const { db, escalation, action } = setup();
  await escalation.review(action, 'rejected', 'Missing tax field');
  assert.equal(kinds(db, action).filter((k) => k === 'sent:initial').length, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE state = 'pending'").get().n, 2);
});

test('reminder goes to assignee and lead; escalation goes to the manager', async () => {
  const { db, escalation, action } = setup();
  await escalation.review(action, 'improve', 'Needs more detail');
  makeDue(db, 'remind');
  await escalation.tick();
  assert.equal(kinds(db, action).filter((k) => k === 'sent:remind').length, 2);
  makeDue(db, 'escalate');
  await escalation.tick();
  assert.equal(kinds(db, action).filter((k) => k === 'sent:escalate').length, 1);
});

test('marking done cancels pending timers so nothing is sent', async () => {
  const { db, escalation, action } = setup();
  await escalation.review(action, 'rejected', 'Wrong figures');
  escalation.setStatus(action, 'done');
  makeDue(db, 'remind');
  makeDue(db, 'escalate');
  await escalation.tick();
  assert.equal(kinds(db, action).filter((k) => k === 'sent:remind' || k === 'sent:escalate').length, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE state = 'cancelled'").get().n, 2);
});

test('a second review replaces the old timers', async () => {
  const { db, escalation, action } = setup();
  await escalation.review(action, 'rejected', 'First');
  await escalation.review(action, 'improve', 'Second');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE state = 'pending'").get().n, 2);
});
