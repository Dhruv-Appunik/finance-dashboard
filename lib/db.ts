import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { SEED_ACCOUNTS, SEED_CATEGORIES } from "./seed";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  bank TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('savings','current','credit_card')),
  last4 TEXT,
  default_owner TEXT NOT NULL CHECK (default_owner IN ('personal','business')),
  column_map TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  file_name TEXT NOT NULL,
  period_start TEXT,
  period_end TEXT,
  row_count INTEGER NOT NULL DEFAULT 0,
  added_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'done',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS payees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  display_name TEXT NOT NULL,
  normalised_name TEXT NOT NULL,
  upi_id TEXT,
  kind TEXT NOT NULL DEFAULT 'unknown' CHECK (kind IN ('merchant','person','own_account','unknown')),
  is_mixed INTEGER NOT NULL DEFAULT 0,
  mixed_limit REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS payees_upi ON payees(upi_id) WHERE upi_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payees_name ON payees(normalised_name);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  grp TEXT NOT NULL,
  is_spend INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  upload_id INTEGER REFERENCES uploads(id),
  txn_date TEXT NOT NULL,
  amount REAL NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('debit','credit')),
  narration_raw TEXT NOT NULL,
  mode TEXT,
  reference_no TEXT,
  balance REAL,
  payee_id INTEGER REFERENCES payees(id),
  category_id INTEGER REFERENCES categories(id),
  owner TEXT CHECK (owner IN ('personal','business')),
  flow_type TEXT,
  confidence REAL,
  status TEXT NOT NULL DEFAULT 'needs_review' CHECK (status IN ('classified','needs_review','confirmed')),
  classified_by TEXT,
  reason TEXT,
  linked_txn_id INTEGER,
  dedupe_hash TEXT NOT NULL UNIQUE,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS txn_date ON transactions(txn_date);
CREATE INDEX IF NOT EXISTS txn_payee ON transactions(payee_id);
CREATE INDEX IF NOT EXISTS txn_status ON transactions(status);
CREATE TABLE IF NOT EXISTS rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payee_id INTEGER NOT NULL REFERENCES payees(id),
  category_id INTEGER NOT NULL REFERENCES categories(id),
  owner TEXT CHECK (owner IN ('personal','business')),
  scope TEXT NOT NULL DEFAULT 'always' CHECK (scope IN ('always','above_amount','below_amount')),
  amount_limit REAL,
  source TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS rules_payee ON rules(payee_id);
CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payee_id INTEGER NOT NULL REFERENCES payees(id),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','skipped')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  answered_at TEXT
);
CREATE INDEX IF NOT EXISTS questions_payee ON questions(payee_id);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

type G = typeof globalThis & { __financeDb?: Database.Database };

export function db(): Database.Database {
  const g = globalThis as G;
  if (g.__financeDb) return g.__financeDb;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const conn = new Database(path.join(DATA_DIR, "finance.db"));
  conn.pragma("journal_mode = WAL");
  conn.pragma("foreign_keys = ON");
  conn.exec(SCHEMA);
  seed(conn);
  g.__financeDb = conn;
  return conn;
}

function seed(conn: Database.Database) {
  const catCount = (conn.prepare("SELECT COUNT(*) c FROM categories").get() as { c: number }).c;
  if (catCount === 0) {
    const ins = conn.prepare("INSERT INTO categories (name, grp, is_spend, sort) VALUES (?,?,?,?)");
    SEED_CATEGORIES.forEach((c, i) => ins.run(c.name, c.grp, c.is_spend ? 1 : 0, i));
  }
  const accCount = (conn.prepare("SELECT COUNT(*) c FROM accounts").get() as { c: number }).c;
  if (accCount === 0) {
    const ins = conn.prepare("INSERT INTO accounts (name, bank, type, default_owner) VALUES (?,?,?,?)");
    SEED_ACCOUNTS.forEach((a) => ins.run(a.name, a.bank, a.type, a.default_owner));
  }
}

export function getSetting(key: string, fallback = ""): string {
  const row = db().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row ? row.value : fallback;
}

export function setSetting(key: string, value: string) {
  db()
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, value);
}

export const DATA_PATH = DATA_DIR;
