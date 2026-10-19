import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.VIASOCKET_ORG_ID = '4160';
process.env.VIASOCKET_PROJECT_ID = 'projTest';
process.env.VIASOCKET_EMBED_SECRET = 'embed-secret';

const { viasocketNotifier } = await import('./viasocket.js');

// Fake viaSocket: records every call and answers like the documented API.
function fakeViaSocket({ connected = ['slack', 'gmail'], slackLookup = { id: 'U0ABCDEFG' } } = {}) {
  const calls = [];
  const ids = { slack: 'rowbu58rc', gmail: 'rowo0bqrhj5g' };
  globalThis.fetch = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    calls.push({ url: String(url), body, auth: opts.headers?.authorization });
    const json = (data) => ({ ok: true, status: 200, json: async () => data });
    if (url.endsWith('/embed/authentications')) {
      return json({ success: true, data: connected.map((n) => ({ id: `authX_${ids[n]}` })) });
    }
    if (url.includes('/integrations')) return json({ success: true, data: { flows: [{ id: 'scrSLACK', service_id: ids.slack, status: 'active' }, { id: 'scrGMAIL', service_id: ids.gmail, status: 'active' }] } });
    if (url.includes('/func/')) {
      return json(body.action_version_id === 'rowrubgppa5r' ? slackLookup : { ok: true });
    }
    throw new Error(`unexpected ${url}`);
  };
  return calls;
}

const person = { id: 1, name: 'Asha Rao', email: 'asha@viasocket.com', slack_id: null };

test('slack: finds the member id by email, remembers it, then sends the DM', async () => {
  const calls = fakeViaSocket();
  let saved;
  await viasocketNotifier.send({ channel: 'slack', to: person, subject: 'Subj', text: 'Body', rememberSlackId: (id) => (saved = id) });
  assert.equal(saved, 'U0ABCDEFG');
  const runs = calls.filter((c) => c.url.includes('/func/scrSLACK'));
  assert.deepEqual(runs[0].body.inputData, { search_by: 'email_search', email: 'asha@viasocket.com', response_fields: ['id'] });
  assert.equal(runs[1].body.action_version_id, 'rowa5mg9fywy');
  assert.equal(runs[1].body.inputData.userId, 'U0ABCDEFG');
  assert.match(runs[1].body.inputData.content, /Subj/);
  assert.ok(calls.find((c) => c.auth), 'embed token sent to the API');
});

test('slack: a saved member id skips the lookup', async () => {
  const calls = fakeViaSocket();
  await viasocketNotifier.send({ channel: 'slack', to: { ...person, slack_id: 'U0SAVEDID' }, subject: 's', text: 't' });
  const runs = calls.filter((c) => c.url.includes('/func/'));
  assert.equal(runs.length, 1);
  assert.equal(runs[0].body.inputData.userId, 'U0SAVEDID');
});

test('slack: unknown email gives a clear error', async () => {
  fakeViaSocket({ slackLookup: { message: 'User not found' } });
  await assert.rejects(viasocketNotifier.send({ channel: 'slack', to: person, subject: 's', text: 't' }), /No Slack user found for asha@viasocket.com/);
});

test('email: sends through Gmail with the text escaped', async () => {
  const calls = fakeViaSocket();
  await viasocketNotifier.send({ channel: 'email', to: person, subject: 'Subj', text: '<b>x</b>' });
  const run = calls.find((c) => c.url.includes('/func/scrGMAIL'));
  assert.equal(run.body.action_version_id, 'rowwj0sfmhub');
  assert.equal(run.body.inputData.to, 'asha@viasocket.com');
  assert.match(run.body.inputData.messageBody, /&lt;b&gt;x&lt;\/b&gt;/);
});

test('not connected: says which app to connect', async () => {
  fakeViaSocket({ connected: [] });
  await assert.rejects(viasocketNotifier.send({ channel: 'email', to: person, subject: 's', text: 't' }), /Gmail is not connected/);
});

test('slack: with a done link the DM carries a Mark as done button', async () => {
  const calls = fakeViaSocket();
  await viasocketNotifier.send({ channel: 'slack', to: { ...person, slack_id: 'U0SAVEDID' }, subject: 'Subj', text: 'Body', doneUrl: 'https://app.test/done/tok' });
  const run = calls.find((c) => c.url.includes('/func/') && c.body.action_version_id === 'rowj2u3wc8h5');
  assert.deepEqual(run.body.inputData.destination, { messageto: 'user', userId: ['U0SAVEDID'] });
  assert.deepEqual(run.body.inputData.buttons, { '✅ Mark as done': 'https://app.test/done/tok' });
  assert.match(run.body.inputData.markdown_content, /Subj/);
});

test('slack: if the button message is refused, a plain DM with the link is sent', async () => {
  const calls = fakeViaSocket();
  const inner = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    if (url.includes('/func/') && body?.action_version_id === 'rowj2u3wc8h5') return { ok: true, status: 200, json: async () => ({ success: false, message: 'nope' }) };
    return inner(url, opts);
  };
  await viasocketNotifier.send({ channel: 'slack', to: { ...person, slack_id: 'U0SAVEDID' }, subject: 'S', text: 'T', doneUrl: 'https://app.test/done/tok' });
  const dm = calls.find((c) => c.body?.action_version_id === 'rowa5mg9fywy');
  assert.match(dm.body.inputData.content, /Mark as done: https:\/\/app.test\/done\/tok/);
});

test('email: the done link is added as a link', async () => {
  const calls = fakeViaSocket();
  await viasocketNotifier.send({ channel: 'email', to: person, subject: 'S', text: 'T', doneUrl: 'https://app.test/done/tok?a=1&b=2' });
  const run = calls.find((c) => c.url.includes('/func/scrGMAIL'));
  assert.match(run.body.inputData.messageBody, /<a href="https:\/\/app.test\/done\/tok\?a=1&amp;b=2">Mark as done<\/a>/);
});
