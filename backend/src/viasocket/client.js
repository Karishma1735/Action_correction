import jwt from 'jsonwebtoken';
import { config } from '../config.js';

// The app has no per-person viaSocket accounts: the whole workspace is one viaSocket user, so the
// Slack and Gmail connected on the Integrations page are the ones that send reminders.
// Never change this id: connections are isolated by it.
export const EMBED_USER = 'action-correction-workspace';

// service_id of each app, exactly as the viaSocket catalog returns it.
export const SERVICES = { slack: 'rowbu58rc', gmail: 'rowo0bqrhj5g', table: 'rowe71n93' };
const DISPLAY = { slack: 'Slack', gmail: 'Gmail', table: 'viaSocket Table' };

export function embedToken(uniqueIdentifier = EMBED_USER) {
  const { orgId, projectId, embedSecret } = config.viasocket;
  if (!orgId || !projectId || !embedSecret) {
    throw new Error('viaSocket is not configured: set VIASOCKET_ORG_ID, VIASOCKET_PROJECT_ID and VIASOCKET_EMBED_SECRET');
  }
  return jwt.sign({ org_id: orgId, project_id: projectId, unique_identifier: uniqueIdentifier }, embedSecret, { algorithm: 'HS256' });
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${config.viasocket.apiUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: embedToken() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload.success === false) throw new Error(payload.message || `viaSocket ${path} failed (${res.status})`);
  return payload.data;
}

// Every app the workspace has connected. An entry's id ends in _<service_id>; the id is the auth_id.
export async function listConnections() {
  const data = await api('/embed/authentications');
  return Array.isArray(data) ? data : data?.data ?? [];
}

export async function findAuthId(serviceId) {
  const entry = (await listConnections()).find((c) => String(c.id).endsWith(`_${serviceId}`));
  return entry && !entry.isExpired ? entry.id : null;
}

// The runner of an app for this workspace. Looked up first, enabled only if missing (never twice).
// A script_id is a credential: it stays on the server.
export async function getScriptId(serviceId, authId) {
  const projectId = config.viasocket.projectId;
  const flows = (await api(`/projects/${projectId}/integrations`))?.flows ?? [];
  const existing = flows.find((f) => f.service_id === serviceId && f.status === 'active');
  if (existing) return existing.id;
  return (await api(`/embed/enable/${serviceId}/${authId}`, { method: 'POST' })).script_id;
}

// Runs one action of a connected app. The run URL takes no token: the script_id is the credential.
export async function runAction(serviceName, actionVersionId, inputData) {
  const serviceId = SERVICES[serviceName];
  const authId = await findAuthId(serviceId);
  if (!authId) {
    throw new Error(`${DISPLAY[serviceName]} is not connected (or its sign-in expired): connect it on the Integrations page`);
  }
  const scriptId = await getScriptId(serviceId, authId);
  const res = await fetch(`${config.viasocket.runUrl}/func/${scriptId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action_version_id: actionVersionId, inputData }),
  });
  const payload = await res.json().catch(() => ({}));
  // The envelope is { success, data } only when `data` is present; otherwise the body is the action's own.
  const envelope = payload && typeof payload.success === 'boolean' && 'data' in payload;
  if (envelope ? !payload.success : payload?.success === false) {
    throw new Error(payload.message || payload.error?.message || 'viaSocket action failed');
  }
  return envelope ? payload.data : payload;
}

// Asks viaSocket's built-in AI (no model key of our own). `schema` makes the answer a JSON object.
export async function askAi({ threadId, prompt, message, schema, service, model, timeoutMs = 30_000 }) {
  const res = await fetch(`${config.viasocket.apiUrl}/embed/ai/message`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: embedToken() },
    body: JSON.stringify({
      thread_id: threadId,
      message,
      prompt,
      service,
      model,
      response_type: 'json_schema',
      json_schema: { name: schema.name, strict: true, schema: schema.schema },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload.success === false) throw new Error(payload.message || `viaSocket AI failed (${res.status})`);
  return payload.data.content;
}

// The values one field accepts, as [{ label, value }]. existingFields is nested like inputData.
export async function listOptions(serviceName, actionVersionId, fieldKey, existingFields = {}) {
  const authId = await findAuthId(SERVICES[serviceName]);
  if (!authId) throw new Error(`${DISPLAY[serviceName]} is not connected (or its sign-in expired): connect it on the Integrations page`);
  const data = await api(`/embed/list-options/${actionVersionId}`, { method: 'POST', body: { fieldKey, auth_id: authId, existingFields } });
  // An unreadable connection answers 200 with the failure nested in data.response.
  if (data && !Array.isArray(data) && data.response && Number(data.response.status) >= 400) {
    throw new Error(data.response.data?.message || 'list-options failed');
  }
  return Array.isArray(data) ? data : data?.data ?? [];
}
