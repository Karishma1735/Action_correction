async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'content-type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  people: () => request('/people'),
  addPerson: (body) => request('/people', { method: 'POST', body }),
  teams: () => request('/teams'),
  addTeam: (body) => request('/teams', { method: 'POST', body }),
  actions: () => request('/actions'),
  action: (id) => request(`/actions/${id}`),
  addAction: (body) => request('/actions', { method: 'POST', body }),
  review: (id, body) => request(`/actions/${id}/review`, { method: 'POST', body }),
  setStatus: (id, status) => request(`/actions/${id}/status`, { method: 'POST', body: { status } }),
  integrations: () => request('/integrations/status'),
  viasocketToken: () => request('/viasocket/token'),
};
