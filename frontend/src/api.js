async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'content-type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('ac-signed-out'));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  me: () => request('/auth/me'),
  login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password } }),
  signup: (email, password) => request('/auth/signup', { method: 'POST', body: { email, password } }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  people: () => request('/people'),
  addPerson: (body) => request('/people', { method: 'POST', body }),
  updatePerson: (id, body) => request(`/people/${id}`, { method: 'PUT', body }),
  deletePerson: (id) => request(`/people/${id}`, { method: 'DELETE' }),
  teams: () => request('/teams'),
  updateTeam: (id, body) => request(`/teams/${id}`, { method: 'PUT', body }),
  deleteTeam: (id) => request(`/teams/${id}`, { method: 'DELETE' }),
  addTeam: (body) => request('/teams', { method: 'POST', body }),
  actions: () => request('/actions'),
  action: (id) => request(`/actions/${id}`),
  addAction: (body) => request('/actions', { method: 'POST', body }),
  updateAction: (id, body) => request(`/actions/${id}`, { method: 'PUT', body }),
  deleteAction: (id) => request(`/actions/${id}`, { method: 'DELETE' }),
  review: (id, body) => request(`/actions/${id}/review`, { method: 'POST', body }),
  setStatus: (id, status) => request(`/actions/${id}/status`, { method: 'POST', body: { status } }),
  integrations: () => request('/integrations/status'),
  connections: () => request('/integrations/connections'),
  testMessage: (body) => request('/integrations/test', { method: 'POST', body }),
  viasocketToken: () => request('/viasocket/token'),
};
