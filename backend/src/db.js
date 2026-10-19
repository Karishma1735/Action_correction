import Database from 'better-sqlite3';
import { config } from './config.js';

export function openDb(path = config.dbPath) {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS people (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT,
      slack_id TEXT
    );
    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      lead_id INTEGER REFERENCES people(id),
      manager_id INTEGER REFERENCES people(id),
      channel TEXT NOT NULL DEFAULT 'slack'
    );
    CREATE TABLE IF NOT EXISTS actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      team_id INTEGER NOT NULL REFERENCES teams(id),
      assignee_id INTEGER NOT NULL REFERENCES people(id),
      status TEXT NOT NULL DEFAULT 'open',
      review TEXT NOT NULL DEFAULT 'pending',
      feedback TEXT,
      ai_summary TEXT,
      ai_source TEXT,
      priority TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action_id INTEGER NOT NULL REFERENCES actions(id),
      type TEXT NOT NULL,
      run_at TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'pending',
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS jobs_due ON jobs(state, run_at);
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action_id INTEGER NOT NULL REFERENCES actions(id),
      kind TEXT NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}
