import { createClient, type Client, type ResultSet } from "@libsql/client";
import fs from "fs";
import path from "path";
import { SEED_ACCOUNTS, SEED_CATEGORIES } from "./seed";

/*
 * Storage is libSQL: a Turso database in production (TURSO_DATABASE_URL + TURSO_AUTH_TOKEN),
 * or a local SQLite file when those are not set, so `npm run dev` works with no account.
 */

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

/** One statement waiting to be sent, used to group many writes into a single round trip. */
export type Q = { sql: string; args: unknown[] };
export const q = (sql: string, ...args: unknown[]): Q => ({ sql, args });

type Arg = string | number | null | Uint8Array;
const norm = (args: unknown[]): Arg[] =>
  args.map((a) => (a === undefined || a === null ? null : typeof a === "boolean" ? (a ? 1 : 0) : (a as Arg)));

function rowsOf(rs: ResultSet): Record<string, unknown>[] {
  return rs.rows.map((r) => {
    const o: Record<string, unknown> = {};
    rs.columns.forEach((c, i) => { o[c] = r[i]; });
    return o;
  });
}

type State = { client: Client; ready: Promise<void> };
type G = typeof globalThis & { __financeDb?: State };

function connect(): State {
  const url = process.env.TURSO_DATABASE_URL || "";
  let client: Client;
  if (url) {
    client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN || undefined });
  } else {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    client = createClient({ url: `file:${path.join(DATA_DIR, "finance.db")}` });
  }
  const ready = (async () => {
    if (!url) await client.execute("PRAGMA foreign_keys = ON");
    await client.executeMultiple(SCHEMA);
    await seed(client);
  })();
  return { client, ready };
}

async function seed(client: Client) {
  const count = async (table: string) => Number((await client.execute(`SELECT COUNT(*) c FROM ${table}`)).rows[0][0]);
  // Adds any seed category the database does not have yet, so new categories reach existing databases too.
  const have = new Set((await client.execute("SELECT name FROM categories")).rows.map((r) => String(r[0])));
  const missing = SEED_CATEGORIES.map((c, i) => ({ c, i })).filter(({ c }) => !have.has(c.name));
  if (missing.length) {
    await client.batch(
      missing.map(({ c, i }) => ({
        sql: "INSERT OR IGNORE INTO categories (name, grp, is_spend, sort) VALUES (?,?,?,?)",
        args: [c.name, c.grp, c.is_spend ? 1 : 0, i],
      })),
      "write",
    );
  }
  if ((await count("accounts")) === 0) {
    await client.batch(
      SEED_ACCOUNTS.map((a) => ({
        sql: "INSERT INTO accounts (name, bank, type, default_owner) VALUES (?,?,?,?)",
        args: [a.name, a.bank, a.type, a.default_owner],
      })),
      "write",
    );
  }
}

async function ready(): Promise<Client> {
  const g = globalThis as G;
  if (!g.__financeDb) g.__financeDb = connect();
  const s = g.__financeDb;
  try {
    await s.ready;
  } catch (e) {
    // A bad URL or token should not stick: let the next request try again.
    if (g.__financeDb === s) g.__financeDb = undefined;
    throw e;
  }
  return s.client;
}

const BATCH_SIZE = 400;

export class Db {
  /** Same shape as the old synchronous API, but every call is awaited. */
  prepare(sql: string) {
    return {
      get: async <T = unknown>(...args: unknown[]): Promise<T | undefined> => {
        const rs = await (await ready()).execute({ sql, args: norm(args) });
        return rowsOf(rs)[0] as T | undefined;
      },
      all: async <T = unknown>(...args: unknown[]): Promise<T[]> => {
        const rs = await (await ready()).execute({ sql, args: norm(args) });
        return rowsOf(rs) as T[];
      },
      run: async (...args: unknown[]): Promise<{ changes: number; lastInsertRowid: number }> => {
        const rs = await (await ready()).execute({ sql, args: norm(args) });
        return { changes: rs.rowsAffected, lastInsertRowid: Number(rs.lastInsertRowid ?? 0) };
      },
    };
  }

  /** Sends many writes at once. Each chunk of up to 400 statements succeeds or fails as a whole. */
  async batch(stmts: Q[]): Promise<ResultSet[]> {
    if (!stmts.length) return [];
    const client = await ready();
    const out: ResultSet[] = [];
    for (let i = 0; i < stmts.length; i += BATCH_SIZE) {
      const chunk = stmts.slice(i, i + BATCH_SIZE).map((s) => ({ sql: s.sql, args: norm(s.args) }));
      out.push(...(await client.batch(chunk, "write")));
    }
    return out;
  }
}

const instance = new Db();
export const db = () => instance;

export async function getSetting(key: string, fallback = ""): Promise<string> {
  const row = await db().prepare("SELECT value FROM settings WHERE key = ?").get<{ value: string }>(key);
  return row ? row.value : fallback;
}

export async function setSetting(key: string, value: string) {
  await db()
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, value);
}
