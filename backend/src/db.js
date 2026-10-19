import Database from 'better-sqlite3';
import { config } from './config.js';

export function openDb(path = config.dbPath) {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
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
  // Added later: 1 when a person chose the priority, so the AI rating never overwrites it.
  if (!db.prepare("SELECT 1 FROM pragma_table_info('actions') WHERE name = 'priority_manual'").get()) {
    db.exec('ALTER TABLE actions ADD COLUMN priority_manual INTEGER NOT NULL DEFAULT 0');
  }
  // Added later: actions imported from a viaSocket Table remember the row they came from.
  if (!db.prepare("SELECT 1 FROM pragma_table_info('actions') WHERE name = 'source_row_id'").get()) {
    db.exec('ALTER TABLE actions ADD COLUMN source_row_id TEXT');
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS actions_source_row ON actions(source_row_id) WHERE source_row_id IS NOT NULL');
  db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  return db;
}
