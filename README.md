# Action Correction

When an action is rejected or marked "improve", the assignee and team lead are notified
(Slack or email). If it isn't Done after 2 hours they get a reminder; after 24 hours the
manager is escalated to. Marking the action Done cancels all pending follow-ups.

- `backend/` Node + Express (JavaScript), SQLite, durable scheduler, Gemini feedback agent
- `frontend/` React + Vite (JavaScript): actions, people & teams, integrations page

## Run

```
cd backend && cp .env.example .env && npm install && npm start
cd frontend && npm install && npm run dev
```

Timings come from `REMIND_AFTER_MINUTES` / `ESCALATE_AFTER_MINUTES`. `NOTIFIER=log` prints
messages to the console (dev only); `NOTIFIER=viasocket` sends through viaSocket Embed, which
is **not wired yet** (see `backend/src/notifier/viasocket.js`).

Tests: `cd backend && npm test`
