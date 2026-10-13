import * as SQLite from 'expo-sqlite';

/* LOCAL DATABASE
   The single SQLite connection backing the offline-first data layer.

   Each domain table stores one JSON blob per row (`data`) alongside the
   handful of columns actually needed for lookups (id, userId, subjectId).
   The app's existing screens already treat subjects/tasks/attendance/
   schedules/date sheets as loosely shaped JS objects that vary field by
   field (a Lab schedule carries different keys than a Theory one, a task
   carries different keys depending on its type, etc). Re-normalising every
   field into its own SQLite column would mean rewriting how every screen
   reads its data, which is unnecessary risk for zero benefit here. Storing
   the object as JSON keeps every screen's existing shape assumptions valid
   while still giving indexed, instant lookups by user and by subject. */

const DB_NAME = 'quizmate_local.db';

let dbPromise = null;

const SCHEMA = `
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS subjects (
    id TEXT NOT NULL,
    userId TEXT NOT NULL,
    data TEXT NOT NULL,
    updatedAt TEXT,
    PRIMARY KEY (id, userId)
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT NOT NULL,
    userId TEXT NOT NULL,
    subjectId TEXT NOT NULL,
    data TEXT NOT NULL,
    updatedAt TEXT,
    PRIMARY KEY (id, userId)
  );
  CREATE INDEX IF NOT EXISTS idx_tasks_subject ON tasks (userId, subjectId);

  CREATE TABLE IF NOT EXISTS attendance (
    subjectId TEXT NOT NULL,
    userId TEXT NOT NULL,
    data TEXT NOT NULL,
    updatedAt TEXT,
    PRIMARY KEY (subjectId, userId)
  );

  CREATE TABLE IF NOT EXISTS class_schedules (
    id TEXT NOT NULL,
    userId TEXT NOT NULL,
    subjectId TEXT NOT NULL,
    data TEXT NOT NULL,
    updatedAt TEXT,
    PRIMARY KEY (id, userId)
  );
  CREATE INDEX IF NOT EXISTS idx_schedules_subject ON class_schedules (userId, subjectId);

  CREATE TABLE IF NOT EXISTS date_sheets (
    id TEXT NOT NULL,
    userId TEXT NOT NULL,
    data TEXT NOT NULL,
    updatedAt TEXT,
    PRIMARY KEY (id, userId)
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT NOT NULL,
    userId TEXT NOT NULL,
    data TEXT NOT NULL,
    updatedAt TEXT,
    PRIMARY KEY (id, userId)
  );
  CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (userId);

  CREATE TABLE IF NOT EXISTS profile (
    userId TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updatedAt TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    userId TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updatedAt TEXT
  );

  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`;

/* A single open/schema call must never be able to hang the entire app.
   expo-sqlite's web target needs Metro configured for wasm + cross-origin
   isolation headers (see metro.config.js); until that is set up (or if a
   device ever gets stuck behind a locked OPFS handle / corrupted file),
   the underlying worker/native promise can simply never settle - no
   error, no resolve, forever. Racing every step against a timeout turns
   that into a normal, catchable error instead of a silent freeze that
   every screen in the app inherits. */
const DB_OPEN_TIMEOUT_MS = 8000;

const withTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`${label} timed out after ${ms}ms`));
      }, ms);
    }),
  ]);

const openDb = async () => {
  const db = await withTimeout(
    SQLite.openDatabaseAsync(DB_NAME),
    DB_OPEN_TIMEOUT_MS,
    'SQLite open'
  );
  await withTimeout(
    db.execAsync(SCHEMA),
    DB_OPEN_TIMEOUT_MS,
    'SQLite schema setup'
  );
  return db;
};

/* A module-level promise means concurrent callers all await the same
   open+migrate step instead of racing to create the database twice. */
export const getDb = () => {
  if (!dbPromise) {
    dbPromise = openDb().catch((error) => {
      // Let the next caller retry instead of caching a broken connection.
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
};

export const withDb = async (fn) => {
  const db = await getDb();
  return fn(db);
};

/* META HELPERS
   Small key/value store for migration flags, last-backup timestamps,
   and anything else that is not really "app data" but still needs to
   persist across launches without going through AsyncStorage. */

export const getMeta = async (key) =>
  withDb(async (db) => {
    const row = await db.getFirstAsync(
      'SELECT value FROM meta WHERE key = ?',
      [key]
    );
    return row?.value ?? null;
  });

export const setMeta = async (key, value) =>
  withDb(async (db) => {
    await db.runAsync(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value]
    );
  });
